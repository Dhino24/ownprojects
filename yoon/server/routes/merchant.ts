import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, many, tx } from '../db.js';
import { normalizePhone } from '../lib/phone.js';
import { bad, notFound } from '../lib/errors.js';
import { requireRole } from '../auth.js';
import { type Ctx, logEvent } from '../domain/core.js';
import * as orders from '../domain/orders.js';
import { confirmPayment, declarePayment, rejectPayment } from '../domain/payments.js';
import { listForOrder, prepareMessage } from '../domain/notify.js';
import { dailyRecap } from '../domain/recap.js';
import { dakarDate } from '../lib/time.js';
import { locationView, method, money, parse, positionInfo, uuid } from './util.js';

export const LIST_SQL = `select o.id, o.ref, o.customer_name, o.status, o.delivery_price, o.order_amount, o.delivery_payer, o.created_at, o.updated_at,
  zf.name as pickup_zone, zt.name as dest_zone, s.name as shop_name, u.name as courier_name,
  (select status from payment_obligations where order_id = o.id and kind = 'order_amount') as order_payment,
  (select status from payment_obligations where order_id = o.id and kind = 'delivery_fee') as fee_payment
  from orders o join shops s on s.id = o.shop_id join zones zf on zf.id = o.pickup_zone_id join zones zt on zt.id = o.dest_zone_id
  left join users u on u.id = o.courier_id`;

const FILTERS: Record<string, string> = {
  all: 'true',
  active: `o.status not in ('delivered','cancelled')`,
  delivered: `o.status = 'delivered'`,
  cancelled: `o.status = 'cancelled'`,
};

