import { type Q, one, many, tx } from '../db.js';
import { bad, conflict, notFound, forbidden } from '../lib/errors.js';
import { encrypt, randomCode4, randomToken, sha256 } from '../lib/crypto.js';
import { normalizePhone } from '../lib/phone.js';
import { BEFORE_ASSIGNMENT, type Actor } from '../../shared/contract.js';
import { type Ctx, type OrderRow, audit, bps, inDakar, lockOrder, logEvent, touch, transition } from './core.js';
import { prepareMessage } from './notify.js';

export async function activePricing(q: Q) {
  const v = await one(q, 'select * from pricing_versions where active');
  if (!v) throw conflict('no_pricing', 'Aucune grille tarifaire active. L’admin doit en publier une.');
  return v;
}

/** Prix fixe par paire de zones, depuis la version active. Jamais calculé au kilomètre. */
export async function quote(q: Q, fromZoneId: number, toZoneId: number) {
  const zones = await many(q, 'select id, name, active from zones where id = any($1)', [[fromZoneId, toZoneId]]);
  for (const id of [fromZoneId, toZoneId]) {
    const z = zones.find((x) => x.id === id);
    if (!z) throw bad('invalid_zone', 'Zone inconnue.');
    if (!z.active) throw conflict('zone_inactive', `La zone ${z.name} n’est pas ouverte pendant le pilote.`);
  }
  const v = await activePricing(q);
  const p = await one(q, 'select price from pricing_pairs where version_id = $1 and from_zone_id = $2 and to_zone_id = $3', [v.id, fromZoneId, toZoneId]);
  if (!p) throw conflict('no_price', 'Pas de tarif défini pour ce trajet. Contactez l’équipe.');
  const courierEarning = bps(p.price, v.courier_share_bps);
  return { versionId: v.id as number, price: p.price as number, courierEarning, commission: p.price - courierEarning, isDemo: v.is_demo as boolean };
}

export type CreateOrderInput = {
  customerName: string; customerPhone: string; orderAmount: number; pickupAddress: string; pickupZoneId: number;
  destZoneId: number; destHint?: string; deliveryPayer: 'merchant' | 'customer'; expectedPrice: number; idempotencyKey?: string;
};

