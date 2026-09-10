# Database

PostgreSQL, modelled with Drizzle ORM. **83 tables**, **227 foreign keys**,
**319 indexes**, plus check constraints and triggers that enforce the business
rules. UUID primary keys throughout; business-visible codes (property code,
contract number, invoice number) are unique columns, never primary keys.

## Domains (schema files)

| File | Tables |
| --- | --- |
| `org.ts` | organizations, users, roles, permissions, role_permissions, user_roles, user_scopes, sessions, login_attempts, api_keys, audit_logs |
| `geo.ts` | portfolios, regions, cities, districts |
| `taxonomy.ts` | property_types, unit_types, unit_statuses, lead_sources, lead_stages, document_categories, expense_categories, maintenance_categories, loss_reasons, vendors |
| `property.ts` | properties, property_ownerships, buildings, floors, units, unit_pricing, price_history, pricing_approvals |
| `crm.ts` | customers, customer_identifiers, leads, lead_activities, viewings, viewing_feedback, proposals, reservations, tasks |
| `leasing.ts` | tenants, contracts, contract_versions, renewals, handovers, payment_schedules, invoices, payments, payment_allocations, tenant_ledger_entries, collection_actions |
| `operations.ts` | maintenance_assets, work_orders, maintenance_costs, preventive_maintenance_schedules, operating_expenses, budgets, budget_lines, valuations, performance_snapshots, vacancy_periods |
| `marketing.ts` | marketing_platforms, campaigns, campaign_metrics, marketing_attributions, consents |
| `platform.ts` | documents, notifications, integrations, integration_logs, webhooks, webhook_deliveries, settings, business_rule_configs, kpi_definitions, kpi_thresholds, saved_views, import_batches, import_errors, report_runs, report_schedules, report_schedule_runs, website_listings |
| `org.ts` (auth/RBAC) | organizations, users, user_mfa, mfa_recovery_codes, roles, permissions, role_permissions, user_roles, user_scopes, sessions, login_attempts, audit_logs |

## Property hierarchy (BRD §4)

```
Portfolio → Region → City → District → Property → Building → Floor → Unit
```

Levels are optional (a property attaches directly to a city); not every property
uses every level. Units carry both a manually selected `status` and an
engine-derived `computed_availability_class` / `computed_available_from`
(see the availability engine).

## Money & precision

Money is `numeric(18,2)` with `mode: 'number'`; areas `numeric(14,2)`;
percentages `numeric(9,4)`. Financial arithmetic is exact and rounded to two
decimals in the calculation layer.

## Integrity constraints (`src/db/constraints/001_integrity.sql`)

Applied on every migration, idempotently:

- **Partial unique index** `reservations_one_active_per_unit` (BR-002).
- **Trigger** `trg_contracts_no_overlap` — daterange overlap check (BR-003).
- **Triggers** protecting signed contracts and all financial tables from
  deletion (BR-012, BR-013).
- **Triggers** making `audit_logs` and `price_history` append-only (BR-017, BR-005).
- **Check constraints** — invoice amounts non-negative and `balance = total − paid`;
  payment amounts positive; ownership % in (0,100]; contract `end > start`;
  reservation `expiry ≥ reservation`; discount in [0,100].
- **One current valuation per property** (`valuations_one_current_per_property`).
- **Hot-path partial indexes** for active contracts, open invoices, available
  units, open work orders, follow-up-due leads, unread notifications.

## Financial model & reconciliation

- Signing a contract generates `payment_schedules` and issues `invoices` whose
  invoice date has arrived.
- A `payment` is allocated across open invoices oldest-first, creating
  `payment_allocations`; each allocation updates the invoice `paid_amount`,
  `balance_amount` and `status`.
- Every invoice/payment appends a `tenant_ledger_entries` row with a running
  balance — the statement of account (BRD §48).
- **Invariant:** for any tenant, `running_balance = Σ debits − Σ credits`; and
  portfolio-wide `Σ invoice.paid_amount = Σ payment_allocation.amount`. Both are
  asserted in the integration tests.

## Historical snapshots (BRD §141)

`performance_snapshots` stores monthly KPI values per scope (portfolio /
property). They are **computed from the transactional data** at seed/rollup
time, so trend charts reconcile with live figures. Reports additionally freeze a
full data snapshot in `report_runs.snapshot` (BRD §118) so a generated report
never changes when live data moves on.

## Multi-factor authentication (BRD §148-149)

Two additive tables back TOTP MFA (migration **`0003_vengeful_blizzard`**, purely
additive — two `CREATE TABLE`s, their FKs and indexes; no changes to existing
tables). `users.mfa_enabled` already existed and is set true only on activation.

- **`user_mfa`** — one row per user (`user_id` unique): `encrypted_secret` (the
  TOTP secret, AES-256-GCM encrypted under an `AUTH_SECRET`-derived key — never
  stored in clear), `activated_at` (null until the first code verifies),
  `last_used_at`. Soft-deletable.
- **`mfa_recovery_codes`** — one-time recovery codes stored only as SHA-256
  hashes (`code_hash`), with `used_at` marking consumption. Cascade-deleted with
  the `user_mfa` row.

> **Production note:** migration `0003` is additive and was applied to the local
> database only. Like `0002`, it has **not** been applied to Supabase production.

## Scheduled reporting (BRD §117)

Two additive tables support scheduled report generation:

- **`report_schedules`** — what/when to generate: `report_type`, frozen `config`
  (period, optional property scope, commentary), `frequency`
  (daily/weekly/monthly), `hour`, `day_of_week`, `day_of_month`, `timezone`
  (defaults to the organization's timezone), `is_active`, `delivery_method`
  (currently `in_app`), `next_run_at`/`last_run_at`/`last_status`, and
  `created_by_user_id` (the identity scheduled runs execute as). Soft-deletable
  via `deleted_at`.
- **`report_schedule_runs`** — one row per execution, success *or* failure
  (`report_runs` only holds successful snapshots, so failures need their own
  ledger): `status`, `duration_ms`, `report_run_id` (the produced snapshot, when
  successful) and `failure_message`.

Both are indexed by organization; `report_schedules` also has a
`(is_active, next_run_at)` due-detection index. Introduced by migration
**`0002_ancient_amphibian`** — purely additive (two `CREATE TABLE`s, their FKs
and indexes; no changes to existing tables). Idempotency is enforced in the
service by advancing `next_run_at` to claim an occurrence before running it.

> **Production note:** migration `0002` is additive and was verified locally
> (applied automatically by the test PGlite migrator). It has **not** been
> applied to the Supabase production database; apply it with the standard
> migration procedure below during a controlled deploy.

## Migrations

```bash
npm run db:migrate    # Drizzle migrations + constraints
npm run db:seed       # deterministic demo data (idempotent: resets first)
npm run db:reset      # full drop + migrate + seed
npx tsx src/db/verify.ts   # prints object counts + asserts required objects
```

Generate a new migration after editing the schema:

```bash
npm run db:generate
```
