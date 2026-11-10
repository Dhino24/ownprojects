import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: z.string().default('Yoon'),
  PORT: z.coerce.number().default(8787),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('postgres://yoon:yoon@localhost:5432/yoon'),
  PUBLIC_URL: z.string().default('http://localhost:5173'),
  APP_SECRET: z.string().min(32).default('dev-only-secret-change-me-0123456789abcdef'),
  STORAGE_DIR: z.string().default('./storage'),
  MEDIA_RETENTION_DAYS: z.coerce.number().default(90),
  OFFER_TTL_SECONDS: z.coerce.number().default(30),
  CODE_MAX_ATTEMPTS: z.coerce.number().default(5),
  CODE_TTL_HOURS: z.coerce.number().default(72),
  CLIENT_LINK_TTL_HOURS: z.coerce.number().default(72),
  SESSION_TTL_DAYS: z.coerce.number().default(14),
  RECAP_HOUR_DAKAR: z.coerce.number().min(0).max(23).default(21),
  WHATSAPP_MODE: z.enum(['manual', 'api']).default('manual'),
  WHATSAPP_API_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  PAYMENT_MODE: z.enum(['manual']).default('manual'),
  DEMO_MODE: bool.default(false),
  JOBS_ENABLED: bool.default(true),
  SERVE_WEB: bool.default(false),
  TRUST_PROXY: bool.default(false),
  // false sur un hébergement serverless (Netlify) : l'interface se rafraîchit périodiquement.
  LIVE_SSE: bool.default(true),
  MEDIA_STORAGE: z.enum(['local', 'netlify_blobs']).default('local'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  // Hébergeurs (ex. Render) : l'URL publique est fournie automatiquement.
  const cfg = schema.parse({ ...env, PUBLIC_URL: env.PUBLIC_URL ?? env.RENDER_EXTERNAL_URL });
  if (cfg.NODE_ENV === 'production') {
    if (cfg.APP_SECRET.startsWith('dev-only')) throw new Error('APP_SECRET doit être défini en production');
    if (cfg.DEMO_MODE) throw new Error('DEMO_MODE est interdit en production');
  }
  if (cfg.WHATSAPP_MODE === 'api') {
    throw new Error("WHATSAPP_MODE=api n'est pas encore implémenté : accès WhatsApp Business API à fournir (voir docs/PRODUCTION.md).");
  }
  return cfg;
}
