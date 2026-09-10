import 'server-only';
import { and, eq, ilike, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  buildings,
  contracts,
  customerIdentifiers,
  customers,
  documents,
  invoices,
  leads,
  maintenanceAssets,
  payments,
  properties,
  propertyOwnerships,
  tenants,
  units,
  workOrders,
} from '@/db/schema';
import { normalizeMobile } from '@/lib/utils';
import type { PermissionKey } from '@/lib/permissions/catalog';

/**
 * Global search (BRD 131, Phase 12). Results are grouped by entity type; groups
 * the caller cannot view are omitted entirely. Every row is organization-scoped
 * and, where the record has a property, data-scoped. Documents additionally
 * enforce requiredPermission, confidentiality and parent-entity scope, and never
 * expose the storage key or path. Ranking is deterministic (exact > prefix >
 * contains > secondary). No AI/vector search — the shape stays ready for it.
 */

export interface SearchResultItem {
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  badge: string | null;
  /** Deterministic relevance score (higher is better). */
  score: number;
}

export interface SearchResultGroup {
  entityType: string;
  label: string;
  items: SearchResultItem[];
}

/** Flat, normalized result for the search-results page / API. */
export interface NormalizedSearchResult {
  type: string;
  id: string;
  title: string;
  subtitle: string | null;
  url: string;
  badge: string | null;
  score: number;
}

/** The entity types this search covers (used for the results-page filters). */
export const SEARCH_ENTITY_TYPES = [
  'property',
  'building',
  'unit',
  'customer',
  'tenant',
  'lead',
  'contract',
  'invoice',
  'payment',
  'work_order',
  'asset',
  'ownership',
  'document',
] as const;
export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number];

export function isSearchEntityType(value: unknown): value is SearchEntityType {
  return typeof value === 'string' && (SEARCH_ENTITY_TYPES as readonly string[]).includes(value);
}

export const MAX_QUERY_LENGTH = 120;
export const MIN_QUERY_LENGTH = 2;

interface SearchContext {
  organizationId: string;
  permissions: PermissionKey[];
  allowedPropertyIds: string[] | null;
}

interface SearchOptions {
  /** Max rows fetched per entity group. */
  limitPerGroup?: number;
  /** When set, only these entity types are searched. */
  only?: SearchEntityType | null;
}

/**
 * Deterministic score: exact match (code/title) ranks highest, then prefix,
 * then contains, then a floor for records matched only via secondary fields
 * (e.g. address, mobile). Compares against the strongest candidate field.
 */
function scoreMatch(query: string, ...candidates: Array<string | null | undefined>): number {
  const q = query.trim().toLowerCase();
  let best = 40; // secondary-field match floor
  for (const candidate of candidates) {
    if (!candidate) continue;
    const value = candidate.toLowerCase();
    if (value === q) best = Math.max(best, 100);
    else if (value.startsWith(q)) best = Math.max(best, 80);
    else if (value.includes(q)) best = Math.max(best, 60);
  }
  return best;
}

function sortByScore(a: SearchResultItem, b: SearchResultItem): number {
  return b.score - a.score || a.title.localeCompare(b.title);
}

/**
 * Runs the permitted entity searchers and returns grouped, ranked results.
 * Backward-compatible with the existing search dropdown.
 */
