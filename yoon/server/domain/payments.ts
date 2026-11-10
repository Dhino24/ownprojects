import { one, tx } from '../db.js';
import { bad, conflict, notFound, forbidden } from '../lib/errors.js';
import type { PaymentMethod } from '../../shared/contract.js';
import { type Ctx, audit, logEvent, touch } from './core.js';
import { checkOrderMedia } from './orders.js';

const isUnique = (e: any) => e?.code === '23505';

/**
 * Déclaration d'un paiement par le payeur (client ou commerçant) : justificatif et/ou référence.
 * Résultat : « déclaré · à vérifier ». Jamais « payé » sans contrôle.
 */
export async function declarePayment(ctx: Ctx, actor: 'customer' | 'merchant', scope: { orderId: string; merchantId?: string },
  obligationId: string, input: { method: PaymentMethod; reference?: string; mediaId?: string }) {
  if (!input.reference?.trim() && !input.mediaId) throw bad('proof_required', 'Ajoutez la capture d’écran ou la référence du transfert.');
  return tx(ctx.db, async (t) => {
    const ob = await one(t, `select po.*, s.owner_id from payment_obligations po join orders o on o.id = po.order_id join shops s on s.id = o.shop_id where po.id = $1 for update of po`, [obligationId]);
    if (!ob || ob.order_id !== scope.orderId) throw notFound('Paiement introuvable.');
    if (actor === 'merchant' && ob.owner_id !== scope.merchantId) throw notFound('Paiement introuvable.');
    if (ob.payer !== actor) throw forbidden('Ce paiement n’est pas à votre charge.');
    if (!['due', 'rejected', 'declared'].includes(ob.status)) throw conflict('obligation_closed', 'Ce paiement est déjà traité.');
    if (input.mediaId) await checkOrderMedia(t, ob.order_id, [input.mediaId], 'proof');
    await t.query(`insert into payment_proofs(obligation_id, media_id, method, declared_reference, declared_by) values ($1,$2,$3,$4,$5)`,
      [ob.id, input.mediaId ?? null, input.method, input.reference?.trim() ?? '', actor]);
    await t.query(`update payment_obligations set status = 'declared', method = $2 where id = $1`, [ob.id, input.method]);
    await logEvent(t, ob.order_id, 'payment_declared', actor, scope.merchantId ?? null, { kind: ob.kind });
    await touch(t, { id: ob.order_id, courier_id: null, shop_owner_id: ob.owner_id }, 'payment');
    return { status: 'declared' };
  });
}

/**
 * Confirmation après contrôle du transfert réellement reçu, avec référence.
 * Admin : toutes obligations. Commerçant : uniquement la commande qui lui est payée (il voit son propre compte).
 * Le montant reçu doit être exactement celui de l'obligation (montant serveur, jamais celui envoyé par le client).
 */
export async function confirmPayment(ctx: Ctx, actor: 'admin' | 'merchant', actorId: string, obligationId: string,
  input: { method: PaymentMethod; reference: string; amountReceived: number }) {
  if (!input.reference?.trim()) throw bad('reference_required', 'Renseignez la référence du transfert reçu.');
  return tx(ctx.db, async (t) => {
    const ob = await one(t, `select po.*, s.owner_id from payment_obligations po join orders o on o.id = po.order_id join shops s on s.id = o.shop_id where po.id = $1 for update of po`, [obligationId]);
    if (!ob) throw notFound('Paiement introuvable.');
    if (actor === 'merchant' && (ob.owner_id !== actorId || ob.payee !== 'merchant')) throw notFound('Paiement introuvable.');
    if (ob.status === 'confirmed') throw conflict('already_confirmed', 'Paiement déjà confirmé.');
    if (!['due', 'declared', 'rejected'].includes(ob.status)) throw conflict('obligation_closed', 'Ce paiement est annulé.');
    if (input.amountReceived !== ob.amount) throw conflict('amount_mismatch', `Montant attendu : ${ob.amount} FCFA. Ne confirmez pas un montant différent ; signalez l’écart.`, { expected: ob.amount });
    try {
      await t.query(`update payment_obligations set status='confirmed', method=$2, reference=$3, confirmed_by=$4, confirmed_at=now() where id=$1`,
        [ob.id, input.method, input.reference.trim(), actorId]);
    } catch (e) {
      if (isUnique(e)) throw conflict('reference_used', 'Cette référence de transfert a déjà servi à confirmer un autre paiement.');
      throw e;
    }
    await t.query(`update payment_proofs set status='accepted' where obligation_id=$1 and status='to_review'`, [ob.id]);
    await logEvent(t, ob.order_id, 'payment_confirmed', actor, actorId, { kind: ob.kind });
    await audit(t, actorId, actor, 'payment.confirm', 'payment_obligation', ob.id, { method: input.method });
    await touch(t, { id: ob.order_id, courier_id: null, shop_owner_id: ob.owner_id }, 'payment');
    return { status: 'confirmed' };
  });
}

