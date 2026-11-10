import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// count/sum renvoyés en nombre : les montants FCFA restent très inférieurs à 2^53.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
export type Q = Db | Tx;

export function createDb(url: string): Db {
  return new pg.Pool({ connectionString: url, max: 10 });
}

export async function one<T = any>(q: Q, sql: string, params: unknown[] = []): Promise<T | undefined> {
  const r = await q.query(sql, params);
  return r.rows[0] as T | undefined;
}
export async function many<T = any>(q: Q, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await q.query(sql, params)).rows as T[];
}

export async function tx<T>(db: Db, fn: (t: Tx) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

function migrationsDir() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // En build (dist-server/server), les .sql restent dans server/migrations.
  return here.includes('dist-server') ? path.resolve(here, '../../server/migrations') : path.join(here, 'migrations');
}

export async function migrate(db: Db): Promise<string[]> {
  const c = await db.connect();
  try {
    await c.query('select pg_advisory_lock(424242)');
    await c.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    const done = new Set((await many(c, 'select name from schema_migrations')).map((r) => r.name));
    const dir = migrationsDir();
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    const applied: string[] = [];
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(path.join(dir, f), 'utf8');
      await c.query('begin');
      try {
        await c.query(sql);
        await c.query('insert into schema_migrations(name) values ($1)', [f]);
        await c.query('commit');
      } catch (e) {
        await c.query('rollback');
        throw e;
      }
      applied.push(f);
    }
    return applied;
  } finally {
    await c.query('select pg_advisory_unlock(424242)').catch(() => {});
    c.release();
  }
}
