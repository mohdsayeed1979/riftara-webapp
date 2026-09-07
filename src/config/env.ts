import { z } from 'zod';

/**
 * Server-side environment contract. Validated once at module load so that a
 * misconfigured deployment fails fast instead of failing at request time.
 * Never import this module from a Client Component.
 */
const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().default('http://localhost:3000'),

  DATABASE_DRIVER: z.enum(['pglite', 'postgres']).default('pglite'),
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/riftara'),
  PGLITE_DATA_DIR: z.string().default('./.data/riftara-db'),

  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  AUTH_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  AUTH_PROVIDER: z.enum(['credentials', 'supabase']).default('credentials'),
  AUTH_MFA_ENABLED: bool,

  DEMO_MODE: bool,
  SEED_DEFAULT_PASSWORD: z.string().default('Riftara#2025'),

  STORAGE_DRIVER: z.enum(['local', 'supabase', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  STORAGE_MAX_UPLOAD_MB: z.coerce.number().int().positive().default(25),

  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default('riftara'),

  MAP_PROVIDER: z.enum(['static', 'google', 'mapbox']).default('static'),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  MAPBOX_TOKEN: z.string().optional(),

  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
  API_KEY_SALT: z.string().default('riftara-dev-api-key-salt'),
});

const parsed = schema.safeParse({
  NODE_ENV: process.env.NODE_ENV,
  APP_URL: process.env.APP_URL,
  DATABASE_DRIVER: process.env.DATABASE_DRIVER,
  DATABASE_URL: process.env.DATABASE_URL,
  PGLITE_DATA_DIR: process.env.PGLITE_DATA_DIR,
  AUTH_SECRET: process.env.AUTH_SECRET ?? 'riftara-development-only-secret-value-not-for-production',
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
});

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
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
  website: Boolean(process.env.WEBSITE_WEBHOOK_SECRET),
  smtp: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
} as const;

export type IntegrationCredentialKey = keyof typeof integrationCredentials;