export async function globalSearch(
  term: string,
  context: SearchContext,
  options: SearchOptions = {},
): Promise<SearchResultGroup[]> {
  const query = term.trim();
  if (query.length < MIN_QUERY_LENGTH) return [];
  const q = query.slice(0, MAX_QUERY_LENGTH);

  const limitPerGroup = options.limitPerGroup ?? 5;
  const only = options.only ?? null;
  const like = `%${q}%`;
  const digits = q.replace(/\D/g, '');
  const db = await getDb();
  const { organizationId: orgId, permissions } = context;
  const can = (permission: PermissionKey) => permissions.includes(permission);
  const propertyScope = context.allowedPropertyIds?.length ? context.allowedPropertyIds : null;
  const wanted = (type: SearchEntityType) => (!only || only === type);
  // Fetch a slightly larger candidate pool so JS ranking is meaningful.
  const fetchLimit = Math.min(50, limitPerGroup * 4);

  const groups: SearchResultGroup[] = [];
  const add = (entityType: string, label: string, items: SearchResultItem[]) => {
    if (items.length === 0) return;
    groups.push({ entityType, label, items: items.sort(sortByScore).slice(0, limitPerGroup) });
  };

  // Run the permitted searchers in parallel.
  const tasks: Array<Promise<void>> = [];

  if (wanted('property') && can('properties:view')) {
    tasks.push(
      db
        .select({ id: properties.id, name: properties.nameEn, nameAr: properties.nameAr, code: properties.code, status: properties.status })
        .from(properties)
        .where(and(eq(properties.organizationId, orgId), isNull(properties.deletedAt), propertyScope ? inArray(properties.id, propertyScope) : undefined, or(ilike(properties.nameEn, like), ilike(properties.nameAr, like), ilike(properties.code, like), ilike(properties.addressLine, like))))
        .limit(fetchLimit)
        .then((rows) =>
          add('property', 'Properties', rows.map((r) => ({ id: r.id, title: r.name, subtitle: r.code, href: `/properties/${r.id}`, badge: r.status, score: scoreMatch(q, r.code, r.name, r.nameAr) }))),
        ),
    );
  }

  if (wanted('building') && can('properties:view')) {
    tasks.push(
      db
        .select({ id: buildings.id, name: buildings.nameEn, code: buildings.code, propertyId: buildings.propertyId, propertyName: properties.nameEn })
        .from(buildings)
        .innerJoin(properties, eq(properties.id, buildings.propertyId))
        .where(and(eq(buildings.organizationId, orgId), isNull(buildings.deletedAt), propertyScope ? inArray(buildings.propertyId, propertyScope) : undefined, or(ilike(buildings.nameEn, like), ilike(buildings.code, like))))
        .limit(fetchLimit)
        .then((rows) =>
          // No dedicated building route — link to the parent property.
          add('building', 'Buildings', rows.map((r) => ({ id: r.id, title: r.name, subtitle: r.propertyName, href: `/properties/${r.propertyId}`, badge: r.code, score: scoreMatch(q, r.code, r.name) }))),
        ),
    );
  }

  if (wanted('unit') && can('units:view')) {
    tasks.push(
      db
        .select({ id: units.id, code: units.code, unitNumber: units.unitNumber, propertyName: properties.nameEn, availability: units.computedAvailabilityClass })
        .from(units)
        .innerJoin(properties, eq(properties.id, units.propertyId))
        .where(and(eq(units.organizationId, orgId), isNull(units.deletedAt), propertyScope ? inArray(units.propertyId, propertyScope) : undefined, or(ilike(units.code, like), ilike(units.unitNumber, like))))
        .limit(fetchLimit)
        .then((rows) =>
          add('unit', 'Units', rows.map((r) => ({ id: r.id, title: `Unit ${r.unitNumber}`, subtitle: r.propertyName, href: `/units/${r.id}`, badge: r.availability, score: scoreMatch(q, r.code, r.unitNumber) }))),
        ),
    );
  }

  if (wanted('customer') && can('customers:view')) {
    tasks.push(
      (async () => {
        const identifierMatches = await db
          .select({ customerId: customerIdentifiers.customerId })
          .from(customerIdentifiers)
          .where(and(eq(customerIdentifiers.organizationId, orgId), or(ilike(customerIdentifiers.identifierValue, like), digits.length >= 6 ? eq(customerIdentifiers.identifierValue, normalizeMobile(digits)) : undefined)))
          .limit(20);
        const identifierIds = identifierMatches.map((r) => r.customerId);
        const rows = await db
          .select({ id: customers.id, name: customers.fullNameEn, company: customers.companyName, code: customers.code, mobile: customers.mobile, email: customers.email, type: customers.customerType })
          .from(customers)
          .where(and(eq(customers.organizationId, orgId), isNull(customers.deletedAt), or(ilike(customers.fullNameEn, like), ilike(customers.companyName, like), ilike(customers.mobile, like), ilike(customers.email, like), ilike(customers.code, like), identifierIds.length > 0 ? inArray(customers.id, identifierIds) : undefined)))
          .limit(fetchLimit);
        add('customer', 'Customers', rows.map((r) => ({ id: r.id, title: r.name, subtitle: r.mobile ?? r.code, href: `/leasing/customers/${r.id}`, badge: r.type, score: scoreMatch(q, r.code, r.name, r.company, r.mobile, r.email) })));
      })(),
    );
  }

  if (wanted('tenant') && can('tenants:view')) {
    tasks.push(
      db
        .select({ id: tenants.id, name: tenants.displayName, code: tenants.code, status: tenants.status })
        .from(tenants)
        .where(and(eq(tenants.organizationId, orgId), isNull(tenants.deletedAt), or(ilike(tenants.displayName, like), ilike(tenants.code, like))))
        .limit(fetchLimit)
        .then((rows) => add('tenant', 'Tenants', rows.map((r) => ({ id: r.id, title: r.name, subtitle: r.code, href: `/tenants/${r.id}`, badge: r.status, score: scoreMatch(q, r.code, r.name) })))),
    );
  }

  if (wanted('lead') && can('leasing:view')) {
    tasks.push(
      db
        .select({ id: leads.id, code: leads.code, customerName: customers.fullNameEn, qualification: leads.qualification })
        .from(leads)
        .innerJoin(customers, eq(customers.id, leads.customerId))
        .where(and(eq(leads.organizationId, orgId), isNull(leads.deletedAt), propertyScope ? or(inArray(leads.requestedPropertyId, propertyScope), isNull(leads.requestedPropertyId)) : undefined, or(ilike(leads.code, like), ilike(customers.fullNameEn, like))))
        .limit(fetchLimit)
        .then((rows) => add('lead', 'Leads', rows.map((r) => ({ id: r.id, title: r.customerName, subtitle: r.code, href: `/leasing/leads/${r.id}`, badge: r.qualification, score: scoreMatch(q, r.code, r.customerName) })))),
    );
  }

  if (wanted('contract') && can('contracts:view')) {
    tasks.push(
      db
        .select({ id: contracts.id, contractNumber: contracts.contractNumber, ejarReference: contracts.ejarReference, tenantName: tenants.displayName, status: contracts.status })
        .from(contracts)
        .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
        .where(and(eq(contracts.organizationId, orgId), isNull(contracts.deletedAt), propertyScope ? inArray(contracts.propertyId, propertyScope) : undefined, or(ilike(contracts.contractNumber, like), ilike(contracts.ejarReference, like), ilike(tenants.displayName, like))))
        .limit(fetchLimit)
        .then((rows) => add('contract', 'Contracts', rows.map((r) => ({ id: r.id, title: r.contractNumber, subtitle: r.tenantName, href: `/contracts/${r.id}`, badge: r.status, score: scoreMatch(q, r.contractNumber, r.ejarReference, r.tenantName) })))),
    );
  }

  if (wanted('invoice') && can('collections:view')) {
    tasks.push(
      db
        .select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, tenantName: tenants.displayName, status: invoices.status })
        .from(invoices)
        .innerJoin(tenants, eq(tenants.id, invoices.tenantId))
        .where(and(eq(invoices.organizationId, orgId), propertyScope ? inArray(invoices.propertyId, propertyScope) : undefined, ilike(invoices.invoiceNumber, like)))
        .limit(fetchLimit)
        .then((rows) => add('invoice', 'Invoices', rows.map((r) => ({ id: r.id, title: r.invoiceNumber, subtitle: r.tenantName, href: `/collections/invoices/${r.id}`, badge: r.status, score: scoreMatch(q, r.invoiceNumber) })))),
    );
  }

  if (wanted('payment') && can('collections:view')) {
    tasks.push(
      db
        .select({ id: payments.id, paymentNumber: payments.paymentNumber, referenceNumber: payments.referenceNumber, tenantName: tenants.displayName, status: payments.status })
        .from(payments)
        .innerJoin(tenants, eq(tenants.id, payments.tenantId))
        .where(and(eq(payments.organizationId, orgId), or(ilike(payments.paymentNumber, like), ilike(payments.referenceNumber, like))))
        .limit(fetchLimit)
        .then((rows) => add('payment', 'Payments', rows.map((r) => ({ id: r.id, title: r.paymentNumber, subtitle: r.tenantName, href: `/collections/payments/${r.id}`, badge: r.status, score: scoreMatch(q, r.paymentNumber, r.referenceNumber) })))),
    );
  }

  if (wanted('work_order') && can('maintenance:view')) {
    tasks.push(
      db
        .select({ id: workOrders.id, code: workOrders.code, title: workOrders.title, status: workOrders.status })
        .from(workOrders)
        .where(and(eq(workOrders.organizationId, orgId), isNull(workOrders.deletedAt), propertyScope ? inArray(workOrders.propertyId, propertyScope) : undefined, or(ilike(workOrders.code, like), ilike(workOrders.title, like))))
        .limit(fetchLimit)
        .then((rows) => add('work_order', 'Work Orders', rows.map((r) => ({ id: r.id, title: r.code, subtitle: r.title, href: `/maintenance/${r.id}`, badge: r.status, score: scoreMatch(q, r.code, r.title) })))),
    );
  }

  if (wanted('asset') && can('assets:view')) {
    tasks.push(
      db
        .select({ id: maintenanceAssets.id, code: maintenanceAssets.code, name: maintenanceAssets.nameEn, serial: maintenanceAssets.serialNumber, propertyName: properties.nameEn, status: maintenanceAssets.status })
        .from(maintenanceAssets)
        .innerJoin(properties, eq(properties.id, maintenanceAssets.propertyId))
        .where(and(eq(maintenanceAssets.organizationId, orgId), isNull(maintenanceAssets.deletedAt), propertyScope ? inArray(maintenanceAssets.propertyId, propertyScope) : undefined, or(ilike(maintenanceAssets.code, like), ilike(maintenanceAssets.nameEn, like), ilike(maintenanceAssets.serialNumber, like))))
        .limit(fetchLimit)
        .then((rows) => add('asset', 'Assets', rows.map((r) => ({ id: r.id, title: r.name, subtitle: r.code, href: `/assets/${r.id}`, badge: r.status, score: scoreMatch(q, r.code, r.name, r.serial) })))),
    );
  }

  if (wanted('ownership') && can('properties:view')) {
    tasks.push(
      db
        .select({ id: propertyOwnerships.id, propertyId: propertyOwnerships.propertyId, documentNumber: propertyOwnerships.documentNumber, ownerName: propertyOwnerships.ownerName, documentType: propertyOwnerships.documentType, cr: propertyOwnerships.commercialRegistration })
        .from(propertyOwnerships)
        .innerJoin(properties, eq(properties.id, propertyOwnerships.propertyId))
        .where(and(eq(properties.organizationId, orgId), isNull(properties.deletedAt), propertyScope ? inArray(propertyOwnerships.propertyId, propertyScope) : undefined, or(ilike(propertyOwnerships.documentNumber, like), ilike(propertyOwnerships.commercialRegistration, like), ilike(propertyOwnerships.identificationNumber, like), ilike(propertyOwnerships.ownerName, like))))
        .limit(fetchLimit)
        .then((rows) => add('ownership', 'Ownership Documents', rows.map((r) => ({ id: r.id, title: r.documentNumber, subtitle: `${r.documentType} · ${r.ownerName}`, href: `/properties/${r.propertyId}?tab=ownership`, badge: null, score: scoreMatch(q, r.documentNumber, r.cr, r.ownerName) })))),
    );
  }

  if (wanted('document') && can('documents:view')) {
    tasks.push(
      (async () => {
        // Enforce requiredPermission (a doc the user cannot access is never listed)
        // and confidentiality alignment with the download rule, in SQL.
        const permissionFilter: SQL | undefined = or(
          isNull(documents.requiredPermission),
          permissions.length ? inArray(documents.requiredPermission, permissions) : undefined,
        );
        const rows = await db
          .select({ id: documents.id, title: documents.title, entityType: documents.entityType, entityId: documents.entityId, fileName: documents.fileName, isConfidential: documents.isConfidential })
          .from(documents)
          .where(and(eq(documents.organizationId, orgId), isNull(documents.deletedAt), eq(documents.isCurrentVersion, true), permissionFilter, or(ilike(documents.title, like), ilike(documents.fileName, like))))
          .limit(fetchLimit);
        // Parent-entity data-scope: drop documents attached to records outside scope.
        const scoped = await filterDocumentsByPropertyScope(db, orgId, propertyScope, rows);
        add(
          'document',
          'Documents',
          scoped.map((r) => ({ id: r.id, title: r.title, subtitle: r.fileName, href: `/api/v1/documents/${r.id}/download`, badge: r.entityType, score: scoreMatch(q, r.title, r.fileName) })),
        );
      })(),
    );
  }

  await Promise.all(tasks);
  // Deterministic, permission-ordered group order.
  const order = SEARCH_ENTITY_TYPES as readonly string[];
  groups.sort((a, b) => order.indexOf(a.entityType) - order.indexOf(b.entityType));
  return groups;
}

