# Phase 19 — Advanced Maintenance & Asset Operations

## 1. Scope and philosophy

Phase 19 extends RIFTARA's existing maintenance and asset management modules — it does not replace them. A mandatory discovery pass (see Gap Analysis below) found the existing system already implemented most of the operational maintenance platform: work orders, SLA tracking, preventive-maintenance scheduling, vendor management, cost capture, OPEX/NOI linkage, and audit-based history. Phase 19 closes four specific, genuine gaps:

1. A fuller work-order lifecycle (draft/submitted/approved/on_hold/verified/closed) alongside the original one, kept 100% backward compatible.
2. **True idempotent preventive-maintenance generation** — the pre-existing `generateWorkOrderFromPreventive` explicitly used a heuristic ("if a non-terminal work order already exists for the same property and title") with a code comment admitting "an exact per-occurrence link would need a schema column — deferred." Phase 19 adds that column (a `preventive_maintenance_occurrences` table with a `(scheduleId, occurrenceDate)` unique constraint).
3. Itemized maintenance checklists/inspections — the existing `preventiveMaintenanceSchedules.checklist` field was a bare `string[]`, not a structured pass/fail/N-A checklist. Phase 19 adds checklist templates and per-work-order execution results, including automatic corrective-work-order creation on a failed required item.
4. Minor cost-model and RBAC additions to support the above (itemized parts quantity/unit on existing cost records; one new `maintenance:manage` permission reusing the existing `manage` action).

Everything else — SLA computation, OPEX/NOI rollup, vendor/category taxonomy, document storage, notification idempotency, audit trail, RBAC enforcement pattern, global search, cron/automation shape — is **reused as-is**.

## 2. Database changes (migration `0006_military_quentin_quire.sql`)

All changes are additive; no destructive statements. Applied to the local PGlite dev database only (see §10).

- `work_order_status` enum: added `draft`, `submitted`, `approved`, `on_hold`, `verified`, `closed` (existing values `open/assigned/in_progress/pending/completed/cancelled` untouched — the 635 pre-existing seeded work orders are unaffected).
- `maintenance_costs`: added nullable `quantity numeric(12,2)` and `unit varchar(24)` for itemized materials/spare-parts capture (paired with the existing `costType = 'parts'`).
- New table `preventive_maintenance_occurrences` (`schedule_id`, `occurrence_date`, `work_order_id`, unique on `(schedule_id, occurrence_date)`) — the idempotency anchor for preventive generation.
- New table `maintenance_checklist_templates` (`code`, `name_en`, `name_ar`, `category_id`, `items` jsonb array of `{key, labelEn, labelAr, required, createsCorrectiveOnFail}`).
- New table `work_order_checklist_results` (`work_order_id`, `template_id`, `item_key`, `result` [pass|fail|na], `notes`, `document_id`, `corrective_work_order_id`, unique on `(work_order_id, template_id, item_key)`).

No changes to `preventiveMaintenanceSchedules.checklist` (left as-is for backward compatibility) — new checklist templates are a separate, richer mechanism.

## 3. Work-order lifecycle

`STATUS_TRANSITIONS` in `src/services/maintenance-service.ts` now supports both the legacy 6-state machine and the extended one:

```
draft → submitted → approved → assigned → in_progress ⇄ on_hold → completed → verified → closed
open → assigned → in_progress ⇄ pending → completed          (legacy, unchanged)
                                        ↘ cancelled (from any non-terminal state)
```

`createWorkOrder` still defaults new work orders to `open` (unchanged behavior); the extended lifecycle is available to any work order via `transitionWorkOrderStatus` and is exercised in tests. `workOrderSlaState()` gained a `warning` state (remaining time ≤ 20% of the resolution SLA window) alongside the existing `on_track`/`breached`/`met`/`closed` — computed purely from stored fields, so there is still only one SLA engine.

## 4. Idempotent preventive-maintenance generation

`generateWorkOrderFromPreventive(actor, scheduleId, occurrenceDate?)` now:

1. Attempts `INSERT ... ON CONFLICT (schedule_id, occurrence_date) DO NOTHING` into `preventive_maintenance_occurrences`.
2. If the insert won (no conflict), creates the work order in the **same transaction** and stamps `work_order_id` onto the occurrence row.
3. If the insert lost (row already existed), looks up and returns the already-linked work order instead — no new work order is ever created for the same `(schedule, occurrence date)` pair.

