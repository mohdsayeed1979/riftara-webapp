# RIFTARA — Enterprise Property, Leasing & Asset Management Platform

RIFTARA is the organization's real estate operating system: a single, secure,
API-first platform that manages the complete lifecycle of properties, units,
pricing, leasing, contracts, collections, maintenance, assets, marketing and
executive reporting.

It is built to the [Business Requirements Document](reference/Enterprise_Property_Leasing_Asset_Management_BRD.pdf)
and the [UI/UX Design Package](reference/RIFTARA_UI_UX_Design_Package.pdf), and is
architected from day one for scale (100,000+ units, 1,000,000+ leads),
Arabic RTL, and enterprise integration.

> **Not a demo shell.** Every screen is data-driven, every important action
> persists, business rules are enforced at the database level, and the KPIs on
> every dashboard reconcile with the underlying transactions.

---

## Highlights

- **Executive Portfolio Dashboard** — occupancy, portfolio value, collections,
  NOI, exceptions and drill-down, all computed from real data.
- **Property & Unit management** — flexible hierarchy (Portfolio → Region →
  City → District → Property → Building → Floor → Unit), availability engine,
  pricing engine with append-only price history and configurable approvals.
- **Leasing CRM** — Kanban pipeline, Customer 360, duplicate detection,
  viewings, versioned proposals, reservations, lead SLA.
- **Contracts & Collections** — Ejar-aligned contracts, payment schedules,
  invoices, oldest-first payment allocation, tenant ledger, aging analysis.
- **Maintenance & Assets** — work orders with SLA tracking, preventive
  maintenance, asset register, cost roll-up into OPEX and NOI.
- **Financials** — OPEX, budgets vs actual, valuations, portfolio value.
- **Marketing attribution**, **Integration Hub** (real connection status,
  never faked), **versioned REST API**, **Excel/CSV/PDF exports**,
  **notification center**, **audit trail**, **RBAC with data-level scoping**.
- **English (LTR) and Arabic (RTL)** from the ground up.

## Technology

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Server Components, Server Actions, Route Handlers) |
| Language | TypeScript (strict) |
| UI | Tailwind CSS v4 design tokens, Radix UI primitives, Recharts, Lucide |
| Database | PostgreSQL via Drizzle ORM — embedded **PGlite** for local dev, managed Postgres/**Supabase** for production |
| Auth | Credentials + JWT sessions (scrypt hashing), Supabase-Auth-ready |
| Exports | ExcelJS (xlsx/csv), PDFKit (branded PDF) |
| Tests | Vitest (unit + integration against a real database) |

The database driver is swapped with a single environment variable
(`DATABASE_DRIVER`); no application code changes.

---

## Quick start

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env          # a working local .env is created for you

# 3. Create the schema + integrity constraints, then load demo data
npm run db:setup              # = db:migrate + db:seed

# 4. Run
npm run dev                   # http://localhost:3000
```

### Demo accounts

All demo accounts use the password **`Riftara#2025`** (from `SEED_DEFAULT_PASSWORD`).
The login screen lists them for one-click sign-in.

| Email | Role |
| --- | --- |
| `sayeed.almousa@riftara.sa` | Super Admin |
| `khalid.alrashid@riftara.sa` | Executive Management |
| `sarah.mohammed@riftara.sa` | Leasing Manager |
| `omar.alqahtani@riftara.sa` | Finance |
| `ali.kamal@riftara.sa` | Maintenance Manager |
| `tariq.alnasser@riftara.sa` | Auditor (read-only + audit trail) |

Sign in as different roles to see role-based access control in action.

---

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run db:migrate` | Apply schema migrations + integrity constraints |
| `npm run db:seed` | Load (or reset + reload) the realistic demo dataset |
| `npm run db:setup` | Migrate then seed |
| `npm run db:reset` | Drop, migrate and reseed from scratch |
| `npm run test` | Run the full test suite |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run verify` | typecheck + lint + test |

---

## Documentation

| Document | Contents |
| --- | --- |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, layering, data flow, scalability |
| [DATABASE.md](docs/DATABASE.md) | Schema, entities, constraints, indexes |
| [API.md](docs/API.md) | REST API reference, auth, rate limiting, webhooks |
| [SECURITY.md](docs/SECURITY.md) | Security controls, data privacy, audit |
| [RBAC.md](docs/RBAC.md) | Roles, permissions and the permission matrix |
| [BUSINESS_RULES.md](docs/BUSINESS_RULES.md) | BR-001…BR-018 and where each is enforced |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production deployment, Supabase setup |
| [ENVIRONMENT.md](docs/ENVIRONMENT.md) | Every environment variable |
| [TESTING.md](docs/TESTING.md) | Test strategy and coverage |
| [USER_GUIDE.md](docs/USER_GUIDE.md) | Module-by-module user guide |

---

## Project status

Phase 1 of the BRD is implemented end-to-end. Phase 2 integrations (Ejar,
payment gateway, marketing platform APIs, Zoho, monday.com) are architected and
appear in the Integration Hub as *Not Connected / Configuration Required* until
their credentials are supplied — connection status is derived from real
credentials and is never faked.

Real Assets. Greater Possibilities.
