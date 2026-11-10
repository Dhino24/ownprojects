import type { Ctx } from './domain/core.js';
import { many, one } from './db.js';
import { hashPassword } from './lib/crypto.js';
import { createOrder, submitLocation } from './domain/orders.js';

/**
 * Données de DÉMONSTRATION, distinctes de la configuration réelle :
 * grille tarifaire marquée is_demo, comptes et numéros fictifs. Interdit en production.
 */
export const DEMO_PASSWORD = 'yoon-demo-2026';
export const DEMO_ACCOUNTS = {
  admin: { phone: '+221770000001', name: 'Awa Admin' },
  merchant: { phone: '+221770000010', name: 'Adama Fall' },
  merchant2: { phone: '+221770000011', name: 'Khady Sow' },
  courier: { phone: '+221770000020', name: 'Mamadou Diouf' },
  courier2: { phone: '+221770000021', name: 'Ibrahima Fall' },
  courierPending: { phone: '+221770000022', name: 'Cheikh Ba' },
};
const PILOT_ZONES = ['Mermoz – Sacré-Cœur', 'Ouakam', 'Point E – Fann – Amitié', 'Almadies – Ngor', 'Sicap-Liberté', 'Pikine', 'Guédiawaye', 'Keur Massar', 'Rufisque'];

export async function seedDemo(ctx: Ctx, opts: { orders?: boolean } = { orders: true }) {
  if (ctx.cfg.NODE_ENV === 'production') throw new Error('Seed de démonstration interdit en production.');
  const db = ctx.db;
  if (await one(db, 'select 1 from users where phone = $1', [DEMO_ACCOUNTS.admin.phone])) return { skipped: true };

  await db.query('update zones set active = true where name = any($1)', [PILOT_ZONES]);
  const zones = await many(db, 'select id, name, department from zones where active');
  const z = (n: string) => zones.find((x) => x.name === n)!.id as number;

  // Exemples inspirés de la maquette : NON validés, à remplacer après l'observation terrain.
  const v = await one(db, `insert into pricing_versions(note, courier_share_bps, cancel_fee, cancel_courier_share_bps, not_found_fee, not_found_wait_minutes, is_demo, active)
    values ('DÉMO — tarifs d’exemple non validés', 8000, 500, 10000, 1000, 10, true, true) returning id`);
  const near = new Set(['Dakar']);
  for (const a of zones) for (const b of zones) {
    let price = 1500;
    if (a.id === b.id) price = 1000;
    else if (near.has(a.department) && near.has(b.department)) price = 1500;
    else if ([a.department, b.department].includes('Rufisque')) price = 4000;
    else if ([a.department, b.department].includes('Keur Massar')) price = 3500;
    else price = 2500;
    await db.query('insert into pricing_pairs(version_id, from_zone_id, to_zone_id, price) values ($1,$2,$3,$4)', [v.id, a.id, b.id, price]);
  }
  await db.query(`insert into app_settings(key, value) values ('service_payment_numbers', $1), ('require_fee_before_offer', 'false') on conflict do nothing`,
    [JSON.stringify({ wave: '+221770009999', orange_money: '+221780009999' })]);

  const hash = await hashPassword(DEMO_PASSWORD);
  const mk = async (a: { phone: string; name: string }, role: string) =>
    (await one(db, 'insert into users(phone, name, role, password_hash) values ($1,$2,$3,$4) returning id', [a.phone, a.name, role, hash])).id as string;
  const admin = await mk(DEMO_ACCOUNTS.admin, 'admin');
  const m1 = await mk(DEMO_ACCOUNTS.merchant, 'merchant');
  const m2 = await mk(DEMO_ACCOUNTS.merchant2, 'merchant');
  await db.query(`insert into shops(owner_id, name, phone, zone_id, pickup_address, wave_number, orange_money_number, pickup_lat, pickup_lng) values
    ($1,'Boutique Adama',$2,$3,'Mermoz, en face de la station',$2,'+221780000010',14.7095,-17.4745),
    ($4,'Chez Khady',$5,$6,'Sicap Liberté 6, villa 12',$5,null,14.7182,-17.4621)`,
    [m1, DEMO_ACCOUNTS.merchant.phone, z('Mermoz – Sacré-Cœur'), m2, DEMO_ACCOUNTS.merchant2.phone, z('Sicap-Liberté')]);
  const c1 = await mk(DEMO_ACCOUNTS.courier, 'courier');
  const c2 = await mk(DEMO_ACCOUNTS.courier2, 'courier');
  const c3 = await mk(DEMO_ACCOUNTS.courierPending, 'courier');
  await db.query(`insert into courier_profiles(user_id, status, home_zone_id, available, approved_by, approved_at, payout_method, payout_number) values
    ($1,'approved',$4,false,$5,now(),'wave','+221770000020'), ($2,'approved',$6,false,$5,now(),'orange_money','+221780000021'), ($3,'pending',$4,false,null,null,null,null)`,
    [c1, c2, c3, z('Mermoz – Sacré-Cœur'), admin, z('Ouakam')]);

  if (opts.orders) {
    const base = { pickupAddress: 'Mermoz, en face de la station', pickupZoneId: z('Mermoz – Sacré-Cœur') };
    const price = async (to: string) => (await one(db, 'select price from pricing_pairs where version_id = $1 and from_zone_id = $2 and to_zone_id = $3', [v.id, base.pickupZoneId, z(to)])).price;
    const o1 = await createOrder(ctx, m1, { ...base, customerName: 'Aïssatou Diop', customerPhone: '+221770000030', orderAmount: 12500, destZoneId: z('Ouakam'),
      destHint: 'Cité Avion', deliveryPayer: 'customer', expectedPrice: await price('Ouakam') });
    await submitLocation(ctx, o1.orderId, 'customer', null, { source: 'map', lat: 14.7262, lng: -17.4895, landmark: 'Portail vert, en face de la pharmacie (démo)' });
    await createOrder(ctx, m1, { ...base, customerName: 'Moussa Ba', customerPhone: '+221770000031', orderAmount: 8000, destZoneId: z('Almadies – Ngor'),
      deliveryPayer: 'merchant', expectedPrice: await price('Almadies – Ngor') });
  }
  return { skipped: false };
}
