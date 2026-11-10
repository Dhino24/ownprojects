import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, many, tx } from '../db.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { normalizePhone } from '../lib/phone.js';
import { AppError, bad, conflict } from '../lib/errors.js';
import { SESSION_COOKIE, createSession, revokeSession } from '../auth.js';
import { type Ctx, audit } from '../domain/core.js';
import { parse } from './util.js';

const password = z.string().min(8, '8 caractères minimum').max(200);

export async function authRoutes(app: FastifyInstance, ctx: Ctx) {
  const loginLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.get('/api/zones', async () => many(ctx.db, 'select id, name, department, active, center_lat, center_lng from zones order by department, name'));

  app.get('/api/meta', async () => ({
    appName: ctx.cfg.APP_NAME, demo: ctx.cfg.DEMO_MODE, whatsappMode: ctx.cfg.WHATSAPP_MODE, paymentMode: ctx.cfg.PAYMENT_MODE,
    offerTtl: ctx.cfg.OFFER_TTL_SECONDS,
  }));

  app.post('/api/auth/register', loginLimit, async (req, reply) => {
    const b = parse(z.object({
      role: z.enum(['merchant', 'courier']), name: z.string().trim().min(2).max(80), phone: z.string(), password,
      shop: z.object({ name: z.string().trim().min(2).max(80), zoneId: z.number().int(), pickupAddress: z.string().trim().min(3).max(200),
        waveNumber: z.string().optional(), orangeMoneyNumber: z.string().optional() }).optional(),
      courier: z.object({ vehicle: z.enum(['moto', 'scooter']).default('moto'), homeZoneId: z.number().int().optional() }).optional(),
    }), req.body);
    const phone = normalizePhone(b.phone);
    if (!phone) throw bad('invalid_phone', 'Numéro invalide (format sénégalais attendu).');
    if (b.role === 'merchant' && !b.shop) throw bad('shop_required', 'Renseignez votre boutique.');
    const norm = (p?: string) => (p ? normalizePhone(p) : null);
    if (b.shop?.waveNumber && !norm(b.shop.waveNumber)) throw bad('invalid_phone', 'Numéro Wave invalide.');
    if (b.shop?.orangeMoneyNumber && !norm(b.shop.orangeMoneyNumber)) throw bad('invalid_phone', 'Numéro Orange Money invalide.');
    const hash = await hashPassword(b.password);
    const user = await tx(ctx.db, async (t) => {
      const exists = await one(t, 'select 1 from users where phone = $1', [phone]);
      if (exists) throw conflict('phone_taken', 'Un compte existe déjà avec ce numéro.');
      const u = await one(t, 'insert into users(phone, name, role, password_hash) values ($1,$2,$3,$4) returning id', [phone, b.name, b.role, hash]);
      if (b.role === 'merchant') {
        const z = await one(t, 'select active from zones where id = $1', [b.shop!.zoneId]);
        if (!z) throw bad('invalid_zone', 'Zone inconnue.');
        if (!z.active) throw conflict('zone_inactive', 'Cette zone n’est pas encore ouverte pendant le pilote.');
        await t.query('insert into shops(owner_id, name, phone, zone_id, pickup_address, wave_number, orange_money_number) values ($1,$2,$3,$4,$5,$6,$7)',
          [u.id, b.shop!.name, phone, b.shop!.zoneId, b.shop!.pickupAddress, norm(b.shop!.waveNumber), norm(b.shop!.orangeMoneyNumber)]);
      } else {
        await t.query('insert into courier_profiles(user_id, vehicle, home_zone_id) values ($1,$2,$3)', [u.id, b.courier?.vehicle ?? 'moto', b.courier?.homeZoneId ?? null]);
      }
      await audit(t, u.id, b.role, 'user.register', 'user', u.id);
      return u;
    });
    await createSession(ctx, reply, user.id);
    return { ok: true };
  });

  app.post('/api/auth/login', loginLimit, async (req, reply) => {
    const b = parse(z.object({ phone: z.string(), password: z.string().max(200) }), req.body);
    const phone = normalizePhone(b.phone);
    const u = phone ? await one(ctx.db, 'select id, password_hash, status from users where phone = $1', [phone]) : null;
    // Même message et même coût que le compte existe ou non.
    const ok = await verifyPassword(b.password, u?.password_hash ?? 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    if (!u || !ok) throw new AppError(401, 'bad_credentials', 'Numéro ou mot de passe incorrect.');
    if (u.status !== 'active') throw new AppError(403, 'account_suspended', 'Compte suspendu. Contactez l’équipe.');
    await createSession(ctx, reply, u.id);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await revokeSession(ctx.db, req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', async (req) => {
    if (!req.user) throw new AppError(401, 'unauthenticated', 'Non connecté.');
    const u = req.user;
    const shop = u.role === 'merchant'
      ? await one(ctx.db, 'select s.*, z.name as zone_name from shops s join zones z on z.id = s.zone_id where owner_id = $1', [u.id]) : null;
    const courier = u.role === 'courier'
      ? await one(ctx.db, 'select status, vehicle, available, home_zone_id, payout_method, payout_number, last_position_at from courier_profiles where user_id = $1', [u.id]) : null;
    return { user: u, shop, courier };
  });
}
