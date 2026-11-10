import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, many, tx } from '../db.js';
import { bad, conflict, notFound } from '../lib/errors.js';
import { normalizePhone } from '../lib/phone.js';
import { requireRole } from '../auth.js';
import { type Ctx, audit } from '../domain/core.js';
import * as orders from '../domain/orders.js';
import * as dispatch from '../domain/dispatch.js';
import { addAdjustment, confirmPayment, createPayout, rejectPayment } from '../domain/payments.js';
import { dailyRecap, recapCsv } from '../domain/recap.js';
import { prepareDailyRecaps } from '../jobs.js';
import { withLink } from '../domain/notify.js';
import { dakarDate } from '../lib/time.js';
import { publish } from '../events.js';
import { LIST_SQL } from './merchant.js';
import { locationView, mediaUrl, method, money, parse, positionInfo, uuid } from './util.js';

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)) * 10) / 10;
}
const dateQ = (q: any) => {
  const d = (q?.date as string) || dakarDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw bad('invalid_date', 'Date invalide.');
  return d;
};

export async function adminRoutes(app: FastifyInstance, ctx: Ctx) {
  const guard = { preHandler: requireRole('admin') };
  const me = (req: any) => req.user!.id as string;

  const couriersSql = `select u.id, u.name, u.phone, u.status as account_status, cp.status, cp.available, cp.vehicle, cp.last_lat, cp.last_lng, cp.last_position_at,
      cp.payout_method, cp.payout_number, z.name as home_zone,
      (select o.ref from orders o where o.courier_id = u.id and o.status in ('assigned','at_pickup','picked_up','in_delivery','incident')) as active_ref,
      (select f.id from offers f where f.courier_id = u.id and f.status = 'pending' and f.expires_at > now()) as pending_offer,
      (select coalesce(sum(amount),0) from earnings e where e.courier_id = u.id and e.status = 'pending')::int as balance
    from users u join courier_profiles cp on cp.user_id = u.id left join zones z on z.id = cp.home_zone_id where u.role = 'courier'`;

  app.get('/api/admin/overview', guard, async () => {
    await dispatch.expireOffers(ctx.db);
    const stats = await one(ctx.db, `select
      (select count(*) from orders where status = 'ready')::int as to_assign,
      (select count(*) from orders where status = 'awaiting_location')::int as awaiting_location,
      (select count(*) from courier_profiles where status = 'approved' and available)::int as couriers_available,
      (select count(*) from payment_obligations where status = 'declared')::int as payments_to_verify,
      (select count(*) from incidents where status = 'open')::int as open_incidents,
      (select count(*) from courier_profiles where status = 'pending')::int as couriers_pending`);
    const active = await many(ctx.db, `${LIST_SQL} where o.status not in ('delivered','cancelled') order by
      case o.status when 'incident' then 0 when 'ready' then 1 when 'offered' then 2 else 3 end, o.created_at limit 100`);
    const couriers = (await many(ctx.db, `${couriersSql} and cp.status = 'approved' order by cp.available desc, cp.last_position_at desc nulls last`))
      .map((c) => ({ ...c, phone: undefined, position: positionInfo(c.last_lat, c.last_lng, c.last_position_at) }));
    return { stats, active, couriers };
  });

  app.get('/api/admin/orders', guard, async (req) => {
    const { status = '', q = '' } = req.query as any;
    return many(ctx.db, `${LIST_SQL} where ($1 = '' or o.status = $1) and ($2 = '' or o.ref ilike '%'||$2||'%' or o.customer_name ilike '%'||$2||'%' or s.name ilike '%'||$2||'%')
      order by o.created_at desc limit 300`, [String(status).slice(0, 30), String(q).slice(0, 40)]);
  });

  app.get('/api/admin/orders/:id', guard, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    await dispatch.expireOffers(ctx.db);
    const o = await orders.orderBase(ctx.db, id);
    if (!o) throw notFound('Livraison introuvable.');
    const [loc, obs, tl, offers, proofs, contacts, incidents, cancel, earnings, code, msgs, shop] = await Promise.all([
      orders.latestLocation(ctx.db, id), orders.obligations(ctx.db, id), orders.timeline(ctx.db, id),
      many(ctx.db, `select f.id, f.status, f.created_at, f.expires_at, f.responded_at, u.name as courier_name, now() as server_now from offers f join users u on u.id = f.courier_id where order_id = $1 order by f.created_at`, [id]),
      many(ctx.db, 'select id, kind, status, reason, recipient_name, media_id, created_at, reviewed_at from delivery_proofs where order_id = $1 order by created_at', [id]),
      many(ctx.db, 'select channel, created_at from contact_attempts where order_id = $1 order by created_at', [id]),
      many(ctx.db, 'select * from incidents where order_id = $1 order by created_at', [id]),
      one(ctx.db, 'select * from cancellations where order_id = $1', [id]),
      many(ctx.db, 'select kind, amount, status, created_at from earnings where order_id = $1', [id]),
      one(ctx.db, 'select attempts, max_attempts, used_at, expires_at from delivery_codes where order_id = $1', [id]),
      many(ctx.db, 'select * from notifications where order_id = $1 order by created_at', [id]),
      one(ctx.db, 'select pickup_lat, pickup_lng from shops where id = $1', [o.shop_id]),
    ]);
    const pickupZone = await one(ctx.db, 'select center_lat, center_lng from zones where id = $1', [o.pickup_zone_id]);
    const pickup = shop?.pickup_lat != null ? { lat: shop.pickup_lat, lng: shop.pickup_lng } : pickupZone?.center_lat != null ? { lat: pickupZone.center_lat, lng: pickupZone.center_lng } : null;
    const candidates = (await many(ctx.db, `${couriersSql} and cp.status = 'approved' and u.status = 'active' and cp.available`)).map((c) => {
      const position = positionInfo(c.last_lat, c.last_lng, c.last_position_at);
      return { id: c.id, name: c.name, home_zone: c.home_zone, busy: !!c.active_ref || !!c.pending_offer, position,
        // Distance à vol d'oiseau, seulement indicative ; null si pas de position.
        distanceKm: position && pickup ? km(position, pickup) : null };
    }).sort((a, b) => (a.busy === b.busy ? (a.position?.stale ? 1 : 0) - (b.position?.stale ? 1 : 0) || (a.distanceKm ?? 999) - (b.distanceKm ?? 999) : a.busy ? 1 : -1));
    const { shop_wave, shop_om, ...rest } = o;
    return {
      order: rest, pickup, location: locationView(ctx, loc), timeline: tl, offers, contacts, incidents, cancellation: cancel, earnings, candidates,
      obligations: obs.map((p: any) => ({ ...p, proofs: (p.proofs ?? []).map((pr: any) => ({ ...pr, url: mediaUrl(ctx, pr.media_id) })) })),
      proofs: proofs.map((p) => ({ ...p, url: mediaUrl(ctx, p.media_id) })),
      code: code ? { attempts: code.attempts, max: code.max_attempts, used: !!code.used_at, expires_at: code.expires_at } : null,
      messages: msgs.map((n) => withLink(ctx, n)),
      courierPosition: positionInfo(o.courier_lat, o.courier_lng, o.courier_position_at),
    };
  });

  app.post('/api/admin/orders/:id/offers', guard, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ courierId: uuid }), req.body);
    return dispatch.createOffer(ctx, me(req), id, b.courierId);
  });
  app.post('/api/admin/offers/:id/withdraw', guard, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    await dispatch.withdrawOffer(ctx, me(req), id);
    return { ok: true };
  });

  app.post('/api/admin/orders/:id/location', guard, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ lat: z.number(), lng: z.number(), landmark: z.string().max(500).optional() }), req.body);
    const r = await orders.submitLocation(ctx, id, 'admin', me(req), { source: 'operator', ...b });
    await audit(ctx.db, me(req), 'admin', 'location.operator', 'order', id);
    return r;
  });

  app.post('/api/admin/orders/:id/cancel', guard, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ reason: z.string().trim().min(3).max(300), fee: money.optional(), courierCompensation: money.optional(),
      refundDecision: z.enum(['none', 'to_refund', 'refunded', 'not_applicable']).optional(), refundNote: z.string().max(300).optional() }), req.body);
    return orders.cancelOrder(ctx, id, 'admin', me(req), b.reason, b);
  });

  app.post('/api/admin/orders/:id/regenerate-code', guard, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    await dispatch.regenerateCode(ctx, me(req), id);
    return { ok: true };
  });

  app.post('/api/admin/cancellations/:id/refund', guard, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ decision: z.enum(['none', 'to_refund', 'refunded', 'not_applicable']), note: z.string().trim().min(3).max(300) }), req.body);
    const r = await one(ctx.db, 'update cancellations set refund_decision = $2, refund_note = $3 where order_id = $1 returning order_id', [id, b.decision, b.note]);
    if (!r) throw notFound('Annulation introuvable.');
    await audit(ctx.db, me(req), 'admin', 'refund.decision', 'order', id, b);
    return { ok: true };
  });

  app.get('/api/admin/incidents', guard, async (req) => {
    const { status = 'open' } = req.query as any;
    return many(ctx.db, `select i.*, o.ref, o.status as order_status, s.name as shop_name from incidents i join orders o on o.id = i.order_id join shops s on s.id = o.shop_id
      where ($1 = 'all' or i.status = $1) order by i.blocking desc, i.created_at desc limit 200`, [status]);
  });
  app.post('/api/admin/incidents/:id/resolve', guard, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ decision: z.enum(['resume', 'approve_photo', 'reject_photo', 'cancel', 'close']), note: z.string().max(500),
      fee: money.optional(), courierCompensation: money.optional() }), req.body);
    await dispatch.resolveIncident(ctx, me(req), id, b.decision, b.note, { fee: b.fee, courierCompensation: b.courierCompensation });
    return { ok: true };
  });

  app.get('/api/admin/payments', guard, async (req) => {
    const { status = 'declared' } = req.query as any;
    const rows = await many(ctx.db,
      `select po.*, o.ref, o.customer_name, s.name as shop_name,
         (select json_agg(json_build_object('id', p.id, 'method', p.method, 'declared_reference', p.declared_reference, 'status', p.status, 'media_id', p.media_id,
            'declared_by', p.declared_by, 'review_note', p.review_note, 'created_at', p.created_at) order by p.created_at) from payment_proofs p where p.obligation_id = po.id) as proofs
       from payment_obligations po join orders o on o.id = po.order_id join shops s on s.id = o.shop_id
       where ($1 = 'all' or po.status = $1) order by po.created_at desc limit 300`, [String(status)]);
    return rows.map((r) => ({ ...r, proofs: (r.proofs ?? []).map((p: any) => ({ ...p, url: mediaUrl(ctx, p.media_id) })) }));
  });
  app.post('/api/admin/obligations/:id/confirm', guard, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ method, reference: z.string().trim().min(3).max(80), amountReceived: money }), req.body);
    return confirmPayment(ctx, 'admin', me(req), id, b);
  });
  app.post('/api/admin/obligations/:id/reject', guard, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ note: z.string().max(300) }), req.body);
    await rejectPayment(ctx, 'admin', me(req), id, b.note);
    return { ok: true };
  });

  app.get('/api/admin/couriers', guard, async () => {
    return (await many(ctx.db, `${couriersSql} order by cp.status, u.name`)).map((c) => ({ ...c, position: positionInfo(c.last_lat, c.last_lng, c.last_position_at) }));
  });
  app.post('/api/admin/couriers/:id/status', guard, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ status: z.enum(['approved', 'suspended', 'pending']) }), req.body);
    const r = await one(ctx.db, `update courier_profiles set status = $2, available = case when $2 = 'approved' then available else false end,
      approved_by = case when $2 = 'approved' then $3::uuid else approved_by end, approved_at = case when $2 = 'approved' then now() else approved_at end
      where user_id = $1 returning user_id`, [id, b.status, me(req)]);
    if (!r) throw notFound('Livreur introuvable.');
    await audit(ctx.db, me(req), 'admin', `courier.${b.status}`, 'user', id);
    await publish(ctx.db, { users: [id], kind: 'profile' });
    return { ok: true };
  });

  app.get('/api/admin/payouts', guard, async () => {
    const couriers = await many(ctx.db, `${couriersSql} order by u.name`);
    const history = await many(ctx.db, `select p.*, u.name as courier_name from payouts p join users u on u.id = p.courier_id order by p.created_at desc limit 100`);
    const pending = await many(ctx.db, `select e.id, e.courier_id, e.kind, e.amount, e.note, e.created_at, o.ref from earnings e left join orders o on o.id = e.order_id where e.status = 'pending' order by e.created_at`);
    return { couriers: couriers.map((c) => ({ id: c.id, name: c.name, balance: c.balance, payout_method: c.payout_method, payout_number: c.payout_number })), history, pending };
  });
  app.post('/api/admin/couriers/:id/payouts', guard, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ method, reference: z.string().trim().min(3).max(80), expectedAmount: money }), req.body);
    return createPayout(ctx, me(req), id, b);
  });
  app.post('/api/admin/couriers/:id/adjustments', guard, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ amount: z.number().int(), note: z.string().max(300), orderId: uuid.optional() }), req.body);
    return addAdjustment(ctx, me(req), id, b.amount, b.note, b.orderId);
  });

  app.patch('/api/admin/zones/:id', guard, async (req) => {
    const { id } = parse(z.object({ id: z.coerce.number().int() }), req.params);
    const b = parse(z.object({ active: z.boolean() }), req.body);
    const r = await one(ctx.db, 'update zones set active = $2 where id = $1 returning *', [id, b.active]);
    if (!r) throw notFound('Zone introuvable.');
    await audit(ctx.db, me(req), 'admin', 'zone.update', 'zone', String(id), b);
    return r;
  });

  app.get('/api/admin/pricing', guard, async () => {
    const versions = await many(ctx.db, `select v.*, u.name as created_by_name, (select count(*) from orders where pricing_version_id = v.id)::int as orders
      from pricing_versions v left join users u on u.id = v.created_by order by v.id desc`);
    const active = versions.find((v) => v.active);
    const pairs = active ? await many(ctx.db, 'select from_zone_id, to_zone_id, price from pricing_pairs where version_id = $1', [active.id]) : [];
    return { versions, active: active ?? null, pairs };
  });
  /** Nouvelle version : l'ancienne reste attachée aux commandes déjà confirmées. */
  app.post('/api/admin/pricing', guard, async (req) => {
    const b = parse(z.object({
      note: z.string().trim().min(3).max(300), courierShareBps: z.number().int().min(0).max(10000), cancelFee: money,
      cancelCourierShareBps: z.number().int().min(0).max(10000), notFoundFee: money, notFoundWaitMinutes: z.number().int().min(0).max(120),
      pairs: z.array(z.object({ fromZoneId: z.number().int(), toZoneId: z.number().int(), price: z.number().int().min(1).max(1_000_000) })).min(1).max(2000),
    }), req.body);
    return tx(ctx.db, async (t) => {
      await t.query('update pricing_versions set active = false where active');
      const v = await one(t, `insert into pricing_versions(created_by, note, courier_share_bps, cancel_fee, cancel_courier_share_bps, not_found_fee, not_found_wait_minutes, active)
        values ($1,$2,$3,$4,$5,$6,$7,true) returning *`, [me(req), b.note, b.courierShareBps, b.cancelFee, b.cancelCourierShareBps, b.notFoundFee, b.notFoundWaitMinutes]);
      const seen = new Set<string>();
      for (const p of b.pairs) {
        const k = `${p.fromZoneId}-${p.toZoneId}`;
        if (seen.has(k)) throw bad('duplicate_pair', 'Paire de zones en double.');
        seen.add(k);
        await t.query('insert into pricing_pairs(version_id, from_zone_id, to_zone_id, price) values ($1,$2,$3,$4)', [v.id, p.fromZoneId, p.toZoneId, p.price]);
      }
      await audit(t, me(req), 'admin', 'pricing.publish', 'pricing_version', String(v.id), { pairs: b.pairs.length });
      return v;
    });
  });

  app.get('/api/admin/settings', guard, async () => {
    const rows = await many(ctx.db, 'select key, value, updated_at from app_settings');
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  });
  app.put('/api/admin/settings', guard, async (req) => {
    const b = parse(z.object({
      service_payment_numbers: z.object({ wave: z.string().optional().nullable(), orange_money: z.string().optional().nullable() }),
      require_fee_before_offer: z.boolean(),
    }), req.body);
    const nums: Record<string, string> = {};
    for (const k of ['wave', 'orange_money'] as const) {
      const v = b.service_payment_numbers[k];
      if (v) {
        const n = normalizePhone(v);
        if (!n) throw bad('invalid_phone', `Numéro ${k} invalide.`);
        nums[k] = n;
      }
    }
    for (const [key, value] of [['service_payment_numbers', nums], ['require_fee_before_offer', b.require_fee_before_offer]] as const) {
      await ctx.db.query(`insert into app_settings(key, value, updated_by) values ($1,$2,$3) on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
        [key, JSON.stringify(value), me(req)]);
    }
    await audit(ctx.db, me(req), 'admin', 'settings.update', 'settings', null, b);
    return { ok: true };
  });

  app.get('/api/admin/recap', guard, async (req) => dailyRecap(ctx.db, dateQ(req.query)));
  app.get('/api/admin/recap.csv', guard, async (req, reply) => {
    const d = dateQ(req.query);
    await audit(ctx.db, me(req), 'admin', 'export.csv', 'recap', d);
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="yoon-recap-${d}.csv"`);
    return '﻿' + (await recapCsv(ctx.db, d));
  });
  app.post('/api/admin/recap/prepare', guard, async (req) => {
    const d = dateQ(req.query);
    const created = await prepareDailyRecaps(ctx, d);
    if (!created) throw conflict('already_prepared', 'Les récaps de cette date sont déjà préparés.');
    return { ok: true };
  });

  app.get('/api/admin/messages', guard, async (req) => {
    const { status = 'pending' } = req.query as any;
    const rows = await many(ctx.db, `select n.*, o.ref from notifications n left join orders o on o.id = n.order_id
      where ($1 = 'all' or ($1 = 'pending' and n.status in ('prepared','opened')) or n.status = $1) order by n.created_at desc limit 200`, [status]);
    return rows.map((n) => withLink(ctx, n));
  });

  app.get('/api/admin/audit', guard, async () =>
    many(ctx.db, 'select a.*, u.name as actor_name from audit_log a left join users u on u.id = a.actor_id order by a.id desc limit 300'));
}
