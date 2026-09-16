# Phase 18 — ERP / Accounting Integration Readiness (Dynamics AX 2012 R3)

**Status: local architecture and foundation only. RIFTARA is NOT connected to
any Dynamics AX 2012 R3 environment, and this phase never attempts to be.**

## 1. Objective

RIFTARA is the operational Property / Leasing / Asset Management platform.
The company's accounting system of record is Microsoft Dynamics AX 2012 R3.
Phase 18 makes RIFTARA *ready* to integrate with AX — a clean adapter
boundary, an outbox with idempotency and retry, master-data mapping, and
reconciliation reporting — without RIFTARA ever talking to a real AX server,
and without duplicating AX's accounting responsibilities.

## 2. Initial architecture audit (what already existed)

Before writing anything, the following existing RIFTARA architecture was
inspected and is **reused, not duplicated**, by Phase 18:

| Existing capability | File | Reused for |
|---|---|---|
| Integration Hub registry (`integrations` table, status derived from real env credentials, never faked) | `src/db/schema/platform.ts`, `src/services/integration-service.ts` | Registering AX as a Hub connector (`dynamics_ax2012`), reusing `systemOfRecord`, `category: 'accounting'` (already existed as a category label — "Accounting & ERP") |
| Integration attempt log (`integration_logs`) | `src/db/schema/platform.ts` | Model for the outbox's own audit trail (the outbox stores attempt state directly on each event row instead of a third table — see §6) |
| Integration catalog + credential presence check | `src/config/integrations-catalog.ts`, `src/config/env.ts` | Added a `dynamics_ax2012` catalog entry and a `dynamicsAx2012` credential flag (always `false` locally — no env vars set) |
| Audit trail (`recordAudit`, existing `auditActionEnum`) | `src/lib/audit/index.ts` | Every mapping/outbox mutation is audited with the existing `create`/`update`/`export` verbs — no enum migration |
| Notification generator + idempotent `ensureNotification` pattern | `src/services/notification-service.ts` | Added `notifyErpIntegrationFailure` following the exact existing pattern (once per event per day) |
| RBAC catalog (`module:action` permissions, role definitions) | `src/lib/permissions/catalog.ts` | Added `erp_integration` module; added `retry`/`reconcile` as new generic actions (used only by this module) |
| API v1 conventions (`authenticateRequest`/`requireApiPermission`, `apiSuccess`/`apiError`, pagination) | `src/lib/api/guard.ts`, `src/lib/api/response.ts` | All new `/api/v1/integrations/erp/*` routes |
| Cron authentication pattern (`CRON_SECRET` bearer, fail-closed) | `src/app/api/cron/notifications/route.ts` | `/api/cron/erp` (see §21 — not yet scheduled) |
| Financial entities: `invoices`, `payments`, `paymentAllocations`, `tenantLedgerEntries`, `operatingExpenses`, `budgets`, asset lifecycle tables, `vendors`, `customers` | `src/db/schema/leasing.ts`, `operations.ts`, `crm.ts` | Read to determine the proposed integration-event boundary (§10) — **no changes made to any of these tables** |
| i18n (`getMessages`/`useI18n`, EN/AR message parity enforced by the `Messages` type) | `src/i18n/*` | `erp` namespace added, fully mirrored EN/AR |

No competing "Integration Hub v2" or parallel job scheduler was created.

## 3. System-of-record matrix

