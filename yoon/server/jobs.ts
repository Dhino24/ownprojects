import { many, one, type Q } from './db.js';
import { expireOffers } from './domain/dispatch.js';
import { dailyRecap } from './domain/recap.js';
import { prepareMessage } from './domain/notify.js';
import type { Ctx } from './domain/core.js';
import { dakarDate, dakarHour } from './lib/time.js';

/** Exécute une tâche une seule fois pour une clé donnée (rejouable sans doublon). */
export async function runOnce(q: Q, key: string, fn: () => Promise<unknown>): Promise<boolean> {
  const claimed = await one(q, 'insert into job_runs(key) values ($1) on conflict do nothing returning key', [key]);
  if (!claimed) return false;
  try {
    const result = await fn();
    await q.query('update job_runs set finished_at = now(), result = $2 where key = $1', [key, JSON.stringify(result ?? null)]);
  } catch (e) {
    await q.query('delete from job_runs where key = $1', [key]); // libère la clé pour un nouvel essai
    throw e;
  }
  return true;
}

/** Prépare les récaps WhatsApp du jour pour commerçants et livreurs actifs. */
export async function prepareDailyRecaps(ctx: Ctx, date: string) {
  return runOnce(ctx.db, `daily_recap:${date}`, async () => {
    const shops = await many(ctx.db, 'select s.id, s.phone from shops s');
    let n = 0;
    for (const s of shops) {
      const r = await dailyRecap(ctx.db, date, { shopId: s.id });
      if (!r.totals.delivered && !r.received) continue;
      await prepareMessage(ctx, ctx.db, { orderId: null, template: 'daily_recap', recipientKind: 'merchant', phone: s.phone,
        vars: { date, nombre: r.totals.delivered, montant: r.received }, dedupeKey: `recap:${date}:shop:${s.id}` });
      n++;
    }
    const couriers = await many(ctx.db, `select u.id, u.phone from users u where u.role = 'courier'`);
    for (const c of couriers) {
      const r = await dailyRecap(ctx.db, date, { courierId: c.id });
      const me = r.byCourier[0];
      if (!me || (!me.delivered && !me.earned)) continue;
      await prepareMessage(ctx, ctx.db, { orderId: null, template: 'daily_recap', recipientKind: 'courier', phone: c.phone,
        vars: { date, nombre: me.delivered, montant: me.earned }, dedupeKey: `recap:${date}:courier:${c.id}` });
      n++;
    }
    return { messages: n };
  });
}

/** Purge des médias au-delà de la durée de conservation, pour les livraisons terminées. */
export async function purgeMedia(ctx: Ctx) {
  const rows = await many(ctx.db,
    `select m.id, m.storage_key from media m left join orders o on o.id = m.order_id
     where m.deleted_at is null and m.created_at < now() - make_interval(days => $1) and (o.id is null or o.status in ('delivered','cancelled'))`,
    [ctx.cfg.MEDIA_RETENTION_DAYS]);
  for (const r of rows) {
    await ctx.adapters.storage.remove(r.storage_key);
    await ctx.db.query('update media set deleted_at = now() where id = $1', [r.id]);
  }
  return rows.length;
}

export function startJobs(ctx: Ctx, log: { error: (o: object, m: string) => void }) {
  const timers: NodeJS.Timeout[] = [];
  // Les offres échues sont aussi expirées à la lecture ; ce balayage garantit l'état même sans trafic.
  timers.push(setInterval(() => expireOffers(ctx.db).catch((e) => log.error({ err: e }, 'expireOffers')), 2000));
  timers.push(setInterval(async () => {
    try {
      const now = new Date();
      if (dakarHour(now) >= ctx.cfg.RECAP_HOUR_DAKAR) await prepareDailyRecaps(ctx, dakarDate(now));
      await runOnce(ctx.db, `purge_media:${dakarDate(now)}`, () => purgeMedia(ctx));
    } catch (e) {
      log.error({ err: e }, 'daily jobs');
    }
  }, 60_000));
  return () => timers.forEach(clearInterval);
}
