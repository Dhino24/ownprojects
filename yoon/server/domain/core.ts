import type { Config } from '../config.js';
import type { Adapters } from '../adapters/index.js';
import { type Db, type Q, one } from '../db.js';
import { publish } from '../events.js';
import { TRANSITIONS, type Actor, type OrderStatus } from '../../shared/contract.js';
import { AppError, conflict, notFound } from '../lib/errors.js';

export type Ctx = { cfg: Config; db: Db; adapters: Adapters };

export type OrderRow = {
  id: string; ref: string; shop_id: string; customer_name: string; customer_phone: string; order_amount: number;
  pickup_zone_id: number; pickup_address: string; dest_zone_id: number; dest_hint: string;
  delivery_payer: 'merchant' | 'customer'; pricing_version_id: number; delivery_price: number; courier_earning: number;
  commission: number; status: OrderStatus; incident_resume_status: OrderStatus | null; courier_id: string | null;
  created_at: Date; updated_at: Date; delivered_at: Date | null; cancelled_at: Date | null; shop_owner_id?: string;
};

export async function lockOrder(q: Q, id: string): Promise<OrderRow> {
  const o = await one<OrderRow>(
    q,
    `select o.*, s.owner_id as shop_owner_id from orders o join shops s on s.id = o.shop_id where o.id = $1 for update of o`,
    [id],
  );
  if (!o) throw notFound('Livraison introuvable.');
  return o;
}

export async function logEvent(q: Q, orderId: string, type: string, actor: Actor, actorId: string | null, data: object = {}) {
  await q.query('insert into delivery_events(order_id, type, actor, actor_id, data) values ($1,$2,$3,$4,$5)', [orderId, type, actor, actorId, data]);
}

export async function audit(q: Q, actorId: string | null, actor: Actor, action: string, entity: string, entityId: string | null, data: object = {}) {
  await q.query('insert into audit_log(actor_id, actor, action, entity, entity_id, data) values ($1,$2,$3,$4,$5,$6)', [actorId, actor, action, entity, entityId, data]);
}

export async function touch(q: Q, o: Pick<OrderRow, 'id' | 'courier_id'> & { shop_owner_id?: string }, kind = 'order') {
  const users = [o.shop_owner_id, o.courier_id].filter(Boolean) as string[];
  await publish(q, { orderId: o.id, users, kind });
}

/** Applique une transition du contrat partagé, ou refuse avec un message clair. */
export async function transition(q: Q, o: OrderRow, name: keyof typeof TRANSITIONS, actor: Actor, actorId: string | null, data: object = {}, to?: OrderStatus) {
  const t = TRANSITIONS[name];
  if (!t.actors.includes(actor)) throw new AppError(403, 'forbidden', 'Action non autorisée pour ce rôle.');
  if (!t.from.includes(o.status)) throw conflict('invalid_status', `Action impossible : la livraison est « ${o.status} ».`, { status: o.status });
  const target = to ?? t.to;
  const extra = target === 'delivered' ? ', delivered_at = now()' : target === 'cancelled' ? ', cancelled_at = now()' : '';
  await q.query(`update orders set status = $2, updated_at = now()${extra} where id = $1`, [o.id, target]);
  await logEvent(q, o.id, name, actor, actorId, { from: o.status, to: target, ...data });
  o.status = target;
  await touch(q, o);
}

export async function getSetting<T>(q: Q, key: string, fallback: T): Promise<T> {
  const r = await one<{ value: T }>(q, 'select value from app_settings where key = $1', [key]);
  return r ? r.value : fallback;
}

export const DAKAR_BOUNDS = { minLat: 14.55, maxLat: 14.95, minLng: -17.6, maxLng: -17.0 };
export function inDakar(lat: number, lng: number) {
  return lat >= DAKAR_BOUNDS.minLat && lat <= DAKAR_BOUNDS.maxLat && lng >= DAKAR_BOUNDS.minLng && lng <= DAKAR_BOUNDS.maxLng;
}

export const bps = (amount: number, b: number) => Math.floor((amount * b) / 10000);