| Domain | RIFTARA | AX | Direction | Frequency | Notes |
|---|---|---|---|---|---|
| Property | **Source of truth** | Reference only | RIFTARA → AX | On change (future) | AX may want a reference/dimension value; AX never edits property data. |
| Building | **Source of truth** | Reference only | RIFTARA → AX | On change (future) | Same as Property. |
| Unit | **Source of truth** | Reference only | RIFTARA → AX | On change (future) | Same as Property. |
| Customer (tenant-side) | **Source of truth** | Shared / synchronized | RIFTARA → AX | On create/change (future) | RIFTARA owns the leasing relationship; AX needs a customer account to post AR against. **Open decision**: does AX or RIFTARA win on conflicting name/VAT fields? |
| Vendor | **Not integrated yet** | Likely AX source of truth | AX → RIFTARA (future) | N/A | RIFTARA has no vendor master today beyond `vendors` used for maintenance/OPEX attribution — see §12. Needs business confirmation of ownership before design. |
| Tenant (lease party) | **Source of truth** | Reference only | RIFTARA → AX | On change (future) | Distinct RIFTARA concept from "Customer" (BRD); only the underlying customer needs an AX account. |
| Contract | **Source of truth** | Reference only | RIFTARA → AX | On sign (future) | AX does not manage lease terms; it needs the contract as a dimension/reference for posted transactions. |
| Invoice | **RIFTARA operational source of truth; AX is the accounting posting target** | **AX source of truth for the posted AR entry** | RIFTARA → AX | On issue (future) | See §11. RIFTARA keeps the operational invoice (schedule, tenant, property); AX posts the accounting-relevant subset and returns a voucher reference. |
| Payment | **RIFTARA operational source of truth; AX is the accounting posting target** | **AX source of truth for the posted cash/bank entry** | RIFTARA → AX | On receipt (future) | Same pattern as Invoice. |
| Expense (OPEX/maintenance/vendor) | **RIFTARA operational source of truth; AX is the accounting posting target** | **AX source of truth for the posted GL/AP entry** | RIFTARA → AX | On record (future) | See §12. |
| Asset (acquisition/disposal) | **RIFTARA operational source of truth; AX is the accounting posting target** | **AX source of truth for fixed-asset accounting** | RIFTARA → AX | On acquire/dispose (future) | See §13. RIFTARA's asset *lifecycle* (condition, maintenance, depreciation *estimates* for operational reporting) stays in RIFTARA; AX owns statutory fixed-asset accounting/depreciation. |
| GL Account / Chart of Accounts | **AX source of truth** | AX source of truth | N/A (reference only, future) | RIFTARA never creates or edits GL accounts. A future mapping (`erp_entity_mappings`) would let a RIFTARA cost category resolve to an AX account, but no such mapping exists yet — **business decision required**. |
| Financial Dimension | **AX source of truth** | AX source of truth | N/A (reference only, future) | See §15. RIFTARA has no concept of AX's actual dimension set; this is deliberately left unconfigured. |
| VAT | **RIFTARA computes/displays operationally; AX is authoritative for tax accounting** | AX source of truth for filed tax positions | RIFTARA → AX (future) | See §14. RIFTARA does not invent Saudi VAT rules — it passes through the VAT amount already computed by existing `vatRateBps`/invoice fields. |
| Journal / Voucher | **Not integrated yet** | AX source of truth | N/A | RIFTARA never constructs a journal entry. If AX's chosen transport (§29) requires RIFTARA to submit journal-shaped payloads, that mapping is designed at implementation time, not now. |
| Bank Payment | **Not integrated yet** | AX source of truth | N/A | Out of scope until online payment/bank reconciliation integration (separate `payment_gateway` connector) is revisited. |
| Fixed Asset accounting | **AX source of truth** | AX source of truth | RIFTARA → AX (future, event only) | See §13. |

Legend: "future" means the *event type* is defined and the outbox can carry
it, but nothing in RIFTARA today calls `queueErpEvent` for it — see §10 for
why that wiring is deliberately not done in Phase 18.

## 4. Dynamics AX 2012 R3 integration architecture

```
RIFTARA business transaction (invoice issued, payment received, ...)
        │  (same DB transaction)
        ▼
ERP Integration Service — queueErpEvent()      src/integrations/erp/erp-service.ts
        │  writes an outbox row, idempotency-keyed
        ▼
erp_integration_events (pending)
        │  processPendingEvents() — manual endpoint today, cron in production (§21)
        ▼
ErpAdapter interface                            src/integrations/erp/erp-types.ts
        │
        ▼
DynamicsAx2012Adapter                           src/integrations/erp/adapters/dynamics-ax2012/
        │  (currently delegates to MockErpAdapter — NEVER calls a real AX server)
        ▼
Future transport (AIF web service | AIF file/queue adapter | middleware | staging table | file exchange)
```

The AX adapter is a stub with a real, named class (`DynamicsAx2012Adapter`)
so that swapping in a real transport later is confined to one file. **No
transport has been chosen** — Dynamics AX 2012 R3 predates the modern
Dynamics 365 Web API, so viable options are the Application Integration
Framework (AIF, via its web services or its file/queue adapters), middleware
(e.g. BizTalk), a controlled database staging table, or a file-based
exchange. The correct choice depends on what the company's actual AX 2012 R3
environment exposes — see §23 (open business decisions).

