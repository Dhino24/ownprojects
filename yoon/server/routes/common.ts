import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { one } from '../db.js';
import { AppError, bad, notFound, forbidden } from '../lib/errors.js';
import { safeEqual, sign } from '../lib/crypto.js';
import { sniffMedia } from '../adapters/index.js';
import { requireClient } from '../auth.js';
import type { Ctx } from '../domain/core.js';
import { markMessage } from '../domain/notify.js';
import { resolveClientToken } from '../domain/orders.js';
import type { LiveBus, LiveEvent } from '../events.js';
import { parse, uuid } from './util.js';

const LIMITS = { image: 6 * 1024 * 1024, audio: 3 * 1024 * 1024 };

/** Qui peut joindre quel type de fichier à quelle livraison. */
async function canUpload(ctx: Ctx, req: FastifyRequest, orderId: string, kind: string): Promise<string> {
  if (req.headers['x-client-token']) {
    const id = await resolveClientToken(ctx.db, String(req.headers['x-client-token']));
    if (id !== orderId) throw notFound('Livraison introuvable.');
    if (!['photo', 'voice', 'proof'].includes(kind)) throw forbidden();
    return 'customer';
  }
  const u = req.user;
  if (!u) throw new AppError(401, 'unauthenticated', 'Connectez-vous pour continuer.');
  const o = await one(ctx.db, 'select o.courier_id, s.owner_id, o.status from orders o join shops s on s.id = o.shop_id where o.id = $1', [orderId]);
  if (!o) throw notFound('Livraison introuvable.');
  if (u.role === 'merchant' && o.owner_id === u.id && kind === 'proof') return 'merchant';
  if (u.role === 'courier' && o.courier_id === u.id && kind === 'proof') return 'courier';
  if (u.role === 'admin') return 'admin';
  throw notFound('Livraison introuvable.');
}

export async function commonRoutes(app: FastifyInstance, ctx: Ctx, bus: LiveBus) {
  app.post('/api/media', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const file = await req.file({ limits: { fileSize: LIMITS.image, files: 1, fields: 4 } });
    if (!file) throw bad('no_file', 'Aucun fichier reçu.');
    const fields = Object.fromEntries(Object.entries(file.fields).map(([k, v]: [string, any]) => [k, v?.value]));
    const { orderId, kind } = parse(z.object({ orderId: uuid, kind: z.enum(['photo', 'voice', 'proof']) }), fields);
    const uploader = await canUpload(ctx, req, orderId, kind);
    const buf = await file.toBuffer().catch(() => {
      throw bad('file_too_large', 'Fichier trop lourd (6 Mo maximum pour une photo, 3 Mo pour un vocal).');
    });
    if (file.file.truncated) throw bad('file_too_large', 'Fichier trop lourd.');
    const type = sniffMedia(buf);
    const wanted = kind === 'voice' ? 'audio' : 'image';
    if (!type || type.kind !== wanted) throw bad('invalid_file_type', kind === 'voice' ? 'Format audio non reconnu.' : 'Ce fichier n’est pas une photo valide (JPEG, PNG ou WebP).');
    if (buf.length > LIMITS[type.kind]) throw bad('file_too_large', 'Fichier trop lourd.');
    const key = await ctx.adapters.storage.put(buf, type.ext);
    const m = await one(ctx.db, 'insert into media(order_id, kind, mime, size, storage_key, uploaded_by) values ($1,$2,$3,$4,$5,$6) returning id',
      [orderId, kind, type.mime, buf.length, key, uploader]);
    reply.code(201);
    return { id: m.id };
  });

  // Lecture d'un média privé : uniquement via URL signée de courte durée, délivrée par une route autorisée.
  app.get('/api/media/:id', async (req, reply) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const { e, s } = req.query as { e?: string; s?: string };
    const exp = Number(e);
    if (!e || !s || !Number.isFinite(exp) || !safeEqual(sign(ctx.cfg.APP_SECRET, `${id}.${exp}`), s)) throw forbidden('Lien de fichier invalide.');
    if (exp < Date.now() / 1000) throw new AppError(410, 'media_link_expired', 'Lien de fichier expiré. Rechargez la page.');
    const m = await one(ctx.db, 'select * from media where id = $1 and deleted_at is null', [id]);
    if (!m) throw notFound('Fichier supprimé ou introuvable.');
    const buf = await ctx.adapters.storage.get(m.storage_key);
    reply.header('content-type', m.mime).header('cache-control', 'private, max-age=300').header('x-content-type-options', 'nosniff');
    return reply.send(buf);
  });

  app.post('/api/messages/:id/mark', async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ status: z.enum(['opened', 'confirmed_sent']) }), req.body);
    const u = req.user;
    if (!u) throw new AppError(401, 'unauthenticated', 'Connectez-vous pour continuer.');
    let allowed: string[] | 'all' = [];
    if (u.role === 'admin') allowed = 'all';
    else if (u.role === 'merchant') {
      const n = await one(ctx.db, 'select order_id, recipient_kind from notifications where id = $1', [id]);
      if (n?.recipient_kind === 'customer' && n.order_id) {
        const own = await one(ctx.db, 'select 1 from orders o join shops s on s.id = o.shop_id where o.id = $1 and s.owner_id = $2', [n.order_id, u.id]);
        if (own) allowed = [n.order_id];
      }
    }
    return markMessage(ctx.db, id, b.status, allowed);
  });

  /** Flux temps réel (SSE). Le client reçoit seulement des signaux « à rafraîchir », jamais de données. */
  app.get('/api/live', async (req, reply) => {
    // Hébergement sans connexion longue : 204 = « pas de flux, rafraîchissez périodiquement ».
    if (!ctx.cfg.LIVE_SSE) return reply.code(204).send();
    let match: (ev: LiveEvent) => boolean;
    if (req.headers['x-client-token']) {
      await requireClient(ctx)(req);
      const orderId = req.clientOrderId!;
      match = (ev) => ev.orderId === orderId;
    } else if (req.user) {
      const u = req.user;
      match = u.role === 'admin' ? () => true : (ev) => ev.users.includes(u.id);
    } else throw new AppError(401, 'unauthenticated', 'Connectez-vous pour continuer.');
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write('retry: 5000\n\n');
    const onEvent = (ev: LiveEvent) => {
      if (match(ev)) res.write(`data: ${JSON.stringify({ kind: ev.kind, orderId: ev.orderId ?? null })}\n\n`);
    };
    bus.on('event', onEvent);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.raw.on('close', () => {
      clearInterval(ping);
      bus.off('event', onEvent);
    });
  });

}
