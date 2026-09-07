# Architecture

## Overview

RIFTARA is a modular monolith built on Next.js 16 with a clean layered
architecture. Business logic lives in reusable services and pure calculation
modules — never in UI components — so the same logic serves the web UI, the
REST API, Server Actions, exports and scheduled jobs.

```
┌──────────────────────────────────────────────────────────────────┐
│  Presentation                                                      │
│  app/(app)/*  Server Components · features/*  ·  components/ui/*    │
│  app/api/v1/* Route Handlers   · Server Actions                    │
├──────────────────────────────────────────────────────────────────┤
│  Services            (src/services/*)                              │
│  metrics · property · unit · lead · customer · contract ·          │
│  collection · maintenance · marketing · publishing · pricing ·     │
│  availability · report · integration · auth · search               │
├──────────────────────────────────────────────────────────────────┤
│  Domain logic        (src/lib/*)                                   │
│  calculations (KPIs, finance, availability, pricing) · auth ·      │
│  permissions · audit · settings · errors · export · format         │
├──────────────────────────────────────────────────────────────────┤
│  Data                (src/db/*)                                    │
│  Drizzle schema · migrations · constraints (triggers) · seed       │
├──────────────────────────────────────────────────────────────────┤
│  PostgreSQL   (PGlite embedded  |  managed Postgres / Supabase)    │
└──────────────────────────────────────────────────────────────────┘
```

## Layering principles

1. **Single source of truth.** Every KPI is defined once in
   `src/lib/calculations/` and read through `src/services/metrics-service.ts`.
   No dashboard recomputes a formula locally (BR-016).
2. **Services own transactions and audit.** A service method that changes data
   opens a transaction, performs the change, writes the audit entry, and (where
   relevant) recomputes availability or refreshes the website projection — all
   atomically.
3. **Pure domain logic is UI-agnostic and testable.** `calculations/*` take
   plain numbers/dates and return plain values, so they are unit-tested without
   a database.
4. **Configuration over code.** Business thresholds (approval tiers, SLA,
   aging buckets, reservation validity, KPI thresholds) live in the `settings`
   table and are read via `src/lib/settings.ts`. Administrators change behavior
   without a deploy.
5. **Secure by default.** Every page calls `requirePermission(...)`; every API
   route calls `requireApiPermission(...)`. Data-level scoping (BRD §126) is
   applied in the metrics/service queries.

## Request flows

### Reading a dashboard

`app/(app)/dashboard/page.tsx` (Server Component) → `requirePermission` →
`scopeFromSession` → `metrics-service` aggregate queries → rendered on the
server. Charts are Client Components fed pre-computed rows.

### Mutating data (e.g. signing a contract)

Client → `POST /api/v1/contracts/:id/sign` → `requireApiPermission` →
`contract-service.signContract` opens a transaction:

1. Activate the contract (the DB trigger enforces BR-003 no-overlap).
2. Set the unit to *Leased* (BR-010) and recompute availability.
3. Refresh the website listing projection (BR-009).
4. Generate the payment schedule and issue due invoices (BRD §40).
5. Write the audit entry (BR-017).

If any step throws, the whole transaction rolls back — including its audit row.

## Real-time consistency

Rather than eventual consistency, RIFTARA keeps derived data correct **within
the same transaction** as the change that affects it:

- Reservation created → unit *Reserved* → availability recomputed → website
  projection updated → audit logged.
- Payment recorded → allocated to invoices → invoice status/balance updated →
  tenant ledger appended → collection KPIs reflect it immediately.
- Maintenance cost recorded → work-order actual cost updated → property OPEX and
  NOI reflect it on the next read.

Dashboards read live aggregates for current figures and pre-computed monthly
**snapshots** (`performance_snapshots`) for trend charts, so a 12-month chart is
one indexed query rather than twelve aggregations.

## Database driver abstraction

`src/db/client.ts` exposes a driver-agnostic `Database` handle. Both supported
drivers speak real PostgreSQL, so schema, SQL, constraints and transactions are
identical:

- **PGlite** (embedded WASM Postgres) for zero-setup local development.
- **postgres-js** for Supabase / any managed PostgreSQL in production.

Switching is a single env var (`DATABASE_DRIVER`).

## API-first

Every capability is exposed under `/api/v1/*` with authentication (session
cookie or `Authorization: Bearer` API key), permission checks, validation
(Zod), rate limiting and a consistent `{ data } | { error }` envelope. The web
app is one client of this API; external systems are others. See
[API.md](API.md).

## Scalability

- UUID primary keys; business codes are never primary keys.
- Comprehensive indexing, including partial indexes on hot paths
  (active contracts, open invoices, available units, unread notifications).
- Pagination everywhere; no unbounded scans.
- Heavy reporting reads snapshots and can be moved to a read replica / data
  warehouse without touching the transactional model (BRD §140).
- Stateless request handling; the only in-process state (rate-limit buckets)
  is documented as swappable for Redis.

## Folder structure

```
src/
  app/
    (auth)/login/            Authentication
    (app)/                   Authenticated shell + all module pages
    api/v1/                  Versioned REST API + exports
  components/
    ui/                      Design-system primitives (reusable)
    app/                     Shell: sidebar, header, search, notifications
    charts/                  Recharts wrappers + Saudi portfolio map
  features/                  Feature-specific client components
  services/                  Business services (transactions + audit)
  lib/
    calculations/            Pure KPI / finance / availability / pricing logic
    auth/ permissions/ audit/ export/ api/ settings/ errors/ format/
  db/
    schema/                  Drizzle tables by domain
    constraints/             Trigger + check-constraint SQL (BR enforcement)
    seed/                    Deterministic demo data
  config/                    env, navigation, settings defaults, catalogs
  i18n/                      en/ar catalogs + provider
```