## 5. Master-data mapping

New table `erp_entity_mappings` (additive, migration `0005`):

| Column | Purpose |
|---|---|
| `organizationId`, `system`, `entityType`, `localEntityId` | Composite key (unique) — one row per local entity per external system |
| `externalEntityId` | Generic external identifier. **No AX table/field name is assumed** — this is deliberately opaque. |
| `status` | `pending` \| `mapped` \| `error` |
| `lastSyncedAt`, `metadata` | Bookkeeping |

`upsertMapping()` is idempotent: a second call for the same local entity
updates the existing row rather than creating a duplicate (enforced by a
unique index, not just application logic).

## 6. Integration outbox

New table `erp_integration_events` (additive, migration `0005`) implements
the outbox pattern:

1. A business transaction commits.
2. `queueErpEvent()` writes an event row — pass the same `executor` (the
   open transaction) so queueing succeeds or fails atomically with the
   business change it represents.
3. `processPendingEvents()` (called from the manual endpoint or, in
   production, a scheduled worker) selects due events and calls the adapter.
4. The adapter's outcome updates the event's `status`, `attemptCount`,
   `externalReference`, `errorCode`/`errorMessage`.
5. Retryable failures get a `nextRetryAt`; permanent ones become visible via
   `dead_letter`/`failed` for operator action (UI retry button, or a
   corrected re-submission).

No `erp_integration_attempts` table was created — attempt state lives
directly on the event row (attempt count, last attempt, next retry, last
error), and the mutation itself is fully audited via `recordAudit`. This
keeps the schema to the two tables actually needed.

## 7. Idempotency

The idempotency key is `organizationId:system:entityType:entityId:eventType:version`,
enforced by a **database unique constraint** on
`(organization_id, idempotency_key)` — not just an application-level check.
`queueErpEvent()` queries for an existing row with that key first and
returns it unchanged if found, so calling it twice (e.g. a retried request,
a re-run migration script, a duplicate cron tick) never creates a duplicate
outbox row, and therefore never causes a duplicate ERP posting once
delivery succeeds. Covered by `tests/erp-integration.test.ts`.

## 8. Retry / failure handling

| Adapter outcome | Event status | Retried? |
|---|---|---|
| `success` | `succeeded` | — |
| `validation_error` | `failed` | **Never** — the payload itself is wrong; retrying an unfixed payload can't succeed. Needs a corrected re-submission. |
| `transient_error` | `retrying` → `dead_letter` after `MAX_ATTEMPTS` (5) | Yes, exponential backoff (`min(60, 2^attemptCount)` minutes) |
| `permanent_error` | `dead_letter` | **Never** — the ERP definitively rejected it; needs operator review. |

An operator can manually retry a `retrying`/`dead_letter` event from the UI
or `POST /api/v1/integrations/erp/events/[id]/retry` — but not a `failed`
(validation) event, which the service explicitly refuses (it needs a
corrected payload, not a re-send of the same one).

## 9. Reconciliation

`reconcile()` reads the outbox's own recorded state and reports:

- **Total events**, **sent** (an attempt was actually made), **accepted**
  (succeeded), **rejected** (failed/dead-lettered), **unmatched** (still
  pending/processing/retrying) — overall and per event type.

This **never fabricates** an AX-side result — it is a report of what
RIFTARA's own outbox knows, which is exactly what an operator can trust
before a real AX connection exists. A real reconciliation against AX's own
posted-transaction log is a future capability once a transport exists (the
adapter interface's `send()` result already carries `externalReference`, the
field a future two-way reconciliation would match against).

## 10. Financial transaction boundary — proposed integration events

Defined in `ErpEventType` (`src/integrations/erp/erp-types.ts`), but **none
of these are wired into any existing business flow in Phase 18** — the task
explicitly warns against auto-exporting everything, and the actual payload
shape (which fields AX needs) is exactly the kind of detail that depends on
the still-undetermined transport and AX configuration (§23). Wiring
`queueErpEvent()` into `contract-service.signContract`, `collection-service`,
`financial-service`, etc. is the concrete, low-risk next step once those
decisions are made — the outbox, idempotency, retry and reconciliation
machinery is already fully built and tested to receive that wiring.

