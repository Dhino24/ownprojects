import { type Q, one, many, tx } from '../db.js';
import { bad, conflict, notFound, AppError } from '../lib/errors.js';
import { decrypt, encrypt, randomCode4, safeEqual } from '../lib/crypto.js';
import { publish } from '../events.js';
import { type Ctx, audit, getSetting, lockOrder, logEvent, touch, transition } from './core.js';
import { cancelOrder, checkOrderMedia } from './orders.js';
import { prepareMessage } from './notify.js';

const isUnique = (e: any) => e?.code === '23505';

/** Expire les offres échues (idempotent : rejouer ne crée aucun doublon). Retourne le nombre d'offres expirées. */
export async function expireOffers(q: Q): Promise<number> {
  const rows = await many(
    q,
    `with exp as (
       update offers set status = 'expired', responded_at = now() where status = 'pending' and expires_at <= now() returning id, order_id, courier_id
     ), upd as (
       update orders o set status = 'ready', updated_at = now() from exp where o.id = exp.order_id and o.status = 'offered' returning o.id
     )
     select exp.*, s.owner_id from exp join orders o on o.id = exp.order_id join shops s on s.id = o.shop_id`,
  );
  for (const r of rows) {
    await logEvent(q, r.order_id, 'offer_expired', 'system', null, { offer_id: r.id, courier_id: r.courier_id, to: 'ready' });
    await publish(q, { orderId: r.order_id, users: [r.owner_id, r.courier_id], kind: 'offer' });
  }
  return rows.length;
}

export async function createOffer(ctx: Ctx, adminId: string, orderId: string, courierId: string) {
  await expireOffers(ctx.db);
  return tx(ctx.db, async (t) => {
    const o = await lockOrder(t, orderId);
    const c = await one(t, `select cp.*, u.name, u.phone, u.status as user_status from courier_profiles cp join users u on u.id = cp.user_id where cp.user_id = $1 for update of cp`, [courierId]);
    if (!c) throw notFound('Livreur introuvable.');
    if (c.status !== 'approved' || c.user_status !== 'active') throw conflict('courier_not_approved', 'Ce livreur n’est pas validé.');
    if (!c.available) throw conflict('courier_unavailable', 'Ce livreur est indisponible.');
    const loc = await one(t, 'select 1 from customer_locations where order_id = $1 and lat is not null', [o.id]);
    if (!loc) throw conflict('no_location', 'La position du client doit être reçue avant toute offre.');
    if (await getSetting(t, 'require_fee_before_offer', false)) {
      const fee = await one(t, `select status from payment_obligations where order_id = $1 and kind = 'delivery_fee'`, [o.id]);
      if (fee?.status !== 'confirmed') throw conflict('fee_unpaid', 'Politique active : le paiement de la course doit être vérifié avant l’attribution.');
    }
    const busy = await one(t, `select 1 from orders where courier_id = $1 and status in ('assigned','at_pickup','picked_up','in_delivery','incident')`, [courierId]);
    if (busy) throw conflict('courier_busy', 'Ce livreur a déjà une course en cours.');
    let offer;
    try {
      await t.query('savepoint s');
      offer = await one(t, `insert into offers(order_id, courier_id, created_by, expires_at) values ($1,$2,$3, now() + make_interval(secs => $4)) returning *`,
        [o.id, courierId, adminId, ctx.cfg.OFFER_TTL_SECONDS]);
    } catch (e) {
      if (isUnique(e)) throw conflict('offer_pending', 'Une offre est déjà en attente pour cette course ou ce livreur.');
      throw e;
    }
    await transition(t, o, 'offer_sent', 'admin', adminId, { offer_id: offer.id, courier_id: courierId });
    await publish(t, { orderId: o.id, users: [courierId], kind: 'offer' });
    const zone = await one(t, 'select name from zones where id = $1', [o.dest_zone_id]);
    await prepareMessage(ctx, t, {
      orderId: o.id, template: 'courier_offer', recipientKind: 'courier', phone: c.phone,
      vars: { retrait: o.pickup_address, zone: zone.name, gain: o.courier_earning }, dedupeKey: `courier_offer:${offer.id}`,
    });
    await audit(t, adminId, 'admin', 'offer.create', 'offer', offer.id, { order: o.id, courier: courierId });
    return offer;
  });
}

export async function withdrawOffer(ctx: Ctx, adminId: string, offerId: string) {
  return tx(ctx.db, async (t) => {
    const off = await one(t, `update offers set status = 'withdrawn', responded_at = now() where id = $1 and status = 'pending' returning *`, [offerId]);
    if (!off) throw conflict('offer_closed', 'Cette offre n’est plus en attente.');
    const o = await lockOrder(t, off.order_id);
    await transition(t, o, 'offer_closed', 'admin', adminId, { offer_id: off.id, reason: 'withdrawn' });
    await publish(t, { orderId: o.id, users: [off.courier_id], kind: 'offer' });
  });
}

