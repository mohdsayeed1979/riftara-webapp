# Phase 20A — Bulk Property & Unit Import

## 1. Scope and philosophy

Phase 20A adds a production-quality bulk import workflow for Properties and Units, built entirely on RIFTARA's existing schema and infrastructure:

- **No new database tables.** `import_batches` and `import_errors` already existed in the schema (comment: "BRD 135"), fully defined but never wired to any service. Phase 20A implements the missing service/API/UI layer on top of them — additive columns only (see §2).
- **No new authentication.** Uses the existing `requireApiPermission`/API-key architecture.
- **No new audit system.** Reuses `recordAudit` and the existing fixed audit-verb enum (`import` was already a valid verb).
- **No new file library.** Uses `exceljs`, already a dependency, for both reading uploads and building templates.
- **No duplicate property/unit system.** Import always resolves against and writes through the real `properties`/`units`/`unitPricing` tables using the same validation invariants as the interactive forms — it is a bulk front door to the same data, not a parallel path.

## 2. Database changes (migration `0007_yielding_ricochet.sql`)

Purely additive columns on the pre-existing `import_batches` table:

- `file_type` (xlsx | csv)
- `mode` (create_only | update_existing | create_and_update)
- `updated_rows`, `skipped_rows`, `warning_rows` (integers, default 0)
- `started_at`, `error_summary`

`status` was already a free-form `varchar`, so the fuller status vocabulary (`uploaded → validating → ready → importing → completed → completed_with_errors → failed → rolled_back`) needed no schema change — only new string values by convention.

Two new RBAC permissions were added to the existing catalog by reusing the **already-defined global `manage` action** (no new action, no new module): `properties:manage` and `units:manage`.

## 3. Supported formats

`.xlsx` and `.csv`. Uploads are validated against the existing `ALLOWED_UPLOAD_TYPES` allow-list (`src/lib/documents/constants.ts`) — same MIME/extension consistency check used by the document-upload system — and capped at `STORAGE_MAX_UPLOAD_MB` (25 MB by default, the same env var the document system uses). Files are parsed **in memory only** and never written to disk or to the document store.

## 4. Property import template

Sheet **Properties**, columns:

| Column | Maps to | Required |
|---|---|---|
| Property Code | `properties.code` | Yes — unique per organization |
| Property Name (EN) | `properties.nameEn` | Yes |
| Property Name (AR) | `properties.nameAr` | No |
| Property Type | `properties.propertyTypeId` (resolved by name/key against `property_types`) | Yes |
| City | `properties.cityId` (resolved against `cities`) | Yes |
| District | `properties.districtId` (resolved against `districts`, scoped to the resolved City) | No |
| Address | `properties.addressLine` | No |
| Status | `properties.status` (`active`/`under_construction`/`under_renovation`/`planned`/`disposed`/`inactive`) | No — defaults to `active` |
| Description | `properties.descriptionEn` | No |

**Never imported**: Total Units, Occupied, Available, Occupancy % and Annual Rental Value — all of these are derived by RIFTARA from actual unit/contract data (`metrics-service.ts`) and would silently desynchronize dashboards if a spreadsheet value could override them. The reference workbook (`riftara-properties-2026-09-17.xlsx`) contains these columns for human reporting only; the import template deliberately omits them.

Sheet **Instructions**: required/optional fields, allowed Status values, duplicate/update behavior, and the note that these derived fields are intentionally absent.

## 5. Unit import template

Sheet **Units**, columns:

| Column | Maps to | Required |
|---|---|---|
| Property Code | resolves `units.propertyId` | Yes |
| Building Code | resolves `units.buildingId` (must already exist under the resolved property) | No |
| Floor | resolves `units.floorId` (matched by floor name or numeric level within the resolved building) | No |
| Unit Code | `units.code` | Yes — unique per organization |
| Unit Number | `units.unitNumber` | Yes |
| Unit Type | `units.unitTypeId` (resolved against `unit_types`; also supplies the derived `usageType`) | Yes |
| Unit Status | `units.statusId` (resolved against `unit_statuses`) | Yes |
| Bedrooms | `units.bedroomCount` | No |
| Bathrooms | `units.bathroomCount` | No |
| Area (sqm) | `units.grossArea` | No |
| Annual Rent (SAR) | `unit_pricing.askingRent` (RIFTARA stores rent as an annual figure — there is no separate "monthly rent" column in the schema, so none was invented) | No |
| Description | `units.descriptionEn` | No |