| Proposed event | Accounting significance | Would fire from |
|---|---|---|
| `invoice_issued` | New AR balance | `contract-service.signContract` (schedule/invoice generation) |
| `payment_received` | Cash/bank receipt, AR reduction | `collection-service.recordPayment` |
| `expense_recorded` | AP/GL expense | `financial-service` OPEX/CAPEX recording |
| `asset_acquired` | Fixed-asset capitalization | Asset lifecycle "acquired" transition |
| `asset_disposed` | Fixed-asset disposal | Asset lifecycle "disposed" transition |
| `customer_sync` / `vendor_sync` / `property_reference_sync` / `unit_reference_sync` | Master-data readiness, not itself a posting | Would run ahead of the first transactional event referencing that entity |

Deliberately **not proposed**: refunds, credit notes, and VAT as
*standalone* events — these are naturally carried as fields/adjustments on
`invoice_issued`/`payment_received` payloads rather than separate event
types, pending the real payload design.

## 11. Collections → ERP boundary

- RIFTARA keeps: the operational invoice (schedule, tenant, aging, dunning
  workflow, ledger) — this is Phase 5 Collections, untouched.
- AX would own: the posted AR/GL entry.
- Proposed flow: `invoice_issued` event carries the accounting-relevant
  subset (amount, VAT, tenant/customer mapping, contract/property
  reference, due date) → AX posts → returns a voucher/reference → RIFTARA
  stores it via `erp_entity_mappings`/`externalReference` for reconciliation.
  Same pattern for `payment_received`.

## 12. Maintenance / OPEX → ERP boundary

RIFTARA's `operatingExpenses`/maintenance cost detail (vendor, property,
category, recoverable flag) stays fully in RIFTARA for operational
reporting (NOI, budget-vs-actual). AX would receive only the
accounting-relevant payload (amount, VAT, vendor mapping, cost
category/dimension) via `expense_recorded` — RIFTARA does not attempt to
duplicate AX's AP posting or GL calculation logic.

## 13. Asset integration boundary

RIFTARA's completed Asset Lifecycle module (acquisition, condition,
maintenance linkage, operational depreciation *estimates* for portfolio
reporting) is **not** the same thing as AX fixed-asset accounting
(statutory depreciation, capitalization thresholds, disposal accounting).
Proposed events (`asset_acquired`, `asset_disposed`) notify AX of the
lifecycle transition; AX remains the source of truth for the actual
depreciation schedule and asset ledger. RIFTARA does not create a
competing fixed-asset ledger.

## 14. VAT / tax

RIFTARA does not invent or duplicate Saudi VAT rules. Existing VAT fields
(e.g. `contracts.vatRateBps`, invoice VAT amounts) are passed through
unchanged as part of an event's payload when that event is eventually
wired up. Which party (RIFTARA or AX) is the tax-authority-facing system of
record for filed VAT returns is an **open business decision** (§23) — Phase
18 keeps this configurable rather than assuming RIFTARA-side tax filing.

## 15. Financial dimensions

No assumption is made about the company's actual AX financial dimension
structure. `erp_entity_mappings` supports mapping any RIFTARA entity
(property, building, unit, a future cost-category concept) to an opaque
`externalEntityId` — which could represent an AX dimension value — without
any source-code change once dimension values are confirmed. Today, zero
dimension mappings exist; this is intentional.

## 16. Integration Hub extension

The existing Hub (`/integrations`) was **extended, not replaced**: the
"Accounting & ERP" category (which already existed) now shows a
`Microsoft Dynamics AX 2012 R3` card alongside the pre-existing generic
`ERP / Accounting` placeholder, both correctly `Not Connected` (derived from
real env credentials — never faked). The card links to a new detail page,
`/integrations/erp`, showing connection status, adapter, environment, queue
counts, mapping status, recent events (with per-row retry), and
reconciliation — exactly the local mock-adapter state, clearly labeled.

## 17. Admin configuration

No credentials are stored in the database. Connection readiness is derived
purely from environment variable presence (`DYNAMICS_AX2012_BASE_URL`,
`DYNAMICS_AX2012_API_KEY` — unset locally, so status is always
`Not Connected`), following the exact existing pattern used by every other
Integration Hub connector (`src/config/env.ts`, `src/config/integrations-catalog.ts`).

## 18. Security

- New RBAC module `erp_integration` with `view`, `manage`, `retry`,
  `reconcile` actions, granted to `finance` and `super_admin`, with
  read-only visibility for `auditor`. No other role has access.
