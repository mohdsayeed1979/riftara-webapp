# API Reference

RIFTARA exposes a versioned REST API under `/api/v1`. The web application is one
client of this API; external systems authenticate with API keys.

## Authentication

Two credential types resolve to the same permission model:

1. **Session cookie** — the first-party web app (`riftara_session`, an HttpOnly
   cookie holding a signed JWT bound to a server-side session record).
2. **API key** — `Authorization: Bearer rft_<key>` for server-to-server callers.
   Keys are hashed at rest, scoped to a permission set, and rate-limited per key.

Every route calls `requireApiPermission('<module>:<action>')`. Missing
authentication → `401`; insufficient permission → `403`.

## Response envelope

```jsonc
// success
{ "data": { ... }, "meta": { ... } }
// failure
{ "error": { "code": "BUSINESS_RULE", "message": "…", "rule": "BR-003" } }
```

Error codes: `VALIDATION` (422), `NOT_FOUND` (404), `CONFLICT` (409),
`BUSINESS_RULE` (409), `FORBIDDEN` (403), `UNAUTHENTICATED` (401),
`RATE_LIMITED` (429), `INTEGRATION` (502), `INTERNAL` (500). Raw stack traces are
never returned.

## Rate limiting

Fixed-window limiter, default `120 req/min` per principal+IP
(`API_RATE_LIMIT_PER_MINUTE`). Exceeding it returns `429`. The in-process store
is swappable for Redis behind a load balancer.

## Endpoints

