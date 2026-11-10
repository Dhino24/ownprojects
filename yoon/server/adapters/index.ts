import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Config } from '../config.js';
import { waDigits } from '../lib/phone.js';

// ---------- WhatsApp ----------
// manual : l'application prépare un lien wa.me prérempli ; l'utilisateur l'ouvre et l'envoie lui-même.
// Ouvrir le lien ne marque JAMAIS le message comme envoyé : il faut une confirmation explicite.
export interface WhatsAppAdapter {
  mode: 'manual' | 'api';
  link(phone: string, body: string): string | null;
}
export const manualWhatsApp: WhatsAppAdapter = {
  mode: 'manual',
  link: (phone, body) => `https://wa.me/${waDigits(phone)}?text=${encodeURIComponent(body)}`,
};

// ---------- Paiements ----------
// Seul le mode manuel est actif : justificatif déposé = « à vérifier » ; l'admin confirme avec la référence.
// Les API Wave / Orange Money ne sont pas branchées (accès marchands non fournis).
export interface PaymentProvider {
  id: 'manual' | 'wave_api' | 'orange_money_api';
  enabled: boolean;
  reason?: string;
}
export const paymentProviders: PaymentProvider[] = [
  { id: 'manual', enabled: true },
  { id: 'wave_api', enabled: false, reason: 'Accès API marchand Wave non fourni.' },
  { id: 'orange_money_api', enabled: false, reason: 'Accès API marchand Orange Money non fourni.' },
];

// ---------- Médias (stockage privé) ----------
export interface MediaStorage {
  put(buf: Buffer, ext: string): Promise<string>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
export function localStorage(dir: string): MediaStorage {
  const root = path.resolve(dir);
  const full = (key: string) => {
    const p = path.resolve(root, key);
    if (!p.startsWith(root + path.sep)) throw new Error('clé de stockage invalide');
    return p;
  };
  return {
    async put(buf, ext) {
      const d = new Date();
      const key = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${ext}`;
      await mkdir(path.dirname(full(key)), { recursive: true });
      await writeFile(full(key), buf, { mode: 0o600 });
      return key;
    },
    get: (key) => readFile(full(key)),
    remove: (key) => unlink(full(key)).catch(() => {}),
  };
}

/** Détection du type réel par signature (on ne fait pas confiance au type déclaré). */
export function sniffMedia(buf: Buffer): { mime: string; ext: string; kind: 'image' | 'audio' } | null {
  const h = buf.subarray(0, 16);
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg', kind: 'image' };
  if (h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png', kind: 'image' };
  if (h.toString('ascii', 0, 4) === 'RIFF' && h.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp', kind: 'image' };
  if (h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3) return { mime: 'audio/webm', ext: 'webm', kind: 'audio' };
  if (h.toString('ascii', 0, 4) === 'OggS') return { mime: 'audio/ogg', ext: 'ogg', kind: 'audio' };
  if (h.toString('ascii', 4, 8) === 'ftyp') return { mime: 'audio/mp4', ext: 'm4a', kind: 'audio' };
  return null;
}

/** Stockage privé Netlify Blobs (le magasin n'est jamais exposé publiquement). */
export function netlifyBlobsStorage(): MediaStorage {
  const store = async () => (await import('@netlify/blobs')).getStore('yoon-media');
  return {
    async put(buf, ext) {
      const key = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`;
      await (await store()).set(key, new Uint8Array(buf).buffer as ArrayBuffer);
      return key;
    },
    async get(key) {
      const data = await (await store()).get(key, { type: 'arrayBuffer' });
      if (!data) throw new Error('média introuvable');
      return Buffer.from(data);
    },
    async remove(key) {
      await (await store()).delete(key);
    },
  };
}

export type Adapters = { whatsapp: WhatsAppAdapter; storage: MediaStorage };
export function createAdapters(cfg: Config): Adapters {
  return { whatsapp: manualWhatsApp, storage: cfg.MEDIA_STORAGE === 'netlify_blobs' ? netlifyBlobsStorage() : localStorage(cfg.STORAGE_DIR) };
}
