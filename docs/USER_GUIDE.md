# User Guide

A module-by-module tour. Sign in at `/login`; on the demo build, pick a role
from the account list (password `Riftara#2025`).

## Navigation
The dark sidebar groups modules (Portfolio, Leasing, Finance, Operations,
Insight, Administration). The top bar has global search (⌘K), a location filter,
language switch (English/العربية), the notification center and your profile
menu. Items you lack permission for are hidden.

## Dashboard
Your executive overview: unit-status KPIs, financial KPIs (portfolio value,
revenue, collections, NOI, occupancy), a **Requires attention** panel of
threshold exceptions, occupancy/collection/value charts, the Units-by-City map,
and Properties Performance / Recent Leads / Upcoming Renewals / Maintenance
tables. Every KPI card and row is clickable and drills into the underlying
records. Use the period selector to change the reporting window.

## Properties
Grid or list view with search, filters (city, type, status) and export. KPI
strip summarizes the portfolio. Open a property for tabs: Overview, Buildings,
Units, Leasing, Financial, Valuation, Expenses, Ownership, Documents, Audit.

**Add a property.** The **Add Property** button opens `/properties/new`, the
property creation route. It requires the `properties:create` permission and is
organization-scoped — the new record is always created under the signed-in
user's organization (a client-supplied organization is never trusted). The form
is grouped into sections: Basic Information, Location & Geography (Region → City
→ District, hierarchically filtered), Management & Organization, Ownership
Information (creates the first owner record when an owner name is given),
Property Technical Information (areas, structure, building systems) and
Additional Information. Property Code, Name, Type, Usage, Status and City are
required. Property codes are unique per organization; a duplicate is reported
inline rather than as a database error. On save you land on the new property's
detail page; **Save & Add Another** keeps you on the form for the next entry.
Every creation writes an entry to the audit trail.

**Edit a property.** An **Edit Property** action is available on the property
detail page and in the **Actions** menu on each property card (both require
`properties:edit`). It reuses the same form, pre-filled with the existing values;
buildings, units and ownership have their own workflows and are never overwritten
by the edit. Saving writes an audit entry and refreshes the data.

**Archive or delete a property.** The **Actions** menu (requires
`properties:delete`) offers **Archive** and **Delete**. Deletion is
dependency-aware and never destructive by default:

- If the property has related records — buildings, units, contracts, invoices,
  payments, reservations, proposals, viewings, leads, work orders, assets,
  valuations or documents — permanent deletion is **blocked**. The dialog lists
  the real counts and directs you to **Archive** instead, which keeps signed
  contracts and financial records intact (BR-012/BR-013).
- **Archive** soft-deletes the property: it is hidden from active lists, metrics
  and search but its data is preserved and it can be restored. Archive is always
  available and is the recommended safe action.
- **Permanent delete** is offered only when the property has *no* dependencies,
  and then requires typing the property name to confirm. It cannot be undone.

Archive and delete both write to the audit trail (`PROPERTY_ARCHIVED` /
`PROPERTY_DELETED`).

## Units
Full inventory filtered by property, type, availability and status. Availability
is **computed** by the engine (from contracts, notice, reservations, maintenance
and turnaround), not just the manual status. Open a unit for its specs, pricing,
availability, lease history and append-only **price history**. With permission
you can publish/unpublish to the website (blocked for ineligible statuses).

## Leasing CRM
**Pipeline** (Kanban) — drag a lead between stages; moving to *Lost* requires a
loss reason. **List** view for filtering. Open a lead for its requirement,
activity timeline and to log follow-ups (keeping a next action). **Customer 360**
shows the complete customer picture: profile, identifiers, leads, viewings,
proposals, reservations and communication timeline. Duplicate customers are
detected on mobile/email/ID/CR and linked, never duplicated.

## Contracts
Lease contracts from draft to renewal, with Ejar reference fields. Open a
contract to see terms, collection summary and the payment schedule. **Sign &
Activate** sets the unit to *Leased*, generates the payment schedule and issues
due invoices — this is irreversible and confirms first.

## Collections
Receivables dashboard: billed/collected/outstanding/overdue KPIs, aging
analysis, collection trend and top overdue tenants. **Record Payment** allocates
oldest-invoice-first and reports any unallocated remainder. The overdue-invoice
table supports export. A tenant's **ledger** (statement of account) is on the
tenant page.

## Tenants
Active/former tenants with contracts, outstanding balances and credit rating.
The tenant page shows contracts, the full ledger and collection-action history.

## Maintenance
Work-order operations with SLA tracking, work-order trend, status donut, vendor
performance and upcoming preventive maintenance. Open a work order for details,
SLA performance and cost records (which roll up into property OPEX and NOI).

## Assets
Operational equipment register (elevators, chillers, generators, pumps, fire
panels, CCTV, access control) with warranty, service schedule and lifetime cost.

## Financials
Portfolio revenue, OPEX, NOI and yield, with NOI/OPEX trend and OPEX by
category. Sub-pages: Operating Expenses, Valuations, Budget vs Actual.

## Reports
Choose a report type, period and scope, add optional commentary, and **Generate
Report** to download a branded PDF (KPIs, financials, occupancy, collections &
aging, maintenance, property ranking, tenant concentration, key risks,
management actions). Generated reports are listed and re-downloadable from their
frozen snapshot.

The **Scheduled Reports** tab lets you have a report generated automatically on
a **daily**, **weekly** or **monthly** cadence. Set the report type, period,
scope, time (hour, and day-of-week/day-of-month), and timezone (defaulting to
your organization's). Scheduled reports run with *your* access rights, so a
schedule never exposes data you could not generate yourself. Use **Run Now** to
generate on demand, enable/disable a schedule, or open **View History** to see
each run's status, duration and any failure reason. Reports are made available
in-app and are downloadable; external email/SMS/WhatsApp delivery is not yet
enabled. A failed run raises a notification for report viewers.

## Marketing
Attribution across channels: spend, leads, CPL, ROAS, leads-by-channel, trend
and campaign performance.

## Integrations
The Integration Hub shows each connector's real status — **Not Connected**,
**Configuration Required**, **Connected** or **Error** — derived from whether its
credentials are configured. Status is never faked.

## Users & Permissions
Users with their roles, data scope and last login. **Roles** shows each role's
permission and user counts; **Permissions** shows the full role × permission
matrix.

## Settings
Business rules and their enforcement, configurable thresholds (approvals, SLA,
aging, reservation validity, KPI thresholds…), taxonomies, unit statuses and the
lead pipeline — all editable without a code change.

## Language
Switch to العربية from the top bar; the entire interface mirrors to RTL with the
Arabic font.