### Implemented

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/api/v1/search?q=` | any authenticated | Global search (BRD §131). Default: grouped results. `&format=flat[&type=&page=&limit=]` returns normalized, ranked, paginated results |
| GET | `/api/v1/documents/:id/download` | `documents:view` (+ per-doc) | Authenticated streaming document download |
| POST | `/api/v1/documents` | `documents:create` | Multipart document upload (versioning needs `documents:manage`) |
| GET | `/api/v1/compliance?type=&filter=&window=&page=&limit=` | any of `documents:view` / `assets:view` / `contracts:view` | Expiring/expired documents, asset warranties & contracts (Phase 13) |
| POST | `/api/v1/units/:id/publish` | `units:publish` | Publish a unit to the website (BR-001) |
| POST | `/api/v1/units/:id/unpublish` | `units:publish` | Withdraw a unit |
| GET | `/api/v1/units/export?format=xlsx\|csv` | `units:export` | Unit inventory export |
| GET | `/api/v1/properties/export?format=xlsx\|csv` | `properties:export` | Property inventory export |
| GET | `/api/v1/collections/export?format=xlsx\|csv` | `collections:export` | Receivables export |
| POST | `/api/v1/leads/:id/stage` | `leasing:edit` | Move a lead between pipeline stages (BR-006) |
| POST | `/api/v1/leads/:id/activities` | `leasing:edit` | Log a follow-up (BRD §26-27) |
| POST | `/api/v1/contracts/:id/sign` | `contracts:edit` | Sign & activate a contract (BR-010) |
| POST | `/api/v1/reports/generate` | `reports:view` (+create/export) | Generate & stream an executive PDF |
| GET | `/api/v1/reports/:id/download` | `reports:view` | Re-render a stored report from its snapshot |
| GET | `/api/v1/reports` | `reports:view` | Report catalog: available report types, frequencies & periods |
| GET | `/api/v1/report-schedules` | `reports:view` | List scheduled reports for the organization |
| POST | `/api/v1/report-schedules` | `reports:create` | Create a scheduled report (BRD §117) |
| GET | `/api/v1/report-schedules/:id` | `reports:view` | Fetch one schedule |
| PATCH | `/api/v1/report-schedules/:id` | `reports:create` | Edit or enable/disable a schedule |
| DELETE | `/api/v1/report-schedules/:id` | `reports:create` | Soft-delete (deactivate) a schedule |
| GET | `/api/v1/report-schedules/:id/history` | `reports:view` | Execution history (success & failure) |
| POST | `/api/v1/report-schedules/:id/run` | `reports:create` | Run a schedule now (as the caller) |
| POST | `/api/v1/notifications/read-all` | any authenticated | Mark notifications read |
| POST | `/api/v1/notifications/:id/read` | any authenticated | Mark one notification read |
| POST | `/api/auth/logout` | any authenticated | End the session |

### Global search & discovery (BRD §131)

Covers properties, buildings, units, customers, tenants, leads, contracts,
invoices, payments, work orders, assets, ownership/CR references and documents.
Every result is authorized **server-side**: organization isolation, per-entity
RBAC (`<module>:view`), and property data-scope. Documents additionally enforce
`requiredPermission`, confidentiality and parent-entity scope, and never expose
`storageKey`/paths. Ranking is deterministic (exact code/title → prefix →
contains → secondary fields). Queries under 2 or over 120 characters are
rejected/ignored; results are bounded per group with pagination in `flat` mode.
The `/search` page consumes `format=flat`; the header search bar uses the
grouped default. The result shape is normalized and ready for a future
AI/vector ranker without an API change.

### Compliance & expiry automation (Phase 13)

The daily notification cron (`generateAllNotifications`) additionally generates
`document_expiry` and `warranty_expiry` alerts (idempotent, recency-windowed).
Document-expiry alerts are targeted by each document's own `requiredPermission`
(or `documents:view`), so confidential documents only ever alert authorized
users; warranty alerts target `assets:view`. The **Compliance Center**
(`/compliance`, API `/api/v1/compliance`) aggregates approaching/expired
documents, asset warranties and contracts — organization-scoped, RBAC-gated,
property-data-scoped, with document confidentiality enforced and no `storageKey`/
path exposure. Reuses existing fields only; **no migration**.

### Scheduled reporting & report execution (BRD §112, §117)

The **report catalog** (`GET /api/v1/reports`) registers the seven existing
executive report types — no duplicate report definitions are introduced — plus
the supported frequencies (`daily`, `weekly`, `monthly`) and reporting periods
(`3m`, `6m`, `12m`, `ytd`).

**Scheduled reports** (`report_schedules`) capture *what* to generate (report
type + a frozen config: period, optional property scope, commentary) and *when*
(frequency, hour, day-of-week/day-of-month, timezone — defaulting to the
organization's configured timezone). The existing daily notification cron
(`GET /api/cron/notifications`) runs `runDueReportSchedules()` after notification
generation; there is no separate cron framework.

Authorization is enforced end to end. Scheduled execution loads the schedule's
**creator** via `loadSessionUser` at run time and generates the report under the
creator's *live* permissions and property data scope, re-checking
`reports:create`/`reports:export`; it never trusts a client-supplied
organization id or property scope. **Run-now** executes under the *caller's* own
live session instead, so neither path can surface data the acting user could not
generate manually (BR-016, BRD §126). Each occurrence is **idempotent**: the
scheduler claims the slot by advancing `next_run_at` before executing, so a
retried or overlapping cron never generates the same occurrence twice.

Every execution — success or failure — is recorded in `report_schedule_runs`
(status, duration, `report_run_id`, failure message). A failed run raises a
`report_failed` notification targeted at `reports:view` holders; successful runs
are intentionally silent to avoid noise. Schedule create/update/enable/disable/
delete, manual runs and scheduled failures are written to the audit trail.

**Delivery is in-app only.** Generated reports are available in the app and
downloadable from execution history via the existing report download route; the
architecture is delivery-ready (execution history + per-run status + a
`delivery_method` field) but external email/SMS/WhatsApp delivery is **not
implemented**.

### Planned resource routes (BRD §110)

The service layer already implements the logic; these thin CRUD wrappers follow
the same envelope and guard pattern:

`/properties · /buildings · /units · /availability · /pricing · /customers ·
/leads · /viewings · /proposals · /reservations · /contracts · /payments ·
/collections · /maintenance · /documents · /reports`

## Webhooks (BRD §111)

Outbound webhook subscriptions (`webhooks` table) fan out platform events with
an HMAC signature and delivery log (`webhook_deliveries`):

`property.created · property.updated · unit.available · unit.reserved ·
unit.leased · price.changed · lead.created · viewing.created · proposal.sent ·
reservation.created · contract.signed · payment.received · payment.overdue ·
maintenance.created · contract.expiring`

## Website integration (BRD §88-92)

- The publishing service maintains a denormalised `website_listings` projection
  updated on every relevant change (BR-009), which the corporate website reads.
- A website inquiry (`POST /api/v1/website/leads`) runs duplicate detection and
  creates/updates a CRM lead with full UTM attribution (BR-008), authenticated
  by the `WEBSITE_WEBHOOK_SECRET`.
- Send that secret in `X-Riftara-Webhook-Secret`. The payload must include a
  valid `propertyId` or `unitId`; RIFTARA derives the organization from that
  server-validated reference and never accepts an organization id from the
  public caller.

## Marketing & other integrations

Connectors are registered in the Integration Hub. Their status is derived from
whether the required environment variables are present — never faked. See the
Integration Hub and [ENVIRONMENT.md](ENVIRONMENT.md).
