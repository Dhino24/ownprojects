import { type Q, one, many } from '../db.js';
import { render, type TemplateKey } from '../messages.js';
import { conflict, notFound } from '../lib/errors.js';
import type { Ctx } from './core.js';

/** Prépare un message WhatsApp (mode manuel : lien prérempli, envoi par un humain). Idempotent via dedupeKey. */
export async function prepareMessage(
  ctx: Ctx, q: Q,
  m: { orderId: string | null; template: TemplateKey; recipientKind: 'customer' | 'merchant' | 'courier'; phone: string; vars: Record<string, string | number>; dedupeKey?: string },
) {
  const body = render(m.template, m.vars, 'fr');
  return one(
    q,
    `insert into notifications(order_id, template, recipient_kind, recipient_phone, body, channel, dedupe_key)
     values ($1,$2,$3,$4,$5,'whatsapp_manual',$6)
     on conflict (dedupe_key) do update set body = excluded.body, updated_at = now()
     returning *`,
    [m.orderId, m.template, m.recipientKind, m.phone, body, m.dedupeKey ?? null],
  );
}

export function withLink(ctx: Ctx, n: any) {
  return { ...n, wa_link: ctx.adapters.whatsapp.link(n.recipient_phone, n.body) };
}

export async function listForOrder(ctx: Ctx, q: Q, orderId: string, kinds: string[]) {
  const rows = await many(q, `select * from notifications where order_id = $1 and recipient_kind = any($2) order by created_at`, [orderId, kinds]);
  return rows.map((n) => withLink(ctx, n));
}

/** opened : lien ouvert (pas envoyé) · confirmed_sent : l'utilisateur confirme l'avoir envoyé. */
export async function markMessage(q: Q, id: string, status: 'opened' | 'confirmed_sent', allowedOrderIds: string[] | 'all') {
  const n = await one(q, 'select * from notifications where id = $1', [id]);
  if (!n) throw notFound('Message introuvable.');
  if (allowedOrderIds !== 'all' && !allowedOrderIds.includes(n.order_id)) throw notFound('Message introuvable.');
  if (status === 'opened' && n.status !== 'prepared') return n;
  if (status === 'confirmed_sent' && !['prepared', 'opened', 'confirmed_sent'].includes(n.status)) throw conflict('invalid_status', 'Statut du message incompatible.');
  return one(q, 'update notifications set status = $2, updated_at = now() where id = $1 returning *', [id, status]);
}