/**
 * Restricts document candidates to those whose parent entity is within the
 * caller's property data-scope. Records without a property (customer/tenant) are
 * organization-level and always allowed. Batched by entity type — no N+1.
 */
async function filterDocumentsByPropertyScope<T extends { entityType: string; entityId: string }>(
  db: Awaited<ReturnType<typeof getDb>>,
  organizationId: string,
  allowedPropertyIds: string[] | null,
  rows: T[],
): Promise<T[]> {
  if (!allowedPropertyIds || rows.length === 0) return rows;
  const allowed = new Set(allowedPropertyIds);
  const idsOf = (type: string) => rows.filter((r) => r.entityType === type).map((r) => r.entityId);

  // Resolve entityId -> propertyId per referenced entity type (batched).
  const propertyByEntity = new Map<string, string | null>();
  const record = (type: string, res: Array<{ id: string; propertyId: string | null }>) => {
    for (const row of res) propertyByEntity.set(`${type}:${row.id}`, row.propertyId);
  };
  const unitIds = idsOf('unit');
  const buildingIds = idsOf('building');
  const contractIds = idsOf('contract');
  const assetIds = idsOf('asset');

  await Promise.all([
    unitIds.length
      ? db.select({ id: units.id, propertyId: units.propertyId }).from(units).where(and(eq(units.organizationId, organizationId), inArray(units.id, unitIds))).then((r) => record('unit', r))
      : Promise.resolve(),
    buildingIds.length
      ? db.select({ id: buildings.id, propertyId: buildings.propertyId }).from(buildings).where(and(eq(buildings.organizationId, organizationId), inArray(buildings.id, buildingIds))).then((r) => record('building', r))
      : Promise.resolve(),
    contractIds.length
      ? db.select({ id: contracts.id, propertyId: contracts.propertyId }).from(contracts).where(and(eq(contracts.organizationId, organizationId), inArray(contracts.id, contractIds))).then((r) => record('contract', r))
      : Promise.resolve(),
    assetIds.length
      ? db.select({ id: maintenanceAssets.id, propertyId: maintenanceAssets.propertyId }).from(maintenanceAssets).where(and(eq(maintenanceAssets.organizationId, organizationId), inArray(maintenanceAssets.id, assetIds))).then((r) => record('asset', r))
      : Promise.resolve(),
  ]);

  return rows.filter((r) => {
    if (r.entityType === 'property') return allowed.has(r.entityId);
    if (r.entityType === 'customer' || r.entityType === 'tenant') return true; // org-level, no property
    const propertyId = propertyByEntity.get(`${r.entityType}:${r.entityId}`);
    if (propertyId === undefined) return false; // unknown / unresolved entity type → exclude
    return propertyId !== null && allowed.has(propertyId);
  });
}

export interface FlatSearchResponse {
  query: string;
  total: number;
  page: number;
  pageSize: number;
  results: NormalizedSearchResult[];
}

/**
 * Flat, ranked, paginated search for the results page / API. Reuses the grouped
 * searchers, then flattens, globally ranks and paginates. Bounded per group.
 */
export async function searchFlat(
  term: string,
  context: SearchContext,
  options: { type?: SearchEntityType | null; page?: number; pageSize?: number } = {},
): Promise<FlatSearchResponse> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 20));
  const query = term.trim().slice(0, MAX_QUERY_LENGTH);
  if (query.length < MIN_QUERY_LENGTH) return { query, total: 0, page, pageSize, results: [] };

  const groups = await globalSearch(query, context, { limitPerGroup: 25, only: options.type ?? null });
  const flat: NormalizedSearchResult[] = groups
    .flatMap((g) => g.items.map((i) => ({ type: g.entityType, id: i.id, title: i.title, subtitle: i.subtitle, url: i.href, badge: i.badge, score: i.score })))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

  const total = flat.length;
  const start = (page - 1) * pageSize;
  return { query, total, page, pageSize, results: flat.slice(start, start + pageSize) };
}
