import { z } from 'zod';
import { bad } from '../lib/errors.js';
import { sign } from '../lib/crypto.js';
import type { Ctx } from '../domain/core.js';
import { POSITION_STALE_SECONDS } from '../../shared/contract.js';

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const first = r.error.issues[0];
    throw bad('validation', `Champ invalide : ${first.path.join('.') || 'requête'} (${first.message}).`, r.error.issues);
  }
  return r.data;
}

export const uuid = z.string().uuid();
export const money = z.number().int().min(0).max(10_000_000);
export const method = z.enum(['wave', 'orange_money']);

/** URL temporaire signée (10 min) pour un média privé. */
export function mediaUrl(ctx: Ctx, id: string | null | undefined, ttlSec = 600) {
  if (!id) return null;
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  return `/api/media/${id}?e=${exp}&s=${sign(ctx.cfg.APP_SECRET, `${id}.${exp}`)}`;
}

export function positionInfo(lat: number | null, lng: number | null, at: Date | string | null) {
  if (lat == null || lng == null || !at) return null;
  const ageSec = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 1000));
  return { lat, lng, at, ageSec, stale: ageSec > POSITION_STALE_SECONDS };
}

export function locationView(ctx: Ctx, loc: any) {
  if (!loc) return null;
  return { source: loc.source, lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy, landmark: loc.landmark, at: loc.created_at,
    photoUrl: mediaUrl(ctx, loc.photo_media_id), voiceUrl: mediaUrl(ctx, loc.voice_media_id) };
}