export async function createOrder(ctx: Ctx, merchantId: string, input: CreateOrderInput) {
  const phone = normalizePhone(input.customerPhone);
  if (!phone) throw bad('invalid_phone', 'Numéro du client invalide (format sénégalais attendu).');
  return tx(ctx.db, async (t) => {
    const shop = await one(t, 'select * from shops where owner_id = $1', [merchantId]);
    if (!shop) throw forbidden('Profil boutique manquant.');
    if (input.idempotencyKey) {
      const existing = await one(t, 'select id from orders where shop_id = $1 and idempotency_key = $2', [shop.id, input.idempotencyKey]);
      if (existing) return { orderId: existing.id as string, replayed: true, clientUrl: null as string | null };
    }
    const qt = await quote(t, input.pickupZoneId, input.destZoneId);
    // Le prix affiché au commerçant doit être celui qui est figé : sinon on redemande confirmation.
    if (qt.price !== input.expectedPrice) throw conflict('price_changed', 'Le tarif a changé. Vérifiez le nouveau prix avant de confirmer.', { price: qt.price });
    const o = await one<OrderRow>(
      t,
      `insert into orders(shop_id, customer_name, customer_phone, order_amount, pickup_zone_id, pickup_address, dest_zone_id, dest_hint,
         delivery_payer, pricing_version_id, delivery_price, courier_earning, commission, idempotency_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
      [shop.id, input.customerName.trim(), phone, input.orderAmount, input.pickupZoneId, input.pickupAddress.trim(), input.destZoneId,
        (input.destHint ?? '').trim(), input.deliveryPayer, qt.versionId, qt.price, qt.courierEarning, qt.commission, input.idempotencyKey ?? null],
    );
    if (!o) throw new Error('insert failed');
    // Deux obligations distinctes : commande → commerçant ; course → service.
    if (input.orderAmount > 0) {
      await t.query(`insert into payment_obligations(order_id, kind, payer, payee, amount) values ($1,'order_amount','customer','merchant',$2)`, [o.id, input.orderAmount]);
    }
    await t.query(`insert into payment_obligations(order_id, kind, payer, payee, amount) values ($1,'delivery_fee',$2,'service',$3)`, [o.id, input.deliveryPayer, qt.price]);
    const code = randomCode4();
    await t.query(
      `insert into delivery_codes(order_id, code_enc, max_attempts, expires_at) values ($1,$2,$3, now() + make_interval(hours => $4))`,
      [o.id, encrypt(ctx.cfg.APP_SECRET, code), ctx.cfg.CODE_MAX_ATTEMPTS, ctx.cfg.CODE_TTL_HOURS],
    );
    const link = await issueClientLink(ctx, t, o.id);
    await prepareMessage(ctx, t, {
      orderId: o.id, template: 'location_request', recipientKind: 'customer', phone,
      vars: { nom: o.customer_name, commercant: shop.name, lien: link.url }, dedupeKey: `location_request:${o.id}:${link.id}`,
    });
    await logEvent(t, o.id, 'created', 'merchant', merchantId, { price: qt.price, pricing_version: qt.versionId, payer: input.deliveryPayer });
    await audit(t, merchantId, 'merchant', 'order.create', 'order', o.id);
    await touch(t, { ...o, shop_owner_id: merchantId });
    return { orderId: o.id, replayed: false, clientUrl: link.url };
  });
}

/** Lien client opaque, limité à une livraison, expirable et révocable. Le jeton est dans le fragment (#) : jamais envoyé dans les journaux HTTP. */
export async function issueClientLink(ctx: Ctx, q: Q, orderId: string, revokeOthers = false) {
  if (revokeOthers) await q.query('update client_links set revoked_at = now() where order_id = $1 and revoked_at is null', [orderId]);
  const token = randomToken(24);
  const row = await one(
    q,
    `insert into client_links(order_id, token_hash, expires_at) values ($1,$2, now() + make_interval(hours => $3)) returning id`,
    [orderId, sha256(token), ctx.cfg.CLIENT_LINK_TTL_HOURS],
  );
  return { id: row.id as string, url: `${ctx.cfg.PUBLIC_URL}/c#${token}` };
}

export async function resolveClientToken(q: Q, token: string): Promise<string> {
  if (!token || token.length < 20) throw notFound('Lien invalide.');
  const l = await one(q, 'select * from client_links where token_hash = $1', [sha256(token)]);
  if (!l) throw notFound('Lien invalide.');
  if (l.revoked_at) throw conflict('link_revoked', 'Ce lien a été remplacé. Demandez le nouveau lien au commerçant.');
  if (new Date(l.expires_at) < new Date()) throw conflict('link_expired', 'Ce lien a expiré. Demandez un nouveau lien au commerçant.');
  await q.query('update client_links set last_used_at = now() where id = $1', [l.id]);
  return l.order_id;
}

export async function checkOrderMedia(q: Q, orderId: string, ids: (string | undefined | null)[], kind: string) {
  for (const id of ids.filter(Boolean)) {
    const m = await one(q, 'select id from media where id = $1 and order_id = $2 and kind = $3 and deleted_at is null', [id, orderId, kind]);
    if (!m) throw bad('invalid_media', 'Fichier joint invalide pour cette livraison.');
  }
}

export type LocationInput = { source: 'gps' | 'map' | 'operator' | 'landmark_only'; lat?: number; lng?: number; accuracy?: number; landmark?: string; photoMediaId?: string; voiceMediaId?: string };

export async function submitLocation(ctx: Ctx, orderId: string, actor: Actor, actorId: string | null, input: LocationInput) {
  const hasCoords = typeof input.lat === 'number' && typeof input.lng === 'number';
  if (input.source !== 'landmark_only') {
    if (!hasCoords) throw bad('missing_coords', 'Position manquante. Placez le repère sur la carte.');
    if (!inDakar(input.lat!, input.lng!)) throw bad('out_of_area', 'Cette position est hors de la région de Dakar.');
  }
  if (input.source === 'landmark_only' && !input.landmark?.trim() && !input.photoMediaId && !input.voiceMediaId) {
    throw bad('empty_location', 'Ajoutez un repère, une photo ou une note vocale.');
  }
  return tx(ctx.db, async (t) => {
    const o = await lockOrder(t, orderId);
    if (['delivered', 'cancelled'].includes(o.status)) throw conflict('order_closed', 'Cette livraison est terminée.');
    await checkOrderMedia(t, o.id, [input.photoMediaId], 'photo');
    await checkOrderMedia(t, o.id, [input.voiceMediaId], 'voice');
    const prev = await one(t, 'select * from customer_locations where order_id = $1 order by id desc limit 1', [o.id]);
    const keepCoords = input.source === 'landmark_only' && prev?.lat != null;
    await t.query(
      `insert into customer_locations(order_id, source, lat, lng, accuracy, landmark, photo_media_id, voice_media_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [o.id, keepCoords ? prev.source : input.source, keepCoords ? prev.lat : input.lat ?? null, keepCoords ? prev.lng : input.lng ?? null,
        keepCoords ? prev.accuracy : input.accuracy ?? null, (input.landmark ?? '').trim().slice(0, 500),
        input.photoMediaId ?? (keepCoords ? prev.photo_media_id : null), input.voiceMediaId ?? (keepCoords ? prev.voice_media_id : null), actor],
    );
    const hasPosition = hasCoords || keepCoords;
    if (o.status === 'awaiting_location' && hasPosition) {
      await transition(t, o, 'location_received', actor, actorId, { source: input.source });
    } else {
      await logEvent(t, o.id, 'location_updated', actor, actorId, { source: input.source });
      await touch(t, o);
    }
    return { status: o.status, hasPosition };
  });
}

export async function cancelOrder(ctx: Ctx, orderId: string, actor: 'merchant' | 'admin', actorId: string, reason: string,
  opts: { fee?: number; courierCompensation?: number; refundDecision?: 'none' | 'to_refund' | 'refunded' | 'not_applicable'; refundNote?: string; notFound?: boolean } = {}) {
  if (!reason?.trim()) throw bad('reason_required', 'Indiquez le motif de l’annulation.');
  return tx(ctx.db, async (t) => {
    const o = await lockOrder(t, orderId);
    if (actor === 'merchant' && o.shop_owner_id !== actorId) throw notFound('Livraison introuvable.');
    if (o.status === 'delivered' || o.status === 'cancelled') throw conflict('order_closed', 'Cette livraison est déjà terminée.');
    const v = await one(t, 'select * from pricing_versions where id = $1', [o.pricing_version_id]);
    let fee = 0, comp = 0, name: 'cancelled_free' | 'cancelled_with_fee' | 'cancelled_admin';
    if (BEFORE_ASSIGNMENT.includes(o.status)) name = 'cancelled_free';
    else if (['assigned', 'at_pickup'].includes(o.status)) name = 'cancelled_with_fee';
    else name = 'cancelled_admin';
    if (name === 'cancelled_with_fee') { fee = v.cancel_fee; comp = bps(fee, v.cancel_courier_share_bps); }
    if (opts.notFound) { fee = v.not_found_fee; comp = bps(fee, v.cancel_courier_share_bps); }
    if (actor === 'admin' && name !== 'cancelled_free') {
      if (opts.fee !== undefined) fee = opts.fee;
      if (opts.courierCompensation !== undefined) comp = opts.courierCompensation;
    }
    if (comp > fee) throw bad('invalid_amounts', 'La compensation livreur ne peut dépasser les frais.');
    // Retrait d'une éventuelle offre en attente.
    await t.query(`update offers set status = 'withdrawn', responded_at = now() where order_id = $1 and status = 'pending'`, [o.id]);
    await transition(t, o, name, actor, actorId, { reason, fee });
    const paidFee = await one(t, `select status from payment_obligations where order_id = $1 and kind = 'delivery_fee'`, [o.id]);
    await t.query(`update payment_obligations set status = 'waived' where order_id = $1 and kind = 'delivery_fee' and status in ('due','rejected','declared')`, [o.id]);
    const refund = opts.refundDecision ?? (paidFee?.status === 'confirmed' ? 'to_refund' : 'not_applicable');
    await t.query(
      `insert into cancellations(order_id, actor, actor_id, reason, fee, courier_compensation, refund_decision, refund_note) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [o.id, actor, actorId, reason.trim(), fee, comp, refund, opts.refundNote ?? null],
    );
    if (fee > 0) {
      await t.query(`insert into payment_obligations(order_id, kind, payer, payee, amount) values ($1,'cancellation_fee','merchant','service',$2) on conflict do nothing`, [o.id, fee]);
    }
    if (comp > 0 && o.courier_id) {
      await t.query(`insert into earnings(courier_id, order_id, kind, amount, note) values ($1,$2,'cancellation',$3,$4) on conflict do nothing`, [o.courier_id, o.id, comp, reason.trim()]);
    }
    await t.query(`update incidents set status = 'resolved', resolution = 'Course annulée', resolved_by = $2, resolved_at = now() where order_id = $1 and status = 'open' and blocking`, [o.id, actorId]);
    await audit(t, actorId, actor, 'order.cancel', 'order', o.id, { fee, comp, refund });
    return { fee, courierCompensation: comp, refundDecision: refund };
  });
}

export async function reportProblem(ctx: Ctx, orderId: string, actor: Actor, actorId: string | null, type: 'complaint' | 'damaged' | 'other', description: string) {
  if (!description?.trim()) throw bad('description_required', 'Décrivez le problème en quelques mots.');
  return tx(ctx.db, async (t) => {
    const o = await lockOrder(t, orderId);
    const i = await one(t, `insert into incidents(order_id, type, reported_by, reporter_id, description) values ($1,$2,$3,$4,$5) returning id`,
      [o.id, type, actor, actorId, description.trim().slice(0, 1000)]);
    await logEvent(t, o.id, 'problem_reported', actor, actorId, { type });
    await touch(t, o);
    return i;
  });
}

// ---------- Vues ----------

export async function latestLocation(q: Q, orderId: string) {
  return one(q, 'select source, lat, lng, accuracy, landmark, photo_media_id, voice_media_id, created_at from customer_locations where order_id = $1 order by id desc limit 1', [orderId]);
}

export async function orderBase(q: Q, orderId: string) {
  return one(
    q,
    `select o.*, s.name as shop_name, s.phone as shop_phone, s.owner_id as shop_owner_id, s.wave_number as shop_wave, s.orange_money_number as shop_om,
       zf.name as pickup_zone, zt.name as dest_zone,
       u.name as courier_name, u.phone as courier_phone, cp.last_lat as courier_lat, cp.last_lng as courier_lng, cp.last_position_at as courier_position_at
     from orders o join shops s on s.id = o.shop_id
     join zones zf on zf.id = o.pickup_zone_id join zones zt on zt.id = o.dest_zone_id
     left join users u on u.id = o.courier_id left join courier_profiles cp on cp.user_id = o.courier_id
     where o.id = $1`,
    [orderId],
  );
}

export async function obligations(q: Q, orderId: string) {
  return many(
    q,
    `select po.id, po.kind, po.payer, po.payee, po.amount, po.status, po.method, po.reference, po.confirmed_at,
       (select json_agg(json_build_object('id', p.id, 'method', p.method, 'declared_reference', p.declared_reference, 'status', p.status,
          'media_id', p.media_id, 'review_note', p.review_note, 'created_at', p.created_at) order by p.created_at)
        from payment_proofs p where p.obligation_id = po.id) as proofs
     from payment_obligations po where po.order_id = $1
     order by array_position(array['order_amount','delivery_fee','cancellation_fee'], po.kind)`,
    [orderId],
  );
}

export async function timeline(q: Q, orderId: string) {
  return many(q, 'select type, actor, data, created_at from delivery_events where order_id = $1 order by id', [orderId]);
}