/** Acceptation atomique : une seule offre « pending » non échue peut passer à « accepted ». */
export async function respondOffer(ctx: Ctx, courierId: string, offerId: string, accept: boolean) {
  return tx(ctx.db, async (t) => {
    const off = await one(t, 'select * from offers where id = $1 and courier_id = $2 for update', [offerId, courierId]);
    if (!off) throw notFound('Offre introuvable.');
    if (off.status !== 'pending') throw conflict('offer_closed', off.status === 'expired' ? 'Offre expirée.' : 'Cette offre n’est plus disponible.');
    const expired = await one(t, 'select $1::timestamptz <= now() as e', [off.expires_at]);
    const o = await lockOrder(t, off.order_id);
    if (expired.e) {
      await t.query(`update offers set status = 'expired', responded_at = now() where id = $1`, [off.id]);
      if (o.status === 'offered') await transition(t, o, 'offer_closed', 'system', null, { offer_id: off.id, reason: 'expired' });
      return { status: 'expired' as const };
    }
    if (!accept) {
      await t.query(`update offers set status = 'refused', responded_at = now() where id = $1`, [off.id]);
      await transition(t, o, 'offer_closed', 'courier', courierId, { offer_id: off.id, reason: 'refused' });
      return { status: 'refused' as const };
    }
    await t.query(`update offers set status = 'accepted', responded_at = now() where id = $1`, [off.id]);
    await t.query('update orders set courier_id = $2 where id = $1', [o.id, courierId]);
    o.courier_id = courierId;
    try {
      await t.query('savepoint s');
      await transition(t, o, 'offer_accepted', 'courier', courierId, { offer_id: off.id });
    } catch (e) {
      if (isUnique(e)) throw conflict('courier_busy', 'Vous avez déjà une course en cours.');
      throw e;
    }
    return { status: 'accepted' as const, orderId: o.id };
  });
}

async function lockCourierOrder(t: Q, courierId: string, orderId: string) {
  const o = await lockOrder(t, orderId);
  if (o.courier_id !== courierId) throw notFound('Course introuvable.');
  return o;
}

export async function courierStep(ctx: Ctx, courierId: string, orderId: string, step: 'arrived_pickup' | 'picked_up' | 'departed') {
  return tx(ctx.db, async (t) => {
    const o = await lockCourierOrder(t, courierId, orderId);
    await transition(t, o, step, 'courier', courierId);
    if (step === 'departed' || step === 'picked_up') {
      const link = await one(t, `select 1 from client_links where order_id = $1 and revoked_at is null and expires_at > now()`, [o.id]);
      const u = await one(t, 'select name from users where id = $1', [courierId]);
      if (step === 'departed') {
        await prepareMessage(ctx, t, {
          orderId: o.id, template: 'courier_en_route', recipientKind: 'customer', phone: o.customer_phone,
          vars: { prenom: u.name.split(' ')[0], lien: link ? 'le lien de suivi reçu précédemment' : 'votre lien de suivi' }, dedupeKey: `en_route:${o.id}`,
        });
      }
    }
    return { status: o.status };
  });
}

