import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, many } from '../db.js';
import { conflict, notFound, bad } from '../lib/errors.js';
import { normalizePhone } from '../lib/phone.js';
import { requireRole } from '../auth.js';
import { type Ctx, inDakar } from '../domain/core.js';
import * as orders from '../domain/orders.js';
import * as dispatch from '../domain/dispatch.js';
import { publish } from '../events.js';
import { dakarDate } from '../lib/time.js';
import { locationView, method, parse, uuid } from './util.js';

export async function courierRoutes(app: FastifyInstance, ctx: Ctx) {
  const guard = { preHandler: requireRole('courier') };
  const profile = (id: string) => one(ctx.db, 'select * from courier_profiles where user_id = $1', [id]);

  app.get('/api/courier/home', guard, async (req) => {
    const me = req.user!.id;
    await dispatch.expireOffers(ctx.db);
    const p = await profile(me);
    const offer = await one(ctx.db,
      `select f.id, f.expires_at, now() as server_now, o.ref, o.pickup_address, o.courier_earning, zf.name as pickup_zone, zt.name as dest_zone, s.name as shop_name,
         (select source from customer_locations where order_id = o.id order by id desc limit 1) as location_source
       from offers f join orders o on o.id = f.order_id join zones zf on zf.id = o.pickup_zone_id join zones zt on zt.id = o.dest_zone_id join shops s on s.id = o.shop_id
       where f.courier_id = $1 and f.status = 'pending' and f.expires_at > now()`, [me]);
    const active = await one(ctx.db, `select id, ref, status from orders where courier_id = $1 and status in ('assigned','at_pickup','picked_up','in_delivery','incident')`, [me]);
    const today = await one(ctx.db,
      `select (select count(*) from orders where courier_id = $1 and status = 'delivered' and (delivered_at at time zone 'Africa/Dakar')::date = $2::date)::int as delivered,
              (select coalesce(sum(amount),0) from earnings where courier_id = $1 and (created_at at time zone 'Africa/Dakar')::date = $2::date)::int as earned,
              (select coalesce(sum(amount),0) from earnings where courier_id = $1 and status = 'pending')::int as balance`, [me, dakarDate()]);
    return { profile: { status: p.status, available: p.available, last_position_at: p.last_position_at }, offer, active, today };
  });

  app.post('/api/courier/availability', guard, async (req) => {
    const b = parse(z.object({ available: z.boolean() }), req.body);
    const p = await profile(req.user!.id);
    if (p.status !== 'approved') throw conflict('courier_not_approved', 'Votre profil doit être validé par l’équipe avant de recevoir des courses.');
    if (!b.available) {
      const pending = await one(ctx.db, `select 1 from offers where courier_id = $1 and status = 'pending' and expires_at > now()`, [req.user!.id]);
      if (pending) throw conflict('offer_pending', 'Répondez d’abord à l’offre en cours.');
    }
    await ctx.db.query('update courier_profiles set available = $2 where user_id = $1', [req.user!.id, b.available]);
    await publish(ctx.db, { users: [], kind: 'couriers' });
    return { available: b.available };
  });

  // Position envoyée uniquement quand l'application est ouverte et que le livreur est disponible ou en course.
  app.post('/api/courier/position', { ...guard, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const b = parse(z.object({ lat: z.number(), lng: z.number(), accuracy: z.number().min(0).max(100000).optional() }), req.body);
    if (!inDakar(b.lat, b.lng)) throw bad('out_of_area', 'Position hors de la région de Dakar : non enregistrée.');
    const me = req.user!.id;
    const p = await profile(me);
    const active = await one(ctx.db, `select id, shop_id from orders where courier_id = $1 and status in ('assigned','at_pickup','picked_up','in_delivery','incident')`, [me]);
    if (!p.available && !active) throw conflict('not_sharing', 'Position non nécessaire : vous êtes indisponible.');
    await ctx.db.query('update courier_profiles set last_lat=$2, last_lng=$3, last_accuracy=$4, last_position_at=now() where user_id=$1', [me, b.lat, b.lng, b.accuracy ?? null]);
    if (active) {
      const s = await one(ctx.db, 'select owner_id from shops where id = $1', [active.shop_id]);
      await publish(ctx.db, { orderId: active.id, users: [s.owner_id], kind: 'position' });
    }
    return { ok: true };
  });

  app.post('/api/courier/offers/:id/respond', guard, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ accept: z.boolean() }), req.body);
    const r = await dispatch.respondOffer(ctx, req.user!.id, id, b.accept);
    if (r.status === 'expired') throw conflict('offer_expired', 'Offre expirée. L’équipe la proposera à nouveau si besoin.');
    return r;
  });

  app.get('/api/courier/orders/:id', guard, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const o = await orders.orderBase(ctx.db, id);
    if (!o || o.courier_id !== req.user!.id) throw notFound('Course introuvable.');
    const active = !['delivered', 'cancelled'].includes(o.status);
    const [loc, contact, code, proofs] = await Promise.all([
      orders.latestLocation(ctx.db, id), dispatch.contactState(ctx.db, id, o.pricing_version_id),
      one(ctx.db, 'select attempts, max_attempts, used_at is not null as used, expires_at <= now() as expired from delivery_codes where order_id = $1', [id]),
      many(ctx.db, 'select kind, status, reason, created_at from delivery_proofs where order_id = $1 order by created_at', [id]),
    ]);
    return {
      order: { id: o.id, ref: o.ref, status: o.status, shop_name: o.shop_name, shop_phone: active ? o.shop_phone : null, pickup_address: o.pickup_address,
        pickup_zone: o.pickup_zone, dest_zone: o.dest_zone, dest_hint: o.dest_hint, customer_name: o.customer_name,
        customer_phone: active ? o.customer_phone : null, courier_earning: o.courier_earning, delivered_at: o.delivered_at },
      // Coordonnées du client uniquement pendant la course.
      location: active ? locationView(ctx, loc) : null,
      contact, code: code ? { attemptsLeft: Math.max(0, code.max_attempts - code.attempts), used: code.used, expired: code.expired } : null, proofs,
    };
  });

  app.post('/api/courier/orders/:id/step', guard, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ step: z.enum(['arrived_pickup', 'picked_up', 'departed']) }), req.body);
    return dispatch.courierStep(ctx, req.user!.id, id, b.step);
  });

  app.post('/api/courier/orders/:id/code', { ...guard, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ code: z.string() }), req.body);
    return dispatch.verifyCode(ctx, req.user!.id, id, b.code);
  });

  app.post('/api/courier/orders/:id/photo-proof', guard, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ mediaId: uuid, reason: z.string().max(300), recipientName: z.string().max(80).optional() }), req.body);
    return dispatch.submitPhotoProof(ctx, req.user!.id, id, b);
  });

  app.post('/api/courier/orders/:id/contact', guard, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ channel: z.enum(['call', 'whatsapp']) }), req.body);
    return dispatch.logContactAttempt(ctx, req.user!.id, id, b.channel);
  });

  app.post('/api/courier/orders/:id/not-found', guard, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    return dispatch.declareNotFound(ctx, req.user!.id, id);
  });

  app.get('/api/courier/wallet', guard, async (req) => {
    const me = req.user!.id;
    const earnings = await many(ctx.db,
      `select e.id, e.kind, e.amount, e.status, e.note, e.created_at, o.ref, zt.name as dest_zone, p.reference as payout_reference, p.created_at as paid_at
       from earnings e left join orders o on o.id = e.order_id left join zones zt on zt.id = o.dest_zone_id left join payouts p on p.id = e.payout_id
       where e.courier_id = $1 order by e.created_at desc limit 200`, [me]);
    const payouts = await many(ctx.db, 'select id, amount, method, reference, created_at from payouts where courier_id = $1 order by created_at desc limit 100', [me]);
    const balance = earnings.filter((e) => e.status === 'pending').reduce((s, e) => s + e.amount, 0);
    return { balance, earnings, payouts };
  });

  app.get('/api/courier/history', guard, async (req) => {
    return many(ctx.db,
      `select o.id, o.ref, o.status, o.courier_earning, o.delivered_at, o.updated_at, zf.name as pickup_zone, zt.name as dest_zone
       from orders o join zones zf on zf.id = o.pickup_zone_id join zones zt on zt.id = o.dest_zone_id where o.courier_id = $1 order by o.updated_at desc limit 100`, [req.user!.id]);
  });

  app.patch('/api/courier/profile', guard, async (req) => {
    const b = parse(z.object({ payoutMethod: method.nullable(), payoutNumber: z.string().nullable(), homeZoneId: z.number().int().nullable() }), req.body);
    const n = b.payoutNumber ? normalizePhone(b.payoutNumber) : null;
    if (b.payoutNumber && !n) throw bad('invalid_phone', 'Numéro de reversement invalide.');
    await ctx.db.query('update courier_profiles set payout_method=$2, payout_number=$3, home_zone_id=$4 where user_id=$1', [req.user!.id, b.payoutMethod, n, b.homeZoneId]);
    return { ok: true };
  });

}