`generateDuePreventiveWorkOrders(actor)` scans schedules where `next_due_date <= current_date`, calls the above per schedule, and only advances `next_due_date` (by `interval_months`) when a **genuinely new** occurrence was generated. Running it twice in a row is a no-op the second time. This is covered by dedicated tests (`tests/maintenance.test.ts`, "Phase 19: idempotent preventive generation & bulk automation").

Because PGlite is a single-connection embedded database, true concurrent transactions aren't exercised in this environment, but the mechanism is standard Postgres `ON CONFLICT` and holds under real concurrent connections in production (`postgres` driver).

## 5. Itemized maintenance checklists

- `createChecklistTemplate(actor, {code, nameEn, nameAr?, categoryId?, items})` — validates unique item keys and a unique `(organizationId, code)`.
- `listChecklistTemplates(organizationId)` / `getWorkOrderChecklistResults(organizationId, workOrderId)` — read helpers.
- `executeChecklistItem(actor, {workOrderId, templateId, itemKey, result, notes?, documentId?})` — upserts a result row keyed by `(workOrderId, templateId, itemKey)`, so re-submitting the same item updates it in place rather than duplicating. If `result === 'fail'` and the template item has `createsCorrectiveOnFail: true`, a linked corrective work order (`maintenanceType: 'corrective'`, `priority: 'high'`) is created **exactly once** — re-submitting the same failure reuses the existing corrective work order id instead of creating a second one.

This is explicitly a different mechanism from the Phase 17 contract-handover inspection (`unitCondition` + documents/photos, no itemized checklist) — the two are unrelated and both remain in place.

`documentId` on a checklist result reuses the existing polymorphic `documents` table pattern (no second upload/storage system); photo/document attachment to a checklist item is wired at the schema/service level, with photo capture UI itself deferred (see §11).

## 6. Materials / spare-parts cost capture

No new inventory system. `recordMaintenanceCost` gained optional `quantity`/`unit` fields written onto the existing `maintenance_costs` row (typically alongside `costType: 'parts'`). This still rolls up into `workOrders.actualCost` and into OPEX/NOI via the existing `metrics-service.ts` aggregation over `maintenance_costs` — no second cost ledger.

## 7. RBAC

One permission added to the existing `maintenance` module by reusing the **already-defined global `manage` action** (no new global action was introduced): `maintenance:manage`, description "Manage maintenance work orders configuration" — used for checklist-template management and on-demand preventive generation. It was granted automatically to `maintenance_manager` and `property_manager` (both already hold `all('maintenance')`), consistent with the existing role-composition pattern. `maintenance_staff` and `finance` keep their existing narrower grants unchanged. All new service functions are gated the same way existing ones are — the calling API route or server action checks the permission with `requirePermission`/`can`, server-side; the UI additionally hides controls the caller can't use, but that is not the enforcement point.

Synced into the seeded database via the existing idempotent `npm run db:sync-permissions` script (verified: a second run reports "0 permissions added, 0 role grants added").

## 8. Audit

No new audit verbs. New entity types reuse the existing `create`/`update` actions: `maintenance_checklist_template`, `work_order_checklist_result`. Work-order status history continues to be the existing audit-log query (`getWorkOrderHistory`) — no parallel history table was introduced, per the existing "audit log is the status history" design.

## 9. Notifications

No new notification-generation functions were required for the core flows — the pre-existing `generatePreventiveMaintenanceNotifications` (due-soon reminders) and `generateSlaBreachNotifications` (breach alerts, idempotent) already covered the relevant cases and are unmodified. The new `warning` SLA state is available for a future notification type but does not yet have its own generator (see §11).

## 10. API & cron

- `POST /api/v1/maintenance/preventive/generate` — mirrors the existing `/api/v1/maintenance/sla/run` pattern exactly (same auth/rate-limit/response shape), gated by `maintenance:manage`, calling `generateDuePreventiveWorkOrders`. Designed for a future Vercel Cron job; **no `vercel.json` change was made**, per the explicit instruction not to add production cron configuration without separate approval. Manual/local invocation only for now.
- A matching server action `runGenerateDuePreventiveWorkOrdersAction` powers the "Generate Due Work Orders" button in the UI.
- No new authentication mechanism — both routes use the existing `requireApiPermission`/API-key infrastructure.

## 11. UI

