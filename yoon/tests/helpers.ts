import { loadConfig } from '../server/config.js';
import { createDb, migrate, one } from '../server/db.js';
import { buildApp } from '../server/app.js';
import { createAdapters } from '../server/adapters/index.js';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, seedDemo } from '../server/seed.js';
import path from 'node:path';
import os from 'node:os';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://yoon:yoon@localhost:5432/yoon_test';

export async function setup(env: Record<string, string> = {}) {
  const cfg = loadConfig({ NODE_ENV: 'test', DATABASE_URL: TEST_DB, STORAGE_DIR: path.join(os.tmpdir(), 'yoon-test-media'), PUBLIC_URL: 'http://localhost:5173', ...env });
  const db = createDb(cfg.DATABASE_URL);
  await db.query('drop schema public cascade; create schema public;');
  await migrate(db);
  const { app, ctx } = await buildApp(cfg, db, { logger: false });
  await seedDemo(ctx, { orders: false });
  return { app, ctx, db, cfg, close: async () => { await app.close(); await db.end(); } };
}

export type T = Awaited<ReturnType<typeof setup>>;

export async function login(t: T, who: keyof typeof DEMO_ACCOUNTS) {
  const r = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { phone: DEMO_ACCOUNTS[who].phone, password: DEMO_PASSWORD } });
  if (r.statusCode !== 200) throw new Error(`login ${who}: ${r.body}`);
  const c = r.cookies.find((x) => x.name === 'yoon_sid')!;
  return `yoon_sid=${c.value}`;
}

export function api(t: T, auth: { cookie?: string; client?: string } = {}) {
  const call = async (method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) => {
    const h: Record<string, string> = { ...headers };
    if (auth.cookie) h.cookie = auth.cookie;
    if (auth.client) h['x-client-token'] = auth.client;
    const r = await t.app.inject({ method: method as any, url, payload: payload as any, headers: h });
    let body: any = r.body;
    try { body = JSON.parse(r.body); } catch { /* texte */ }
    return { status: r.statusCode, body };
  };
  return {
    get: (u: string) => call('GET', u),
    post: (u: string, p: unknown = {}, h?: Record<string, string>) => call('POST', u, p, h),
    put: (u: string, p: unknown) => call('PUT', u, p),
    patch: (u: string, p: unknown) => call('PATCH', u, p),
  };
}

export async function zoneId(t: T, name: string) {
  return (await one(t.db, 'select id from zones where name = $1', [name])).id as number;
}

export function multipart(fields: Record<string, string>, file: { name: string; data: Buffer; type: string }) {
  const boundary = '----yoontest' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

// Plus petit JPEG reconnu par la signature (le contenu n'est pas décodé côté serveur).
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1), Buffer.from([0xff, 0xd9])]);

export async function upload(t: T, auth: { cookie?: string; client?: string }, orderId: string, kind: string, data = JPEG, type = 'image/jpeg') {
  const m = multipart({ orderId, kind }, { name: 'f.jpg', data, type });
  const headers: Record<string, string> = { ...m.headers };
  if (auth.cookie) headers.cookie = auth.cookie;
  if (auth.client) headers['x-client-token'] = auth.client;
  const r = await t.app.inject({ method: 'POST', url: '/api/media', payload: m.payload, headers });
  return { status: r.statusCode, body: JSON.parse(r.body) };
}

/** Crée une livraison complète jusqu'à « position reçue ». */
export async function newOrder(t: T, merchant: string, opts: { payer?: 'merchant' | 'customer'; amount?: number; to?: string; locate?: boolean } = {}) {
  const m = api(t, { cookie: merchant });
  const pickupZoneId = await zoneId(t, 'Mermoz – Sacré-Cœur');
  const destZoneId = await zoneId(t, opts.to ?? 'Ouakam');
  const q = await m.post('/api/merchant/quote', { pickupZoneId, destZoneId });
  const r = await m.post('/api/merchant/orders', {
    customerName: 'Aïssatou Diop', customerPhone: '77 123 45 67', orderAmount: opts.amount ?? 12500, pickupAddress: 'Mermoz',
    pickupZoneId, destZoneId, deliveryPayer: opts.payer ?? 'customer', expectedPrice: q.body.price,
  });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  const token = String(r.body.clientUrl).split('#')[1];
  if (opts.locate !== false) {
    const c = await api(t, { client: token }).post('/api/client/location', { source: 'gps', lat: 14.7262, lng: -17.4895, accuracy: 20, landmark: 'Portail vert' });
    if (c.status !== 200) throw new Error(JSON.stringify(c.body));
  }
  return { orderId: r.body.orderId as string, token, price: q.body.price as number };
}

export async function availableCourier(t: T, who: 'courier' | 'courier2' = 'courier') {
  const cookie = await login(t, who);
  const c = api(t, { cookie });
  await c.post('/api/courier/availability', { available: true });
  await c.post('/api/courier/position', { lat: 14.71, lng: -17.47, accuracy: 15 });
  const id = (await one(t.db, 'select id from users where phone = $1', [DEMO_ACCOUNTS[who].phone])).id as string;
  return { cookie, c, id };
}
