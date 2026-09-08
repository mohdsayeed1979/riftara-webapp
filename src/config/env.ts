import { z } from 'zod';

/**
 * Server-side environment contract. Validated once at module load so that a
 * misconfigured deployment fails fast instead of failing at request time.
 * Never import this module from a Client Component.
 *
 * Robustness note: hosting platforms (Vercel included) frequently pass a
 * *defined-but-empty* string for a variable the operator left blank. Zod's
 * `.default()` and `.optional()` only apply to `undefined`, not to `''`, so an
 * empty string would otherwise fail validation. `optionalTrimmed` normalises
 * empty/whitespace values to `undefined` so defaults and optionals apply as
 * intended — without weakening validation for values that ARE provided.
 */

/** Treat an empty / whitespace-only env value as "not set". */
function normalizeEnv(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

const bool = z
  .preprocess(normalizeEnv, z.string().optional())
  .transform((v) => v === 'true' || v === '1');

/** A required string with a default, tolerant of empty-string input. */
const str = (fallback: string) =>
  z.preprocess(normalizeEnv, z.string().default(fallback));

/** An optional string, tolerant of empty-string input. */
const optionalStr = () => z.preprocess(normalizeEnv, z.string().optional());

/** A positive integer with a default, coerced from string, tolerant of empty. */
const posInt = (fallback: number) =>
  z.preprocess(normalizeEnv, z.coerce.number().int().positive().default(fallback));

/** An enum with a default, tolerant of empty-string input. */
function enumWithDefault<const T extends readonly [string, ...string[]]>(
  values: T,
  fallback: T[number],
) {
  return z.preprocess(normalizeEnv, z.enum(values).default(fallback));
}

const isProduction = normalizeEnv(process.env.NODE_ENV) === 'production';

const schema = z.object({
  NODE_ENV: enumWithDefault(['development', 'test', 'production'], 'development'),
  APP_URL: str('http://localhost:3000'),

  // `postgresql` / `pg` are accepted as aliases for `postgres` (see preprocess).
  DATABASE_DRIVER: enumWithDefault(['pglite', 'postgres'], 'pglite'),
  DATABASE_URL: str('postgresql://postgres:postgres@localhost:5432/riftara'),
  PGLITE_DATA_DIR: str('./.data/riftara-db'),

  /**
   * AUTH_SECRET must be at least 32 characters. Never faked in production: if it
   * is missing or empty in production the build/runtime fails with a clear
   * message. In development/test a documented dev-only fallback is used so the
   * app runs with zero setup.
   */
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  AUTH_SESSION_TTL_HOURS: posInt(12),
  AUTH_PROVIDER: enumWithDefault(['credentials', 'supabase'], 'credentials'),
  AUTH_MFA_ENABLED: bool,

  DEMO_MODE: bool,
  SEED_DEFAULT_PASSWORD: str('Riftara#2025'),

  STORAGE_DRIVER: enumWithDefault(['local', 'supabase', 's3'], 'local'),
  STORAGE_LOCAL_DIR: str('./storage'),
  STORAGE_MAX_UPLOAD_MB: posInt(25),

  SUPABASE_URL: optionalStr(),
  SUPABASE_ANON_KEY: optionalStr(),
  SUPABASE_SERVICE_ROLE_KEY: optionalStr(),
  SUPABASE_STORAGE_BUCKET: str('riftara'),

  MAP_PROVIDER: enumWithDefault(['static', 'google', 'mapbox'], 'static'),
  GOOGLE_MAPS_API_KEY: optionalStr(),
  MAPBOX_TOKEN: optionalStr(),

  API_RATE_LIMIT_PER_MINUTE: posInt(120),
  API_KEY_SALT: str('riftara-dev-api-key-salt'),
  WEBSITE_WEBHOOK_SECRET: optionalStr(),
});

/** Dev-only AUTH_SECRET fallback (never used when NODE_ENV=production). */
const DEV_AUTH_SECRET = 'riftara-development-only-secret-value-not-for-production';

/** Normalise the raw driver value, mapping common aliases to `postgres`. */
function resolveDatabaseDriver(): string | undefined {
  const raw = normalizeEnv(process.env.DATABASE_DRIVER)?.toLowerCase();
  if (raw === undefined) return undefined;
  if (raw === 'postgresql' || raw === 'pg' || raw === 'postgres-js') return 'postgres';
  return raw;
}

/**
 * Resolve AUTH_SECRET. In production it is required (never faked); elsewhere a
 * dev-only fallback keeps zero-setup development working.
 */
function resolveAuthSecret(): string {
  const provided = normalizeEnv(process.env.AUTH_SECRET);
  if (provided) return provided;
  if (isProduction) {
    // Deliberately return an empty string so validation fails with the clear
    // min(32) message rather than silently signing tokens with a known secret.
    return '';
  }
  return DEV_AUTH_SECRET;
}

const parsed = schema.safeParse({
  NODE_ENV: process.env.NODE_ENV,
  APP_URL: process.env.APP_URL,
  DATABASE_DRIVER: resolveDatabaseDriver(),
  DATABASE_URL: process.env.DATABASE_URL,
  PGLITE_DATA_DIR: process.env.PGLITE_DATA_DIR,
  AUTH_SECRET: resolveAuthSecret(),
  AUTH_SESSION_TTL_HOURS: process.env.AUTH_SESSION_TTL_HOURS,
  AUTH_PROVIDER: process.env.AUTH_PROVIDER,
  AUTH_MFA_ENABLED: process.env.AUTH_MFA_ENABLED,
  DEMO_MODE: process.env.DEMO_MODE,
  SEED_DEFAULT_PASSWORD: process.env.SEED_DEFAULT_PASSWORD,
  STORAGE_DRIVER: process.env.STORAGE_DRIVER,
  STORAGE_LOCAL_DIR: process.env.STORAGE_LOCAL_DIR,
  STORAGE_MAX_UPLOAD_MB: process.env.STORAGE_MAX_UPLOAD_MB,
  SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET,
  MAP_PROVIDER: process.env.MAP_PROVIDER,
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
  MAPBOX_TOKEN: process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
  API_RATE_LIMIT_PER_MINUTE: process.env.API_RATE_LIMIT_PER_MINUTE,
  API_KEY_SALT: process.env.API_KEY_SALT,
  WEBSITE_WEBHOOK_SECRET: process.env.WEBSITE_WEBHOOK_SECRET,
});

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  const hint = isProduction
    ? '\n\nSet the required variables in your hosting environment (e.g. Vercel → Settings → Environment Variables). ' +
      'AUTH_SECRET must be a real 32+ character secret; DATABASE_DRIVER must be "postgres" for a managed database.'
    : '';
  throw new Error(`Invalid environment configuration:\n${issues}${hint}`);
}

