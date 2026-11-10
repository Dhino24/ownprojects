import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one } from '../db.js';
import { decrypt } from '../lib/crypto.js';
import { requireClient } from '../auth.js';
import { type Ctx, getSetting } from '../domain/core.js';
import * as orders from '../domain/orders.js';
import { declarePayment } from '../domain/payments.js';
import { locationView, method, parse, positionInfo, uuid } from './util.js';

const PUBLIC_EVENTS = new Set(['created', 'location_received', 'offer_accepted', 'arrived_pickup', 'picked_up', 'departed', 'delivered_code',
  'delivered_photo_approved', 'cancelled_free', 'cancelled_with_fee', 'cancelled_admin', 'payment_declared', 'payment_confirmed', 'payment_rejected']);

export async function clientRoutes(app: FastifyInstance, ctx: Ctx) {
  const guard = { preHandler: requireClient(ctx), config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };

  app.get('/api/client/order', guard, async (req) => {
    const id = req.clientOrderId!;
    const o = await orders.orderBase(ctx.db, id);
    const [loc, obs, tl, code] = await Promise.all([
      orders.latestLocation(ctx.db, id), orders.obligations(ctx.db, id), orders.timeline(ctx.db, id),
      one(ctx.db, 'select code_enc, used_at, expires_at <= now() as expired, attempts >= max_attempts as locked from delivery_codes where order_id = $1', [id]),
    ]);
    const service = await getSetting<{ wave?: string; orange_money?: string }>(ctx.db, 'service_payment_numbers', {});
    const enRoute = ['assigned', 'at_pickup', 'picked_up', 'in_delivery'].includes(o.status);
    const closed = ['delivered', 'cancelled'].includes(o.status);
    return {
      order: { ref: o.ref, status: o.status, shop_name: o.shop_name, customer_name: o.customer_name, pickup_zone: o.pickup_zone, dest_zone: o.dest_zone,
        order_amount: o.order_amount, delivery_price: o.delivery_price, delivery_payer: o.delivery_payer, delivered_at: o.delivered_at },
      courier: o.courier_id && enRoute ? { firstName: String(o.courier_name).split(' ')[0], phone: o.courier_phone, position: positionInfo(o.courier_lat, o.courier_lng, o.courier_position_at) } : null,
      shopPhone: o.shop_phone,
      location: locationView(ctx, loc),
      // Le code n'est visible que par le client autorisé, tant qu'il est utilisable.
      code: closed || !code ? null : code.used_at ? null : code.expired ? { expired: true } : { value: decrypt(ctx.cfg.APP_SECRET, code.code_enc), locked: code.locked },
      payments: obs.filter((p: any) => p.payer === 'customer').map((p: any) => ({
        ...p, proofs: undefined, proofCount: p.proofs?.length ?? 0,
        payTo: p.payee === 'merchant' ? { label: o.shop_name, wave: o.shop_wave, orange_money: o.shop_om } : { label: `${ctx.cfg.APP_NAME} (service)`, ...service },
      })),
      timeline: tl.filter((e: any) => PUBLIC_EVENTS.has(e.type)).map((e: any) => ({ type: e.type, at: e.created_at })),
    };
  });

  app.post('/api/client/location', guard, async (req) => {
    const b = parse(z.object({
      source: z.enum(['gps', 'map', 'landmark_only']), lat: z.number().optional(), lng: z.number().optional(), accuracy: z.number().optional(),
      landmark: z.string().max(500).optional(), photoMediaId: uuid.optional(), voiceMediaId: uuid.optional(),
    }), req.body);
    return orders.submitLocation(ctx, req.clientOrderId!, 'customer', null, b);
  });

  app.post('/api/client/obligations/:id/declare', guard, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    // Aucun montant n'est accepté du client : seul le montant serveur fait foi.
    const b = parse(z.object({ method, reference: z.string().max(80).optional(), mediaId: uuid.optional() }).strict(), req.body);
    return declarePayment(ctx, 'customer', { orderId: req.clientOrderId! }, id, b);
  });

  app.post('/api/client/report', guard, async (req) => {
    const b = parse(z.object({ type: z.enum(['complaint', 'damaged', 'other']), description: z.string().max(1000) }), req.body);
    return orders.reportProblem(ctx, req.clientOrderId!, 'customer', null, b.type, b.description);
  });
}
