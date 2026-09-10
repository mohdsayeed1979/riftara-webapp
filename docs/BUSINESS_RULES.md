# Business Rules (BR-001 … BR-018)

Every core business rule from the BRD (§153) is implemented **and tested**.
Structural rules are additionally guaranteed by PostgreSQL triggers and
constraints, so they hold even against a direct SQL session or a concurrent
transaction — not only through the application.

| Rule | Statement | Enforced by | Test |
| --- | --- | --- | --- |
| **BR-001** | A unit cannot be published if its status is not eligible | `publishing-service.publishUnit` checks `unit_statuses.publishable` | `workflows.test.ts` |
| **BR-002** | A unit cannot have conflicting active reservations | Partial unique index `reservations_one_active_per_unit` + `reservation` logic | `business-rules.test.ts` |
| **BR-003** | A unit cannot have overlapping active lease contracts | Trigger `trg_contracts_no_overlap` (daterange overlap) + `contract-service` pre-check | `business-rules.test.ts` |
| **BR-004** | Pricing below permitted limits requires approval | `calculations/pricing.evaluatePricing` against configurable `pricing.approval_tiers` | `calculations.test.ts` |
| **BR-005** | All pricing changes are retained in price history | Append to `price_history` in `pricing-service`; trigger blocks UPDATE/DELETE | `business-rules.test.ts` |
| **BR-006** | A lost lead cannot be closed without a loss reason | `lead-service.moveLeadToStage` | `workflows.test.ts` |
| **BR-007** | Customer duplicate detection before creating a customer | `customer-service.detectDuplicates` + unique index on `customer_identifiers` | `business-rules.test.ts`, `workflows.test.ts` |
| **BR-008** | A website inquiry creates/updates a lead | `POST /api/v1/website/leads` routes through duplicate detection | Website intake handler |
| **BR-009** | Unit status changes update the website | `publishing-service.syncWebsiteListing` on every status/pricing change | `workflows.test.ts` |
| **BR-010** | A signed contract updates unit leasing status | `contract-service.signContract` sets unit *Leased* in the same transaction | `workflows.test.ts` |
| **BR-011** | An expired reservation releases the unit per rules | `availability-service.expireLapsedReservations` (config-gated) | `calculations.test.ts` |
| **BR-012** | Signed contracts cannot be permanently deleted | Trigger `trg_contracts_protect_delete` | `business-rules.test.ts` |
| **BR-013** | Financial transactions cannot be permanently deleted | Triggers on `invoices`, `payments`, `payment_allocations`, `tenant_ledger_entries` | `business-rules.test.ts` |
| **BR-014** | Maintenance costs roll up to property and portfolio | `maintenance-service` writes `maintenance_costs`; metrics roll up into OPEX/NOI | `workflows.test.ts` |
| **BR-015** | Collections roll up to unit/property/city/portfolio | `collection-service.recordPayment` + `metrics-service` | `business-rules.test.ts`, `workflows.test.ts` |
| **BR-016** | Dashboards use the approved master data source | All dashboards read `metrics-service`; reports freeze a snapshot | `business-rules.test.ts` |
| **BR-017** | All sensitive changes are audited | `lib/audit`; trigger makes `audit_logs` append-only | `business-rules.test.ts` |
| **BR-018** | Integration failures are logged and traceable | `integration-service.logIntegrationEvent` writes `integration_logs` | Integration Hub |

## Property lifecycle (delete vs. archive)

A property is **never** hard-deleted while it holds business data. Before a
permanent delete, `property-service.getPropertyDependencies` counts related
buildings, units, contracts, invoices, payments, reservations, proposals,
viewings, leads, work orders, assets, valuations and documents (all excluding
soft-deleted rows). If any exist, `deleteProperty` refuses and the user is
directed to **archive** instead — this upholds BR-012/BR-013 by keeping signed
contracts and financial records intact. **Archive** (`archiveProperty`) is a
soft delete (`deleted_at`) that removes the property from every active query
while preserving its data. A permanent delete is allowed only when there are
zero dependencies and is gated by `properties:delete`; the dependency re-count
runs inside the delete transaction so it cannot race a concurrent insert. All
three operations are audited (`create` / `soft_delete` / `delete`).

## Where the triggers live

All trigger and check-constraint SQL is in
[`src/db/constraints/001_integrity.sql`](../src/db/constraints/001_integrity.sql)
and is applied (idempotently) on every `db:migrate`.

## Configurability

Rules with thresholds are configurable from **Settings**:

- **BR-004** discount tiers → `pricing.approval_tiers`, `pricing.minimum_rent_floor_percent`
- **BR-006** loss-reason requirement → per lead stage `requiresLossReason`
- **BR-009 / BR-001** publishing → `website.auto_publish_on_available`, `unit_statuses.publishable`
- **BR-011** reservation release → `reservation.release_unit_on_expiry`, `reservation.validity_days`

The registry of all rules and their enforcement mode is seeded into
`business_rule_configs` and shown under Settings → Business Rules.