export async function rejectPayment(ctx: Ctx, actor: 'admin' | 'merchant', actorId: string, obligationId: string, note: string) {
  if (!note?.trim()) throw bad('note_required', 'Expliquez pourquoi le justificatif est refusé.');
  return tx(ctx.db, async (t) => {
    const ob = await one(t, `select po.*, s.owner_id from payment_obligations po join orders o on o.id = po.order_id join shops s on s.id = o.shop_id where po.id = $1 for update of po`, [obligationId]);
    if (!ob) throw notFound('Paiement introuvable.');
    if (actor === 'merchant' && (ob.owner_id !== actorId || ob.payee !== 'merchant')) throw notFound('Paiement introuvable.');
    if (ob.status !== 'declared') throw conflict('invalid_status', 'Seul un paiement déclaré peut être refusé.');
    await t.query(`update payment_obligations set status='rejected' where id=$1`, [ob.id]);
    await t.query(`update payment_proofs set status='rejected', review_note=$2 where obligation_id=$1 and status='to_review'`, [ob.id, note.trim()]);
    await logEvent(t, ob.order_id, 'payment_rejected', actor, actorId, { kind: ob.kind });
    await audit(t, actorId, actor, 'payment.reject', 'payment_obligation', ob.id, { note });
    await touch(t, { id: ob.order_id, courier_id: null, shop_owner_id: ob.owner_id }, 'payment');
  });
}

/** Reversement : regroupe tous les gains en attente d'un livreur. `expectedAmount` évite de reverser un total différent de celui affiché. */
export async function createPayout(ctx: Ctx, adminId: string, courierId: string, input: { method: PaymentMethod; reference: string; expectedAmount: number }) {
  if (!input.reference?.trim()) throw bad('reference_required', 'Renseignez la référence du transfert effectué.');
  return tx(ctx.db, async (t) => {
    await t.query('select 1 from courier_profiles where user_id = $1 for update', [courierId]);
    const s = await one(t, `select coalesce(sum(amount),0)::int as total, count(*)::int as n from earnings where courier_id=$1 and status='pending'`, [courierId]);
    if (s.n === 0 || s.total <= 0) throw conflict('nothing_to_pay', 'Aucun gain à reverser.');
    if (s.total !== input.expectedAmount) throw conflict('amount_changed', 'Le solde a changé. Rechargez avant de reverser.', { total: s.total });
    let p;
    try {
      p = await one(t, `insert into payouts(courier_id, amount, method, reference, created_by) values ($1,$2,$3,$4,$5) returning *`,
        [courierId, s.total, input.method, input.reference.trim(), adminId]);
    } catch (e) {
      if (isUnique(e)) throw conflict('reference_used', 'Cette référence de transfert est déjà enregistrée.');
      throw e;
    }
    await t.query(`update earnings set status='paid', payout_id=$2 where courier_id=$1 and status='pending'`, [courierId, p.id]);
    await audit(t, adminId, 'admin', 'payout.create', 'payout', p.id, { amount: s.total });
    return p;
  });
}

export async function addAdjustment(ctx: Ctx, adminId: string, courierId: string, amount: number, note: string, orderId?: string) {
  if (!Number.isInteger(amount) || amount === 0) throw bad('invalid_amount', 'Montant entier non nul requis.');
  if (!note?.trim()) throw bad('note_required', 'Motif obligatoire.');
  return tx(ctx.db, async (t) => {
    const e = await one(t, `insert into earnings(courier_id, order_id, kind, amount, note, created_by) values ($1,$2,'adjustment',$3,$4,$5) returning *`,
      [courierId, orderId ?? null, amount, note.trim(), adminId]);
    await audit(t, adminId, 'admin', 'earning.adjust', 'earning', e.id, { amount, note });
    return e;
  });
}