/** Vérification du code client : aléatoire, usage unique, durée de validité, tentatives limitées. */
export async function verifyCode(ctx: Ctx, courierId: string, orderId: string, code: string) {
  if (!/^\d{4}$/.test(code ?? '')) throw bad('invalid_code_format', 'Le code comporte 4 chiffres.');
  const result = await tx(ctx.db, async (t) => {
    const o = await lockCourierOrder(t, courierId, orderId);
    if (o.status === 'delivered') throw conflict('already_delivered', 'Cette livraison est déjà confirmée.');
    if (!['picked_up', 'in_delivery'].includes(o.status)) throw conflict('invalid_status', 'Récupérez le colis avant de saisir le code.');
    const dc = await one(t, 'select *, expires_at <= now() as expired from delivery_codes where order_id = $1 for update', [o.id]);
    if (!dc) throw conflict('no_code', 'Aucun code pour cette livraison. Contactez l’équipe.');
    if (dc.used_at) throw conflict('code_used', 'Ce code a déjà été utilisé.');
    if (dc.expired) throw conflict('code_expired', 'Code expiré. Contactez l’équipe pour un nouveau code ou utilisez la preuve photo.');
    if (dc.attempts >= dc.max_attempts) throw new AppError(423, 'code_locked', 'Trop d’essais. Utilisez la preuve photo ou contactez l’équipe.');
    const ok = safeEqual(decrypt(ctx.cfg.APP_SECRET, dc.code_enc), code);
    if (!ok) {
      const attempts = dc.attempts + 1;
      await t.query('update delivery_codes set attempts = $2 where order_id = $1', [o.id, attempts]);
      await logEvent(t, o.id, 'code_failed', 'courier', courierId, { attempts });
      return { ok: false as const, remaining: dc.max_attempts - attempts };
    }
    await t.query('update delivery_codes set used_at = now(), attempts = attempts + 1 where order_id = $1', [o.id]);
    await t.query(`insert into delivery_proofs(order_id, kind, status, created_by) values ($1,'code','accepted',$2)`, [o.id, courierId]);
    await transition(t, o, 'delivered_code', 'courier', courierId);
    await creditDelivery(t, o.id);
    return { ok: true as const };
  });
  if (!result.ok) {
    throw new AppError(422, 'wrong_code', result.remaining > 0
      ? `Code incorrect. Il reste ${result.remaining} essai${result.remaining > 1 ? 's' : ''}.`
      : 'Code incorrect. Plus d’essai possible : utilisez la preuve photo ou contactez l’équipe.', { remaining: result.remaining });
  }
  return result;
}

/** Gain de course : contrainte unique (order_id, kind) → jamais de double gain, même si rejoué. */
export async function creditDelivery(q: Q, orderId: string) {
  await q.query(
    `insert into earnings(courier_id, order_id, kind, amount) select courier_id, id, 'delivery', courier_earning from orders where id = $1 and courier_id is not null
     on conflict do nothing`,
    [orderId],
  );
}

/** Preuve photo de secours : jamais validée automatiquement, toujours contrôlée par l'admin. */
export async function submitPhotoProof(ctx: Ctx, courierId: string, orderId: string, input: { mediaId: string; reason: string; recipientName?: string }) {
  if (!input.reason?.trim()) throw bad('reason_required', 'Indiquez le motif de la preuve photo.');
  return tx(ctx.db, async (t) => {
    const o = await lockCourierOrder(t, courierId, orderId);
    if (!['picked_up', 'in_delivery'].includes(o.status)) throw conflict('invalid_status', 'Preuve photo impossible à cette étape.');
    await checkOrderMedia(t, o.id, [input.mediaId], 'proof');
    await t.query(`insert into delivery_proofs(order_id, kind, media_id, reason, recipient_name, status, created_by) values ($1,'photo',$2,$3,$4,'pending_review',$5)`,
      [o.id, input.mediaId, input.reason.trim(), input.recipientName?.trim() || null, courierId]);
    await t.query(`insert into incidents(order_id, type, reported_by, reporter_id, description, blocking) values ($1,'photo_proof','courier',$2,$3,true)`,
      [o.id, courierId, `${input.reason.trim()}${input.recipientName ? ` · remis à : ${input.recipientName.trim()}` : ''}`]);
    await t.query('update orders set incident_resume_status = $2 where id = $1', [o.id, o.status]);
    await transition(t, o, 'incident_opened', 'courier', courierId, { type: 'photo_proof' });
    return { status: o.status };
  });
}

export async function logContactAttempt(ctx: Ctx, courierId: string, orderId: string, channel: 'call' | 'whatsapp') {
  return tx(ctx.db, async (t) => {
    const o = await lockCourierOrder(t, courierId, orderId);
    if (!['picked_up', 'in_delivery'].includes(o.status)) throw conflict('invalid_status', 'Tentative de contact possible pendant la livraison.');
    await t.query('insert into contact_attempts(order_id, courier_id, channel) values ($1,$2,$3)', [o.id, courierId, channel]);
    await logEvent(t, o.id, 'contact_attempt', 'courier', courierId, { channel });
    await touch(t, o);
    return contactState(t, o.id, o.pricing_version_id);
  });
}

export async function contactState(q: Q, orderId: string, pricingVersionId: number) {
  const r = await one(q, `select count(*)::int as n, min(created_at) as first from contact_attempts where order_id = $1`, [orderId]);
  const v = await one(q, 'select not_found_wait_minutes from pricing_versions where id = $1', [pricingVersionId]);
  const waitUntil = r.first ? new Date(new Date(r.first).getTime() + v.not_found_wait_minutes * 60000) : null;
  return { attempts: r.n, waitMinutes: v.not_found_wait_minutes as number, canDeclareNotFound: r.n >= 2 && !!waitUntil && waitUntil <= new Date(), waitUntil };
}

