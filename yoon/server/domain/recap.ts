import { type Q, many, one } from '../db.js';

const DAY = `(x at time zone 'Africa/Dakar')::date = $1::date`;
const day = (col: string) => DAY.replace('x', col);

/** Récapitulatif quotidien (fuseau Africa/Dakar). `shopId` ou `courierId` restreignent la vue. */
export async function dailyRecap(q: Q, date: string, scope: { shopId?: string; courierId?: string } = {}) {
  const shopFilter = scope.shopId ? 'and o.shop_id = $2' : scope.courierId ? 'and o.courier_id = $2' : '';
  const params = scope.shopId ? [date, scope.shopId] : scope.courierId ? [date, scope.courierId] : [date];
  const totals = await one(
    q,
    `select
       count(*) filter (where ${day('o.created_at')})::int as created,
       count(*) filter (where o.status = 'delivered' and ${day('o.delivered_at')})::int as delivered,
       count(*) filter (where o.status = 'cancelled' and ${day('o.cancelled_at')})::int as cancelled,
       coalesce(sum(o.delivery_price) filter (where o.status = 'delivered' and ${day('o.delivered_at')}),0)::int as delivery_fees,
       coalesce(sum(o.commission) filter (where o.status = 'delivered' and ${day('o.delivered_at')}),0)::int as commission,
       coalesce(sum(o.courier_earning) filter (where o.status = 'delivered' and ${day('o.delivered_at')}),0)::int as courier_share
     from orders o where true ${shopFilter}`,
    params,
  );
  const payments = await many(
    q,
    `select po.kind, po.payee, po.status, coalesce(po.method,'') as method, count(*)::int as n, coalesce(sum(po.amount),0)::int as amount
     from payment_obligations po join orders o on o.id = po.order_id
     where (${day('po.confirmed_at')} or (po.status in ('due','declared','rejected') and ${day('o.created_at')})) ${shopFilter}
     group by 1,2,3,4 order by 1,2,3`,
    params,
  );
  const received = payments.filter((p) => p.status === 'confirmed').reduce((s, p) => s + p.amount, 0);
  const unconfirmed = payments.filter((p) => p.status !== 'confirmed').reduce((s, p) => s + p.n, 0);
  let byShop: any[] = [], byCourier: any[] = [];
  if (!scope.shopId && !scope.courierId) {
    byShop = await many(q,
      `select s.id, s.name, count(*) filter (where o.status='delivered' and ${day('o.delivered_at')})::int as delivered,
         coalesce(sum(o.delivery_price) filter (where o.status='delivered' and ${day('o.delivered_at')}),0)::int as delivery_fees
       from shops s left join orders o on o.shop_id = s.id group by s.id, s.name having count(*) filter (where ${day('o.created_at')} or ${day('o.delivered_at')}) > 0 order by s.name`, [date]);
  }
  if (!scope.shopId) {
    byCourier = await many(q,
      `select u.id, u.name,
         (select count(*) from orders o where o.courier_id = u.id and o.status='delivered' and ${day('o.delivered_at')})::int as delivered,
         (select coalesce(sum(e.amount),0) from earnings e where e.courier_id = u.id and ${day('e.created_at')})::int as earned,
         (select coalesce(sum(e.amount),0) from earnings e where e.courier_id = u.id and e.status = 'pending')::int as balance,
         (select coalesce(sum(p.amount),0) from payouts p where p.courier_id = u.id and ${day('p.created_at')})::int as paid_out
       from users u where u.role = 'courier' ${scope.courierId ? 'and u.id = $2' : ''} order by u.name`, params);
    byCourier = byCourier.filter((c) => scope.courierId || c.delivered || c.earned || c.paid_out);
  }
  return { date, totals, payments, received, unconfirmed, byShop, byCourier };
}

/** Lignes CSV : livraisons du jour avec statuts séparés. Pas de code ni coordonnées. */
export async function recapCsv(q: Q, date: string): Promise<string> {
  const rows = await many(
    q,
    `select o.ref, s.name as boutique, zf.name as zone_retrait, zt.name as zone_livraison, o.status as statut_livraison,
       o.delivery_payer as payeur_course, o.delivery_price as prix_course, o.courier_earning as gain_livreur, o.commission,
       o.order_amount as montant_commande,
       (select status from payment_obligations where order_id = o.id and kind = 'order_amount') as paiement_commande,
       (select status from payment_obligations where order_id = o.id and kind = 'delivery_fee') as paiement_course,
       (select status from earnings where order_id = o.id and kind = 'delivery') as reversement,
       u.name as livreur,
       to_char(o.created_at at time zone 'Africa/Dakar', 'YYYY-MM-DD HH24:MI') as creee,
       to_char(o.delivered_at at time zone 'Africa/Dakar', 'YYYY-MM-DD HH24:MI') as livree
     from orders o join shops s on s.id = o.shop_id join zones zf on zf.id = o.pickup_zone_id join zones zt on zt.id = o.dest_zone_id
     left join users u on u.id = o.courier_id
     where ${day('o.created_at')} or ${day('o.delivered_at')} or ${day('o.cancelled_at')} order by o.created_at`,
    [date],
  );
  const cols = ['ref', 'boutique', 'zone_retrait', 'zone_livraison', 'statut_livraison', 'payeur_course', 'prix_course', 'gain_livreur', 'commission',
    'montant_commande', 'paiement_commande', 'paiement_course', 'reversement', 'livreur', 'creee', 'livree'];
  const esc = (v: unknown) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // neutralise les formules tableur
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\n') + '\n';
}
