# Testing

Run everything with `npm test` (Vitest). `npm run verify` also runs typecheck
and lint.

## Layers

### 1. Pure calculation tests — `tests/calculations.test.ts`
Fast, no database. Cover the calculation engine every dashboard and workflow
relies on: occupancy/vacancy, collection rate, NOI & margin, vacancy loss,
WALE, aging, budget variance, payment schedule generation (monthly/quarterly/
annual + escalation + grace), payment allocation, invoice-status derivation,
pricing approval tiers (BR-004), the availability engine (BRD §14, BR-011) and
alternative-unit matching (BRD §30).

### 2. Business-rule integration tests — `tests/business-rules.test.ts`
Run against a **real embedded PostgreSQL** (PGlite) seeded with the demo data.
Prove the database-level guarantees: contract-overlap (BR-003), single active
reservation (BR-002), no-delete for signed contracts and financial records
(BR-012/013), append-only audit and price history (BR-017/005), duplicate
identifier rejection (BR-007), collections reconciliation (BR-015) and the
metrics service (BR-016).

### 3. Workflow / acceptance tests — `tests/workflows.test.ts`
Exercise the BRD acceptance scenarios through the services end-to-end:
- **Leasing lifecycle** (BRD §154): create → sign → unit *Leased* → schedule +
  invoices generated (BR-010).
- **Collections roll-up** (BRD §155): payment → allocation → collected revenue.
- **Maintenance roll-up** (BRD §156): cost → OPEX → NOI decreases (BR-014).
- **Website publishing** (BR-001/009): eligible unit publishes, ineligible unit
  is refused, listing projection created.
- Loss-reason requirement (BR-006) and duplicate-links-not-duplicates (BR-007).

## Determinism
The seed uses a fixed-seed PRNG, so runs are reproducible. The test harness
(`tests/setup-db.ts`) provisions an isolated temp database per file, migrates,
applies constraints and seeds.

## Result
44 tests across 3 files, all passing. Add UI end-to-end coverage (Playwright)
as a follow-up; the acceptance scenarios are already covered at the service
layer.