export async function declareNotFound(ctx: Ctx, courierId: string, orderId: string) {
  return tx(ctx.db, async (t) => {
    const o = await lockCourierOrder(t, courierId, orderId);
    if (!['picked_up', 'in_delivery'].includes(o.status)) throw conflict('invalid_status', 'Action impossible à cette étape.');
    const st = await contactState(t, o.id, o.pricing_version_id);
    if (st.attempts < 2) throw conflict('attempts_required', 'Deux tentatives de contact sont nécessaires.');
    if (!st.canDeclareNotFound) throw conflict('wait_required', `Attendez ${st.waitMinutes} minutes après la première tentative.`, { waitUntil: st.waitUntil });
    await t.query(`insert into incidents(order_id, type, reported_by, reporter_id, description, blocking) values ($1,'customer_not_found','courier',$2,$3,true)`,
      [o.id, courierId, `${st.attempts} tentatives de contact`]);
    await t.query('update orders set incident_resume_status = $2 where id = $1', [o.id, o.status]);
    await transition(t, o, 'incident_opened', 'courier', courierId, { type: 'customer_not_found' });
    return { status: o.status };
  });
}

/** Décision admin sur un incident bloquant. */
export async function resolveIncident(ctx: Ctx, adminId: string, incidentId: string,
  decision: 'resume' | 'approve_photo' | 'reject_photo' | 'cancel' | 'close', note: string, cancelOpts: { fee?: number; courierCompensation?: number } = {}) {
  if (!note?.trim()) throw bad('note_required', 'Indiquez la décision prise.');
  const inc = await one(ctx.db, 'select * from incidents where id = $1', [incidentId]);
  if (!inc) throw notFound('Incident introuvable.');
  if (inc.status !== 'open') throw conflict('incident_closed', 'Incident déjà traité.');
  if (decision === 'cancel') {
    await cancelOrder(ctx, inc.order_id, 'admin', adminId, note, { ...cancelOpts, notFound: inc.type === 'customer_not_found' && cancelOpts.fee === undefined });
    await ctx.db.query(`update incidents set status='resolved', resolution=$2, resolved_by=$3, resolved_at=now() where id=$1 and status='open'`, [inc.id, note, adminId]);
    return;
  }
  await tx(ctx.db, async (t) => {
    const i = await one(t, `update incidents set status='resolved', resolution=$2, resolved_by=$3, resolved_at=now() where id=$1 and status='open' returning *`, [inc.id, note.trim(), adminId]);
    if (!i) throw conflict('incident_closed', 'Incident déjà traité.');
    if (!i.blocking) { await audit(t, adminId, 'admin', 'incident.close', 'incident', i.id); return; }
    const o = await lockOrder(t, i.order_id);
    if (decision === 'approve_photo') {
      if (i.type !== 'photo_proof') throw bad('invalid_decision', 'Décision non applicable.');
      await t.query(`update delivery_proofs set status='accepted', reviewed_by=$2, reviewed_at=now() where order_id=$1 and status='pending_review'`, [o.id, adminId]);
      await transition(t, o, 'delivered_photo_approved', 'admin', adminId, { note });
      await t.query(`update delivery_codes set used_at = coalesce(used_at, now()) where order_id = $1`, [o.id]);
      await creditDelivery(t, o.id);
    } else if (decision === 'resume' || decision === 'reject_photo') {
      if (i.type === 'photo_proof') {
        await t.query(`update delivery_proofs set status='rejected', reviewed_by=$2, reviewed_at=now() where order_id=$1 and status='pending_review'`, [o.id, adminId]);
      }
      await transition(t, o, 'incident_resumed', 'admin', adminId, { note }, o.incident_resume_status ?? 'in_delivery');
    } else throw bad('invalid_decision', 'Décision non applicable.');
    await audit(t, adminId, 'admin', `incident.${decision}`, 'incident', i.id, { note });
  });
}

export async function regenerateCode(ctx: Ctx, adminId: string, orderId: string) {
  return tx(ctx.db, async (t) => {
    const o = await lockOrder(t, orderId);
    if (['delivered', 'cancelled'].includes(o.status)) throw conflict('order_closed', 'Livraison terminée.');
    await t.query(`update delivery_codes set code_enc=$2, attempts=0, used_at=null, expires_at = now() + make_interval(hours => $3) where order_id=$1`,
      [o.id, encrypt(ctx.cfg.APP_SECRET, randomCode4()), ctx.cfg.CODE_TTL_HOURS]);
    await logEvent(t, o.id, 'code_regenerated', 'admin', adminId);
    await audit(t, adminId, 'admin', 'code.regenerate', 'order', o.id);
    await touch(t, o);
  });
}
