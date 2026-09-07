import type { Config } from 'drizzle-kit';

/**
 * Drizzle Kit targets PostgreSQL for both supported drivers:
 *  - pglite   (embedded Postgres, zero-setup local development)
 *  - postgres (Supabase / any managed PostgreSQL, production)
 * Migrations generated here are valid SQL for both.
 */
export default {
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/riftara' },
  strict: true,
  verbose: true,
} satisfies Config;