export async function merchantRoutes(app: FastifyInstance, ctx: Ctx) {
  const guard = { preHandler: requireRole('merchant') };
  const shopOf = async (userId: string) => {
    const s = await one(ctx.db, 'select * from shops where owner_id = $1', [userId]);
    if (!s) throw notFound('Boutique introuvable.');
    return s;
  };
  const ownOrder = async (userId: string, orderId: string) => {
    const o = await orders.orderBase(ctx.db, orderId);
    if (!o || o.shop_owner_id !== userId) throw notFound('Livraison introuvable.'); // 404 : on ne révèle pas l'existence
    return o;
  };

  app.get('/api/merchant/dashboard', guard, async (req) => {
    const shop = await shopOf(req.user!.id);
    const today = dakarDate();
    const stats = await one(ctx.db,
      `select count(*) filter (where status='delivered' and (delivered_at at time zone 'Africa/Dakar')::date = $2::date)::int as delivered_today,
         count(*) filter (where status='delivered' and (delivered_at at time zone 'Africa/Dakar')::date = $2::date - 1)::int as delivered_yesterday,
         count(*) filter (where status not in ('delivered','cancelled'))::int as in_progress,
         count(*) filter (where status = 'awaiting_location')::int as awaiting_location,
         coalesce(sum(delivery_price) filter (where status='delivered' and (delivered_at at time zone 'Africa/Dakar')::date = $2::date),0)::int as fees_today
       from orders where shop_id = $1`, [shop.id, today]);
    const recent = await many(ctx.db, `${LIST_SQL} where o.shop_id = $1 order by o.created_at desc limit 6`, [shop.id]);
    const live = await one(ctx.db, `${LIST_SQL} where o.shop_id = $1 and o.status in ('assigned','at_pickup','picked_up','in_delivery') order by o.updated_at desc limit 1`, [shop.id]);
    return { shop: { name: shop.name }, today, stats, recent, liveId: live?.id ?? null };
  });

  app.get('/api/merchant/orders', guard, async (req) => {
    const { filter = 'all', q = '' } = req.query as { filter?: string; q?: string };
    const shop = await shopOf(req.user!.id);
    return many(ctx.db, `${LIST_SQL} where o.shop_id = $1 and ${FILTERS[filter] ?? 'true'}
      and ($2 = '' or o.ref ilike '%' || $2 || '%' or o.customer_name ilike '%' || $2 || '%') order by o.created_at desc limit 200`, [shop.id, q.slice(0, 40)]);
  });

  app.post('/api/merchant/quote', guard, async (req) => {
    const b = parse(z.object({ pickupZoneId: z.number().int(), destZoneId: z.number().int() }), req.body);
    const qt = await orders.quote(ctx.db, b.pickupZoneId, b.destZoneId);
    return { price: qt.price, pricingVersionId: qt.versionId, isDemo: qt.isDemo };
  });

  app.post('/api/merchant/orders', guard, async (req, reply) => {
    const b = parse(z.object({
      customerName: z.string().trim().min(2).max(80), customerPhone: z.string(), orderAmount: money,
      pickupAddress: z.string().trim().min(3).max(200), pickupZoneId: z.number().int(), destZoneId: z.number().int(),
      destHint: z.string().max(200).optional(), deliveryPayer: z.enum(['merchant', 'customer']), expectedPrice: money,
    }), req.body);
    const key = req.headers['idempotency-key'];
    const r = await orders.createOrder(ctx, req.user!.id, { ...b, idempotencyKey: typeof key === 'string' ? key.slice(0, 80) : undefined });
    reply.code(r.replayed ? 200 : 201);
    return r;
  });

  app.get('/api/merchant/orders/:id', guard, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const o = await ownOrder(req.user!.id, id);
    const [loc, obs, tl, msgs, cancel, incidents, offers] = await Promise.all([
      orders.latestLocation(ctx.db, id), orders.obligations(ctx.db, id), orders.timeline(ctx.db, id),
      listForOrder(ctx, ctx.db, id, ['customer']),
      one(ctx.db, 'select actor, reason, fee, refund_decision, refund_note, created_at from cancellations where order_id = $1', [id]),
      many(ctx.db, 'select id, type, reported_by, description, status, resolution, created_at from incidents where order_id = $1 order by created_at', [id]),
      one(ctx.db, `select count(*)::int as n from offers where order_id = $1`, [id]),
    ]);
    const active = ['assigned', 'at_pickup', 'picked_up', 'in_delivery'].includes(o.status);
    return {
      order: {
        id: o.id, ref: o.ref, status: o.status, customer_name: o.customer_name, customer_phone: o.customer_phone, order_amount: o.order_amount,
        pickup_address: o.pickup_address, pickup_zone: o.pickup_zone, dest_zone: o.dest_zone, dest_hint: o.dest_hint, delivery_payer: o.delivery_payer,
        delivery_price: o.delivery_price, created_at: o.created_at, delivered_at: o.delivered_at, cancelled_at: o.cancelled_at,
      },
      courier: o.courier_id ? { name: o.courier_name, phone: active ? o.courier_phone : null, position: active ? positionInfo(o.courier_lat, o.courier_lng, o.courier_position_at) : null } : null,
      location: locationView(ctx, loc), obligations: obs, timeline: tl, messages: msgs, cancellation: cancel, incidents, offerCount: offers.n,
      canCancel: ['awaiting_location', 'ready', 'offered', 'assigned', 'at_pickup'].includes(o.status),
      cancelHasFee: ['assigned', 'at_pickup'].includes(o.status),
    };
  });

  app.post('/api/merchant/orders/:id/cancel', guard, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
    await ownOrder(req.user!.id, id);
    return orders.cancelOrder(ctx, id, 'merchant', req.user!.id, b.reason);
  });

  app.post('/api/merchant/orders/:id/report', guard, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ type: z.enum(['complaint', 'damaged', 'other']), description: z.string().max(1000) }), req.body);
    await ownOrder(req.user!.id, id);
    return orders.reportProblem(ctx, id, 'merchant', req.user!.id, b.type, b.description);
  });

  app.post('/api/merchant/orders/:id/client-link', guard, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const o = await ownOrder(req.user!.id, id);
    if (['delivered', 'cancelled'].includes(o.status)) throw bad('order_closed', 'Livraison terminée.');
    return tx(ctx.db, async (t) => {
      const link = await orders.issueClientLink(ctx, t, id, true);
      await t.query(`update notifications set status = 'failed', updated_at = now() where order_id = $1 and template = 'location_request' and status in ('prepared','opened')`, [id]);
      await prepareMessage(ctx, t, { orderId: id, template: 'location_request', recipientKind: 'customer', phone: o.customer_phone,
        vars: { nom: o.customer_name, commercant: o.shop_name, lien: link.url }, dedupeKey: `location_request:${id}:${link.id}` });
      await logEvent(t, id, 'client_link_renewed', 'merchant', req.user!.id);
      return { url: link.url };
    });
  });

  app.post('/api/merchant/obligations/:id/declare', guard, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ orderId: uuid, method, reference: z.string().max(80).optional(), mediaId: uuid.optional() }), req.body);
    return declarePayment(ctx, 'merchant', { orderId: b.orderId, merchantId: req.user!.id }, id, b);
  });
  app.post('/api/merchant/obligations/:id/confirm', guard, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ method, reference: z.string().trim().min(3).max(80), amountReceived: money }), req.body);
    return confirmPayment(ctx, 'merchant', req.user!.id, id, b);
  });
  app.post('/api/merchant/obligations/:id/reject', guard, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ note: z.string().max(300) }), req.body);
    return rejectPayment(ctx, 'merchant', req.user!.id, id, b.note);
  });

  app.get('/api/merchant/payments', guard, async (req) => {
    const shop = await shopOf(req.user!.id);
    const { date = dakarDate() } = req.query as { date?: string };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('invalid_date', 'Date invalide.');
    const list = await many(ctx.db,
      `select po.id, po.kind, po.payer, po.payee, po.amount, po.status, po.method, po.reference, po.confirmed_at, o.id as order_id, o.ref, o.customer_name,
         (select count(*) from payment_proofs p where p.obligation_id = po.id and p.status = 'to_review')::int as proofs_to_review
       from payment_obligations po join orders o on o.id = po.order_id where o.shop_id = $1 order by po.created_at desc limit 200`, [shop.id]);
    return { recap: await dailyRecap(ctx.db, date, { shopId: shop.id }), obligations: list };
  });

  app.patch('/api/merchant/shop', guard, async (req) => {
    const b = parse(z.object({
      name: z.string().trim().min(2).max(80), pickupAddress: z.string().trim().min(3).max(200), zoneId: z.number().int(),
      waveNumber: z.string().optional().nullable(), orangeMoneyNumber: z.string().optional().nullable(),
      pickupLat: z.number().optional().nullable(), pickupLng: z.number().optional().nullable(),
    }), req.body);
    const norm = (p?: string | null) => {
      if (!p) return null;
      const n = normalizePhone(p);
      if (!n) throw bad('invalid_phone', 'Numéro de paiement invalide.');
      return n;
    };
    const z1 = await one(ctx.db, 'select active from zones where id = $1', [b.zoneId]);
    if (!z1?.active) throw bad('zone_inactive', 'Zone non ouverte pendant le pilote.');
    await ctx.db.query(`update shops set name=$2, pickup_address=$3, zone_id=$4, wave_number=$5, orange_money_number=$6, pickup_lat=$7, pickup_lng=$8 where owner_id=$1`,
      [req.user!.id, b.name, b.pickupAddress, b.zoneId, norm(b.waveNumber), norm(b.orangeMoneyNumber), b.pickupLat ?? null, b.pickupLng ?? null]);
    return { ok: true };
  });
}
