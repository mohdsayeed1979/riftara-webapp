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
