import type { FastifyReply, FastifyRequest } from 'fastify';
import { one, type Q } from './db.js';
import { randomToken, sha256 } from './lib/crypto.js';
import { AppError } from './lib/errors.js';
import type { Role } from '../shared/contract.js';
import type { Ctx } from './domain/core.js';
import { resolveClientToken } from './domain/orders.js';

export const SESSION_COOKIE = 'yoon_sid';
export type SessionUser = { id: string; name: string; phone: string; role: Role };

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
    clientOrderId?: string;
  }
}

export async function createSession(ctx: Ctx, reply: FastifyReply, userId: string) {
  const token = randomToken(32);
  await ctx.db.query(`insert into sessions(token_hash, user_id, expires_at) values ($1,$2, now() + make_interval(days => $3))`,
    [sha256(token), userId, ctx.cfg.SESSION_TTL_DAYS]);
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: ctx.cfg.NODE_ENV === 'production' || ctx.cfg.PUBLIC_URL.startsWith('https://'), path: '/', maxAge: ctx.cfg.SESSION_TTL_DAYS * 86400,
  });
}

export async function loadSession(q: Q, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const s = await one(q,
    `select u.id, u.name, u.phone, u.role, s.expires_at < now() as expired, s.revoked_at, u.status
     from sessions s join users u on u.id = s.user_id where s.token_hash = $1`, [sha256(token)]);
  if (!s) return null;
  if (s.expired || s.revoked_at) throw new AppError(401, 'session_expired', 'Votre session a expiré. Reconnectez-vous.');
  if (s.status !== 'active') throw new AppError(403, 'account_suspended', 'Compte suspendu. Contactez l’équipe.');
  return { id: s.id, name: s.name, phone: s.phone, role: s.role };
}

export async function revokeSession(q: Q, token: string | undefined) {
  if (token) await q.query('update sessions set revoked_at = now() where token_hash = $1', [sha256(token)]);
}

/** Garde de rôle : vérifiée côté serveur à chaque requête. */
export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest) => {
    if (!req.user) throw new AppError(401, 'unauthenticated', 'Connectez-vous pour continuer.');
    if (!roles.includes(req.user.role)) throw new AppError(403, 'forbidden', 'Accès réservé.');
  };
}

/** Accès client : jeton opaque transmis dans l'en-tête X-Client-Token, limité à une seule livraison. */
export function requireClient(ctx: Ctx) {
  return async (req: FastifyRequest) => {
    const token = req.headers['x-client-token'];
    req.clientOrderId = await resolveClientToken(ctx.db, typeof token === 'string' ? token : '');
  };
}
