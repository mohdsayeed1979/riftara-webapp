# Deployment

## Local development
```bash
npm install
cp .env.example .env
npm run db:setup   # migrate + seed
npm run dev
```

## Production (managed PostgreSQL / Supabase)

1. **Provision PostgreSQL** (Supabase, Neon, RDS, …).
2. **Environment**
   ```
   NODE_ENV=production
   DATABASE_DRIVER=postgres
   DATABASE_URL=postgresql://…            # pooled connection string
   AUTH_SECRET=<openssl rand -base64 48>
   DEMO_MODE=false
   ```
   Supply integration credentials only for the connectors you are enabling.
3. **Schema**
   ```bash
   npm run db:migrate     # migrations + integrity constraints
   ```
   Seed demo data only in non-production environments.
4. **Build & run**
   ```bash
   npm run build
   npm start
   ```
   Deploy to any Node host or a container. The app is stateless apart from the
   in-process rate-limit buckets (swap for Redis at scale).

## Vercel

Vercel builds with `NODE_ENV=production` and **no `.env` file** (it is
git-ignored) — it injects the variables from **Settings → Environment
Variables** instead. Set exactly these for the production/preview environments:

| Variable | Required? | Value |
| --- | --- | --- |
| `DATABASE_DRIVER` | **Yes** | `postgres` (exact — not `postgresql`) |
| `DATABASE_URL` | **Yes (runtime)** | Pooled managed-Postgres connection string |
| `AUTH_SECRET` | **Yes** | Real 32+ char secret — `openssl rand -base64 48` |
| `NODE_ENV` | Auto | Vercel sets `production`; do not override |
| `DEMO_MODE` / `NEXT_PUBLIC_DEMO_MODE` | Recommended | `false` in production |
| `APP_URL` / `NEXT_PUBLIC_APP_URL` | Optional | Your deployed URL |
| Everything else | Optional | Only for the integrations you enable |

Notes:
- **Leave a variable UNSET rather than blank.** A defined-but-empty value is
  normalised to "unset", so empty values fall back to defaults — but there is no
  reason to add an empty variable at all.
- `AUTH_SECRET` is **required in production** and is never faked. If it is
  missing/empty the build fails with a clear message; set your real secret.
- `DATABASE_URL` is needed at **runtime**, not at build time (no page queries the
  database during `next build`), but set it before the first request.
- `DATABASE_DRIVER` must be `postgres` for a managed database; `pglite` is
  ephemeral and unsuitable for Vercel's serverless filesystem.
- Only `NEXT_PUBLIC_*` variables reach the browser; keep every secret server-side.

Do **not** paste your local `.env` into Vercel wholesale — it may carry
development-only or empty values. Add only the variables above (plus real
credentials for any integrations you are turning on).

### Common build errors and fixes

| Error | Cause | Fix |
| --- | --- | --- |
| `DATABASE_DRIVER: Invalid option` | Set to `postgresql`, blank, or another value | Set it to exactly `postgres` |
| `AUTH_SECRET must be at least 32 characters` | Blank or too-short secret in production | Set a real 32+ char secret |

## Supabase specifics
- Use the **pooled** connection string in `DATABASE_URL` (`prepare:false` is
  already set for pooler compatibility).
- Set `AUTH_PROVIDER=supabase` and `STORAGE_DRIVER=supabase` to delegate auth and
  file storage to Supabase; the app depends only on the session and a storage
  interface, so the rest is unchanged.
- Enable daily + PITR backups; define RPO/RTO for your SLA.

## Health & migrations on deploy
Run `npm run db:migrate` as a release step — it is idempotent and re-applies the
integrity constraints. `npx tsx src/db/verify.ts` asserts the schema is intact.

## Backups & DR (BRD §150)
- Daily + incremental backups, point-in-time recovery, offsite copies.
- Financial/legal records are protected from deletion at the database level, so
  backups plus the append-only audit trail give a complete recovery story.

## Do not
- Commit `.env`. Only `.env.example` (placeholders) belongs in git.
- Expose `SUPABASE_SERVICE_ROLE_KEY` or any secret to the browser.
