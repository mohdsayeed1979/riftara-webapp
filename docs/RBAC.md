# RBAC — Roles & Permissions

Authorization is permission-based. A permission is a `module:action` string
(e.g. `properties:create`, `financials:approve`). Roles are collections of
permissions and are **fully editable at runtime**; the definitions below are the
seeded defaults.

The catalog lives in [`src/lib/permissions/catalog.ts`](../src/lib/permissions/catalog.ts).

## Modules

`dashboard, properties, buildings, units, pricing, leasing, customers, viewings,
proposals, reservations, contracts, tenants, collections, financials,
maintenance, assets, marketing, reports, documents, integrations, users,
settings, audit, website`

## Actions

`view, create, edit, delete, approve, export, publish, manage`

## Default roles

| Role | Summary |
| --- | --- |
| Super Admin | Unrestricted, including user & system administration |
| Executive Management | Portfolio-wide read + reporting, approvals, exports |
| Asset Manager | Assets, valuations, budgets, portfolio analysis |
| Property Manager | Day-to-day operation of assigned properties |
| Leasing Manager | Full leasing pipeline + standard pricing approvals |
| Leasing Agent | Assigned leads, viewings, draft proposals |
| Finance | Invoicing, payments, budgets, financial reporting |
| Collections Officer | Receivables and the escalation workflow |
| Maintenance Manager | Work orders, preventive maintenance, spend |
| Maintenance Staff | Executes assigned work orders |
| Marketing Manager | Campaigns, attribution, website publication |
| Auditor | Read-only everywhere + full audit trail |
| Read Only | Operational visibility, no changes |

## Data-level permissions (BRD §126)

Beyond screen access, visibility narrows by data scope. A user with no scope
rows sees the whole organization; `user_scopes` rows restrict them to specific
cities or properties. The metrics and list services apply the scope to every
query (`scopeFromSession`), so a Property Manager scoped to two properties never
sees data from others — on dashboards, lists, search, and exports alike.

## Enforcement points

- **Server Components / Actions:** `requirePermission('module:action')` (redirects
  unauthenticated users to `/login`, throws `Forbidden` otherwise).
- **API routes:** `requireApiPermission('module:action')`.
- **UI:** navigation and action buttons are filtered by `can(user, permission)`,
  so users never see a control they cannot use — but the server check is the
  real gate.

## Permission matrix

The full role × permission grid is viewable in-app at **Users & Permissions →
Permissions**, rendered from the live `role_permissions` assignments.
