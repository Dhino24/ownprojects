import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { createAdapters, type Adapters } from './adapters/index.js';
import { AppError } from './lib/errors.js';
import { SESSION_COOKIE, loadSession } from './auth.js';
import type { Ctx } from './domain/core.js';
import { LiveBus } from './events.js';
import { authRoutes } from './routes/auth.js';
import { merchantRoutes } from './routes/merchant.js';
import { clientRoutes } from './routes/client.js';
import { courierRoutes } from './routes/courier.js';
import { adminRoutes } from './routes/admin.js';
import { commonRoutes } from './routes/common.js';

export async function buildApp(cfg: Config, db: Db, opts: { adapters?: Adapters; bus?: LiveBus; logger?: boolean } = {}) {
  const app = Fastify({
    trustProxy: cfg.TRUST_PROXY,
    bodyLimit: 512 * 1024,
    logger: opts.logger === false ? false : {
      level: cfg.NODE_ENV === 'production' ? 'info' : 'warn',
      // Aucun téléphone, code, jeton ni coordonnée dans les journaux.
      redact: ['req.headers.cookie', 'req.headers["x-client-token"]', 'req.headers.authorization'],
      serializers: { req: (r) => ({ method: r.method, url: String(r.url).split('?')[0] }) },
    },
  });
  const ctx: Ctx = { cfg, db, adapters: opts.adapters ?? createAdapters(cfg) };
  const bus = opts.bus ?? new LiveBus();

  await app.register(cookie);
  await app.register(multipart);
  // Limitation de débit sur l'API seulement. Beaucoup d'abonnés mobiles partagent une IP (CGNAT) :
  // la clé est la session, le jeton client ou le numéro saisi, et l'IP seulement à défaut.
  await app.register(rateLimit, {
    max: 600, timeWindow: '1 minute', hook: 'preHandler',
    allowList: (req) => cfg.NODE_ENV === 'test' || !req.url.startsWith('/api/'),
    keyGenerator: (req) => {
      const sid = req.cookies?.[SESSION_COOKIE];
      const ct = req.headers['x-client-token'];
      const phone = (req.body as any)?.phone;
      if (sid) return `s:${sid.slice(0, 16)}`;
      if (typeof ct === 'string' && ct) return `c:${ct.slice(0, 16)}`;
      if (typeof phone === 'string') return `p:${req.ip}:${phone.replace(/\D/g, '').slice(-9)}`;
      return `ip:${req.ip}`;
    },
  });

  const allowedOrigin = new URL(cfg.PUBLIC_URL).origin;
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff').header('referrer-policy', 'no-referrer').header('x-frame-options', 'DENY');
    // Protection CSRF : en plus du cookie SameSite=Lax, toute écriture venant d'un navigateur doit provenir de notre origine.
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin && req.headers.origin !== allowedOrigin) {
      throw new AppError(403, 'bad_origin', 'Origine non autorisée.');
    }
    if (req.url.startsWith('/api/')) {
      reply.header('cache-control', 'no-store');
      req.user = (await loadSession(db, req.cookies[SESSION_COOKIE])) ?? undefined;
    }
  });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send({ error: err.code, message: err.message, details: err.details });
    if (err.statusCode === 429) return reply.code(429).send({ error: 'rate_limited', message: 'Trop de tentatives. Patientez une minute.' });
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(400).send({ error: 'file_too_large', message: 'Fichier trop lourd.' });
    if (err.code === '23505') return reply.code(409).send({ error: 'conflict', message: 'Action déjà effectuée ou en conflit. Rechargez la page.' });
    if (err.validation || err.statusCode === 400) return reply.code(400).send({ error: 'bad_request', message: 'Requête invalide.' });
    req.log.error({ err }, 'erreur serveur');
    return reply.code(500).send({ error: 'server_error', message: 'Erreur du serveur. Réessayez dans un instant.' });
  });

  app.get('/api/health', async () => {
    await db.query('select 1');
    return { ok: true };
  });

  await authRoutes(app, ctx);
  await merchantRoutes(app, ctx);
  await clientRoutes(app, ctx);
  await courierRoutes(app, ctx);
  await adminRoutes(app, ctx);
  await commonRoutes(app, ctx, bus);

  const webDist = path.resolve('dist-web');
  if (cfg.SERVE_WEB && existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found', message: 'Introuvable.' });
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    });
  }

  return { app, ctx, bus };
}