- **Maintenance dashboard** (`/maintenance`): added a "Checklists" link to `/maintenance/checklists` (visible to `maintenance:manage` holders).
- **Work order detail** (`/maintenance/[id]`): new "Checklist" card — select a template, see items with any recorded result, and (if the caller has `maintenance:edit` and the order isn't terminal) Pass/Fail/N-A buttons per item; a failed-with-corrective item links to the spawned work order.
- **New page** `/maintenance/checklists`: list of checklist templates, a dialog to create one (dynamic item rows with Required / "Fail → corrective WO" toggles), and the "Generate Due Work Orders" button.
- The extended lifecycle's transition buttons were wired into the existing `WorkOrderStatusActions` component (`TRANSITIONS`/`STATUS_META` maps extended) so a work order that reaches `draft/submitted/approved/on_hold/verified/closed` shows the correct next-step buttons.
- No global redesign — all new UI reuses the existing Card/Table/Dialog/Button/StatusBadge components and design tokens.

## 12. Localization (EN/AR)

All new user-facing strings were added to both `src/i18n/messages/en.ts` and `ar.ts` under `maintenance.*` (checklists page, checklist section, Pass/Fail/N-A, corrective-link text, generate-button toast, and lifecycle labels for submit/approve/on-hold/verify/close). TypeScript's `Messages` type (derived from `en.ts`, enforced structurally on `ar.ts`) guarantees EN/AR key parity at compile time — `npm run typecheck` fails if a key is missing from either file. Verified visually in the browser in both English and Arabic (RTL), including the new Checklist card and the Maintenance Checklists page.

Some deep dialog micro-copy in the new checklist-template creation form (field placeholders, "key"/"Label" column headers) remains English-only — see Known Limitations.

## 13. Testing

`tests/maintenance.test.ts` gained three new `describe` blocks (7 new tests, all passing) alongside the 16 pre-existing ones (23 total in this file):

- **Extended lifecycle**: full draft→…→closed walk, an invalid-jump rejection in the extended lifecycle, and the new SLA `warning` state.
- **Idempotent preventive generation & bulk automation**: same schedule + occurrence date never produces a second work order or occurrence row even when mixing direct calls and the bulk generator; a freshly inserted due schedule generates exactly once and its `next_due_date` only advances on genuine generation.
- **Itemized checklists**: pass/fail/N-A execution, idempotent re-submission (no duplicate result row, no duplicate corrective work order), duplicate-template-code rejection, and unknown-item-key rejection.

Full suite: **462/462 tests passing** (32 files), `npm run typecheck`, `npm run lint`, and `npm run build` all pass clean.

## 14. Performance & security

- All new queries are org-scoped and either point lookups (by unique key) or bounded (`.limit(...)`) list scans, consistent with existing patterns — no unbounded scans were introduced.
- `preventive_maintenance_occurrences`, `maintenance_checklist_templates`, and `work_order_checklist_results` all have appropriate indexes (org-scoped and work-order-scoped) and foreign keys with `onDelete` behavior matching sibling tables.
- No secrets or credentials touched. Document access for checklist-item attachments goes through the existing document-access-control path (not modified).

## 15. Production safety

No Supabase migration, data, or schema change was made. No Vercel deployment, environment-variable change, or `vercel.json` cron change was made. No connection to Dynamics AX was made or attempted. The local PGlite dev database (`.data/riftara-db`) was migrated and reseeded-in-place using the existing `npm run db:migrate` / `db:sync-permissions` / `db:sync-integrations` scripts only.

**Incident note**: during this work, a pre-existing system-level `riftara.service` (systemd, `Restart=always`) was found still running against the same local dev database, which caused schema corruption when a sync script ran concurrently with it (the same class of issue documented from Phase 18). The user stopped and disabled the service; the database was restored from the known-good `~/riftara-backups/riftara-db-pre-repair-backup` backup, migrations 0001–0006 and both sync scripts were reapplied, and all baseline row counts were verified to match exactly before continuing. `riftara.service` remains disabled at the end of this session — re-enable it only if you intend the dev server to run continuously, being mindful not to run migrations while it's active.

## 16. Known limitations / future work

- Photo/document attachment on a checklist item is wired at the data/service level (`documentId` column, reusing the existing document system) but has no dedicated upload UI yet in the checklist panel — a document can currently only be linked programmatically or via the API.
- The new SLA `warning` state is computed but has no dedicated notification generator yet (only `breached` triggers a notification today, via the pre-existing `generateSlaBreachNotifications`).
- The checklist-template creation dialog's item-row inputs (`key`, `Label` placeholders) are not yet localized to Arabic.
- No dedicated Vercel Cron entry was added for `/api/v1/maintenance/preventive/generate` — manual/API-key-driven invocation only, per the instruction not to add production cron configuration without separate approval.
- Global search was not extended to index checklist templates (work orders and assets were already indexed and remain so).
- The extended lifecycle is not yet exposed as a creation-time choice in the "New Work Order" form (new work orders still start at `open`); it is reachable via `transitionWorkOrderStatus` for any work order.