- Every API route and server action calls `requireApiPermission`/
  `requirePermission` server-side — RBAC is never UI-only (verified by
  tests and a live browser check with a Maintenance Manager account, which
  received a proper 403).
- No credential, connection string, or token is ever rendered in the UI,
  logged, or written to an audit `newValue`/`previousValue` — there are
  none to expose (nothing is stored; presence is a boolean derived from
  `process.env`).

## 19. Audit

Every mapping and outbox mutation calls `recordAudit` with the **existing**
`auditActionEnum` verbs — no migration needed:

| Action | Verb used |
|---|---|
| Mapping created/updated | `create` / `update` |
| Event queued | `create` |
| Event succeeded/failed/retried | `update` |
| Reconciliation run | `export` |

## 20. Notifications

`notifyErpIntegrationFailure` follows the existing `ensureNotification`
idempotency pattern (one notification per event per day, not one per failed
attempt) — added to `notification-service.ts` alongside the Phase 17
renewal/handover notifiers, not a separate system.

## 21. Cron / background worker

A route exists at `/api/cron/erp` using the exact same `CRON_SECRET`
bearer-auth pattern as `/api/cron/notifications`, calling
`processPendingEventsForAllOrganizations()`. **It is deliberately not yet
registered in `vercel.json`** — ERP delivery latency requirements are
different from the once-daily notification job, and this repo's current
Vercel plan/cron configuration for a higher frequency is an open production
decision, not something to guess at here. For local development and manual
operator use today, `POST /api/v1/integrations/erp/process`
(`erp_integration:manage`) does the same work synchronously.

## 22. Mock Dynamics AX adapter

`MockErpAdapter` (`src/integrations/erp/erp-adapter.ts`) never contacts any
real system. Behaviour is driven by an optional `payload.__simulate` field:

- absent → `success` with a fake `MOCK-<EVENTTYPE>-<key>` reference
- `'VALIDATION_ERROR'` → `validation_error`
- `'TRANSIENT_ERROR'` → `transient_error`
- `'PERMANENT_ERROR'` → `permanent_error`

`DynamicsAx2012Adapter` currently delegates to this mock — see §4.

## 23. Open business decisions required before a real AX connection

1. **Transport**: AIF web services, AIF file/queue adapters, middleware, a
   staging table, or file exchange — depends on what the company's AX 2012
   R3 environment actually exposes (network access, AIF licensing/setup,
   IT's preferred integration pattern).
2. **Customer/vendor ownership**: is AX or RIFTARA authoritative for
   customer/vendor master data conflicts?
3. **Financial dimension values**: what are the company's actual AX
   dimensions, and how do RIFTARA properties/buildings/cost categories map
   to them?
4. **VAT/tax filing ownership**: does AX or another system file VAT
   returns, and what payload does it need from RIFTARA?
5. **Posting frequency/SLA**: real-time, hourly, daily? This determines the
   `/api/cron/erp` schedule and whether the current single-daily-cron
   hosting plan is sufficient.
6. **Exact accounting payload per event type**: GL account/dimension
   requirements per `invoice_issued`/`payment_received`/`expense_recorded`/
   `asset_acquired`/`asset_disposed` — needs AX functional/technical
   consultant input.
7. **Error escalation process**: who resolves a `dead_letter` event
   operationally, and what SLA applies?

## 24. Exact next steps before connecting to real AX 2012 R3

1. Resolve the open decisions in §23 with the business/IT/AX consultant.
2. Implement a real `DynamicsAx2012Adapter.send()` against the chosen
   transport (replacing the `MockErpAdapter` delegation) — no other file
   needs to change, by design.
3. Provision real credentials via environment variables only
   (`DYNAMICS_AX2012_BASE_URL`, `DYNAMICS_AX2012_API_KEY`, and whatever the
   chosen transport actually requires) in the hosting environment — never
   committed to source control.
4. Wire `queueErpEvent()` into the actual business flows listed in §10,
   starting with the lowest-risk one (e.g. `customer_sync` reference data)
   before transactional postings.
5. Register `/api/cron/erp` in `vercel.json` at the agreed frequency (§21),
   confirming the hosting plan supports it.
6. Run a controlled pilot in a non-production AX environment/company
   before enabling for the real AX 2012 R3 production instance.
7. Only after a successful pilot: enable for production, with the business
   sign-off Phase 18 explicitly deferred.