**Never imported**: computed availability class / available-from date — always derived by the existing availability engine (`computeUnitAvailability`) from status, contracts and reservations, run immediately after every import (see §8).

## 6. Combined workbook

`GET /api/v1/import/templates/properties?combined=true` returns a single workbook with **Properties**, **Units**, and **Instructions** sheets. A combined file is also accepted directly by either the Properties or Units import dialog — the parser looks for a sheet literally named "Properties" and/or "Units" (case-insensitive) and processes whichever are present. Units reference their parent by Property Code, resolved first against properties **created or updated earlier in the same file**, then against the database.

## 7. Import order (enforced by `buildPreview` / `executeImport`)

1. All Properties rows are validated against master data and existing records.
2. All Units rows are validated — Property Code is checked against both the database and the just-validated Properties rows (so a brand-new property and its units can be imported together).
3. If any row is an error and the caller has not opted into "import valid rows only", **nothing is written** — the whole batch fails with a `VALIDATION` error and a downloadable error report.
4. Otherwise, Properties are created/updated first inside one transaction, then Units (so a new unit can resolve its just-created parent property's real id), then one `import` audit entry is recorded for the batch.
5. Only after the transaction commits does the availability engine run per created/updated unit (see §8 for why this ordering is mandatory).
6. The `import_batches` row is updated with final counts and status.

## 8. Duplicate handling & import modes

Identity keys: **Property Code** (per organization) for properties; **Unit Code** (per organization) for units — matching the existing unique database constraints (`properties_org_code_uq`, `units_org_code_uq`).

- **Create Only** (default): an existing code is skipped (not duplicated) and reported as a duplicate/warning row, not an error.
- **Update Existing**: an existing code is updated in place (with a field-level before/after diff surfaced in the preview); a code that does **not** already exist is a validation error.
- **Create + Update**: new codes are created, existing codes are updated.

Master data (Property Type, City, District, Unit Type, Unit Status, Building, Floor) is **never** auto-created from an import row — a near-miss spelling (e.g. "Granadaaa" vs "Granada") is always a validation error naming both the value and, for District, the City it was checked against.

## 9. Validation engine

`src/services/import-service.ts` — `validateProperties` / `validateUnits` implement, per row: required-field checks, master-data resolution (org-scoped, case-insensitive exact match), enum validation (Status), in-file duplicate detection, existing-record duplicate detection, and (for units) the Property → Building → Floor relationship chain, with cascading errors when a parent reference is itself invalid. `buildPreview` runs both and returns per-section summaries (total/create/update/skip/error/warning) plus every row's individual result — used by both the `/validate` endpoints and, defensively, re-run again inside `/execute` (a client-held preview is never trusted for the actual write).

## 10. Transaction safety

`executeImport` opens exactly one `db.transaction()` covering every Property and Unit write for the batch. A thrown error anywhere inside it rolls back the entire transaction — verified by a dedicated test that a row failing validation prevents even the *other, valid* rows in the same call from being written, unless `skipErrorRows` is explicitly set (the UI's "Import valid rows only" checkbox). The availability engine is deliberately run **after** the transaction commits (it reads organization settings on its own connection) — running it inside the transaction would risk the same PGlite single-connection nested-transaction deadlock documented from earlier phases.

**Known scaling note**: unit-row master-data lookups (building/floor) are performed per row rather than batched, which is correct but not optimized for very large files — acceptable for the demo/local scale exercised here; see §16.

## 11. Import history

`import_batches` rows are queryable via `GET /api/v1/import/history` (list) and `GET /api/v1/import/history/[id]` (detail) — visible to anyone holding `properties:manage` or `units:manage`. Each row records: entity type, filename, file type, mode, full row counts (total/valid/invalid/duplicate/imported/updated/skipped/warning), the created entity ids (for potential future rollback tooling — the column already existed for this), timestamps, the acting user, and an error summary on failure.

## 12. Error report

`GET /api/v1/import/history/[id]/errors?format=xlsx|csv` — built with the existing branded `buildWorkbook`/`buildCsv` export helpers (same ones the Properties/Units export buttons already use). Columns: Row Number, Property Code, Unit Code, Field, Value, Error Type, Error Message — matching the task's example exactly (e.g. `14 | RYD-GRN-014 | | District | Granadaaa | NOT_FOUND | City "Riyadh" is valid but District "Granadaaa" was not found.`).

## 13. API routes

| Route | Purpose | Permission |
|---|---|---|
| `POST /api/v1/import/properties/validate` | Preview a Properties (or combined) file | `properties:manage` |
| `POST /api/v1/import/properties/execute` | Import a Properties (or combined) file | `properties:manage` |
| `POST /api/v1/import/units/validate` | Preview a Units-only file | `units:manage` |
| `POST /api/v1/import/units/execute` | Import a Units-only file | `units:manage` |
| `GET /api/v1/import/templates/properties[?combined=true]` | Download the Property (or combined) template | `properties:manage` |
| `GET /api/v1/import/templates/units` | Download the Unit template | `units:manage` |
| `GET /api/v1/import/history` | List recent batches | `properties:manage` OR `units:manage` |
| `GET /api/v1/import/history/[id]` | Batch detail | `properties:manage` OR `units:manage` |
| `GET /api/v1/import/history/[id]/errors` | Downloadable error report | `properties:manage` OR `units:manage` |

All `validate`/`execute` requests are `multipart/form-data`: `file` (required), `mode` (optional, default `create_only`), `skipErrorRows` (execute only, `"true"`/`"false"`).

## 14. RBAC

`properties:manage` and `units:manage` were added to the catalog (reusing the existing `manage` action already used elsewhere, e.g. `documents:manage`, `settings:manage`) and are automatically granted to every role already holding `all('properties')` / `all('units')` (property managers, admins) via the existing role-composition helpers — no manual per-role edits were needed. Read-only roles (Auditor, Finance, Leasing Agent where applicable) do **not** receive it, verified by a dedicated test. Enforcement is entirely server-side in the API routes (`requireApiPermission`); the UI additionally hides the Import button for callers without the permission, but that is not the enforcement boundary.

## 15. Audit

No new audit verbs. Property/Unit creates and updates via import use the existing `create`/`update` verbs with `reason: "Bulk import (batch <id>)"` so they're distinguishable from interactively-created records in the audit trail. One additional `import` audit entry (an already-existing verb in the fixed enum) is recorded per successful batch against `entityType: 'import_batch'`.

## 16. Known limitations

- Buildings and Floors are **never auto-created** by import — a unit row referencing a Building/Floor Code that doesn't yet exist is a validation error, not a new record. Bulk-importing a brand-new multi-building property therefore still requires creating its buildings/floors through the existing UI first. This is a deliberate scope boundary, not an oversight — the task explicitly warns against unintentionally duplicating master data.
- Per-row Building/Floor lookups in `validateUnits` are not batched; this is correct at the row counts exercised here but is a reasonable target for a follow-up performance pass if files reach many thousands of unit rows.
- No rollback UI yet for a completed batch, even though `import_batches.createdEntityIds` already captures everything needed for one — implementing "undo this import" is a natural Phase 20B candidate.
- The `skipErrorRows` ("import valid rows only") path does not currently re-run in a *second* transaction per section — it commits everything valid in the one transaction and simply doesn't throw on the leftover errors, which is intentionally simpler than a partial-retry design.
- Ownership, technical specifications (elevators, HVAC, fire systems, etc.), pricing beyond annual rent, and website-publication fields are out of scope for bulk import in this phase — they use the existing single-record forms, consistent with the task's "do not invent fields" instruction and the reference workbook's own column set.

## 17. Usage

1. On the Properties or Units page, click **Import**.
2. Choose an import mode (Create Only / Update Existing / Create + Update).
3. Download the relevant template (or the combined one, from the Properties dialog) if you don't already have a file in the right shape.
4. Upload your `.xlsx` or `.csv` file and click **Validate File**.
5. Review the per-section summary and row-level results. Fix and re-upload if there are errors, or check "Import valid rows only" to proceed with just the valid rows.
6. Click **Import Valid Rows**. The result screen shows imported/updated/skipped/error counts and a **Download Error Report** link.
