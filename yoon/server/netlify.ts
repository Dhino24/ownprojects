// Adaptateur Netlify Functions : la même API Fastify, servie requête par requête (pas de serveur permanent).
// Base : Netlify Database (PostgreSQL). Médias : Netlify Blobs. Temps réel : rafraîchissement périodique.
import type { FastifyInstance } from 'fastify';
import { loadConfig } from './config.js';
import { createDb, migrate } from './db.js';
import { buildApp } from './app.js';
import { MIGRATIONS } from './migrations.generated.js';
import { expireOffers } from './domain/dispatch.js';
import { seedDemo } from './seed.js';
import type { Ctx } from './domain/core.js';

let ready: Promise<{ app: FastifyInstance; ctx: Ctx }> | null = null;
let lastSweep = 0;

async function connectionString(): Promise<string> {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const { getConnectionString } = await import('@netlify/database');
  return getConnectionString();
}

async function init() {
  const cfg = loadConfig({
    ...process.env,
    // Environnement de démonstration explicite (DEMO_MODE) ; sinon règles de production.
    NODE_ENV: process.env.DEMO_MODE === 'true' ? 'development' : 'production',
    DATABASE_URL: await connectionString(),
    PUBLIC_URL: process.env.PUBLIC_URL ?? process.env.URL, // URL du site fournie par Netlify
    LIVE_SSE: 'false',
    JOBS_ENABLED: 'false',
    MEDIA_STORAGE: 'netlify_blobs',
    TRUST_PROXY: 'true',
  });
  const db = createDb(cfg.DATABASE_URL, 3);
  await migrate(db, MIGRATIONS);
  const { app, ctx } = await buildApp(cfg, db, { logger: false });
  if (cfg.DEMO_MODE) {
    // Verrou : plusieurs instances froides peuvent démarrer en même temps.
    const c = await db.connect();
    try {
      await c.query('select pg_advisory_lock(424243)');
      await seedDemo(ctx);
    } finally {
      await c.query('select pg_advisory_unlock(424243)').catch(() => {});
      c.release();
    }
  }
  await app.ready();
  return { app, ctx };
}

export async function handle(req: Request, ip?: string): Promise<Response> {
  ready ??= init().catch((e) => {
    ready = null;
    throw e;
  });
  const { app, ctx } = await ready;
  // Pas de tâche de fond en serverless : les offres échues sont expirées au fil des requêtes (idempotent).
  if (Date.now() - lastSweep > 2000) {
    lastSweep = Date.now();
    await expireOffers(ctx.db).catch(() => {});
  }
  const url = new URL(req.url);
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { headers[k] = v; });
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.from(await req.arrayBuffer());
  const res = await app.inject({ method: req.method as any, url: url.pathname + url.search, headers, payload: body, remoteAddress: ip });
  const out = new Headers();
  for (const [k, v] of Object.entries(res.headers)) {
    if (v === undefined || k === 'content-length' || k === 'transfer-encoding' || k === 'connection') continue;
    if (Array.isArray(v)) v.forEach((x) => out.append(k, String(x)));
    else out.set(k, String(v));
  }
  return new Response(res.statusCode === 204 || req.method === 'HEAD' ? null : new Uint8Array(res.rawPayload), { status: res.statusCode, headers: out });
}