export const env = parsed.data;
export type Env = typeof env;

/** Integration credential presence — drives Integration Hub connection status. */
export const integrationCredentials = {
  ejar: Boolean(process.env.EJAR_API_BASE_URL && process.env.EJAR_API_KEY),
  whatsapp: Boolean(process.env.WHATSAPP_API_BASE_URL && process.env.WHATSAPP_API_TOKEN),
  paymentGateway: Boolean(process.env.PAYMENT_GATEWAY_BASE_URL && process.env.PAYMENT_GATEWAY_KEY),
  googleAds: Boolean(process.env.GOOGLE_ADS_CLIENT_ID && process.env.GOOGLE_ADS_CLIENT_SECRET),
  googleAnalytics: Boolean(process.env.GOOGLE_ANALYTICS_PROPERTY_ID),
  metaAds: Boolean(process.env.META_ADS_APP_ID && process.env.META_ADS_APP_SECRET),
  tiktokAds: Boolean(process.env.TIKTOK_ADS_APP_ID && process.env.TIKTOK_ADS_APP_SECRET),
  snapchatAds: Boolean(process.env.SNAPCHAT_ADS_CLIENT_ID && process.env.SNAPCHAT_ADS_CLIENT_SECRET),
  linkedinAds: Boolean(process.env.LINKEDIN_ADS_CLIENT_ID && process.env.LINKEDIN_ADS_CLIENT_SECRET),
  zoho: Boolean(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET),
  monday: Boolean(process.env.MONDAY_API_TOKEN),
  erp: Boolean(process.env.ERP_API_BASE_URL && process.env.ERP_API_KEY),
  website: Boolean(env.WEBSITE_WEBHOOK_SECRET),
  smtp: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
} as const;

export type IntegrationCredentialKey = keyof typeof integrationCredentials;
