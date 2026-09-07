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
| GET | `/api/v1/search?q=` | any authenticated | Grouped global search (BRD §131) |
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
| POST | `/api/v1/notifications/read-all` | any authenticated | Mark notifications read |
| POST | `/api/v1/notifications/:id/read` | any authenticated | Mark one notification read |
| POST | `/api/auth/logout` | any authenticated | End the session |

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

## Marketing & other integrations

Connectors are registered in the Integration Hub. Their status is derived from
whether the required environment variables are present — never faked. See the
Integration Hub and [ENVIRONMENT.md](ENVIRONMENT.md).
