import 'server-only';
import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, or, type SQL } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  contracts,
  documentCategories,
  documents,
  maintenanceAssets,
  properties,
  tenants,
} from '@/db/schema';
import { filterDocumentsByPropertyScope } from '@/services/document-service';
import type { PermissionKey } from '@/lib/permissions/catalog';

/**
 * Compliance center (Phase 13) — a read-only, security-first aggregation of
 * approaching/expired documents, asset warranties and contracts. Every query is
 * organization-scoped, RBAC-gated and property-data-scoped. Documents also
 * enforce requiredPermission, confidentiality, the current-version rule and
 * soft-delete, and never expose the storage key/path.
 */

export const COMPLIANCE_CATEGORIES = ['document', 'warranty', 'contract'] as const;
export type ComplianceCategory = (typeof COMPLIANCE_CATEGORIES)[number];
export function isComplianceCategory(value: unknown): value is ComplianceCategory {
  return typeof value === 'string' && (COMPLIANCE_CATEGORIES as readonly string[]).includes(value);
}

export const COMPLIANCE_STATUSES = ['all', 'expiring', 'expired'] as const;
export type ComplianceStatusFilter = (typeof COMPLIANCE_STATUSES)[number];

export const DEFAULT_WINDOW_DAYS = 90;
export const MAX_WINDOW_DAYS = 365;
const EXPIRED_LOOKBACK_DAYS = 90;

export interface ComplianceScope {
  organizationId: string;
  permissions: PermissionKey[];
  allowedPropertyIds: string[] | null;
}

export interface ComplianceItem {
  category: ComplianceCategory;
  id: string;
  title: string;
  subtitle: string | null;
  expiryDate: string;
  daysRemaining: number;
  status: 'expiring' | 'expired';
  propertyName: string | null;
  href: string;
  badge: string | null;
}

export interface ComplianceKpis {
  expiringSoon: number;
  expired: number;
  documents: number;
  warranties: number;
  contracts: number;
}

export interface ComplianceResult {
  items: ComplianceItem[];
  total: number;
  page: number;
  pageSize: number;
  kpis: ComplianceKpis;
}

export interface ComplianceOptions {
  type?: ComplianceCategory | null;
  filter?: ComplianceStatusFilter;
  windowDays?: number;
  page?: number;
  pageSize?: number;
}

const MS_PER_DAY = 86_400_000;
function todayUtcMidnight(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}
function isoInDays(days: number): string {
  return new Date(Date.now() + days * MS_PER_DAY).toISOString().slice(0, 10);
}
function daysRemaining(dateStr: string, today: number): number {
  return Math.round((Date.parse(`${dateStr}T00:00:00Z`) - today) / MS_PER_DAY);
}

/** Safe parent link for a document (never the storage key/path). */
function documentEntityHref(entityType: string, entityId: string): string {
  switch (entityType) {
    case 'property': return `/properties/${entityId}`;
    case 'unit': return `/units/${entityId}`;
    case 'contract': return `/contracts/${entityId}`;
    case 'asset': return `/assets/${entityId}`;
    case 'customer': return `/leasing/customers/${entityId}`;
    case 'tenant': return `/tenants/${entityId}`;
    default: return '/compliance?type=document';
  }
}

export async function getComplianceItems(scope: ComplianceScope, options: ComplianceOptions = {}): Promise<ComplianceResult> {
  const db = await getDb();
  const today = todayUtcMidnight();
  const windowDays = Math.min(MAX_WINDOW_DAYS, Math.max(1, options.windowDays ?? DEFAULT_WINDOW_DAYS));
  const from = isoInDays(-EXPIRED_LOOKBACK_DAYS);
  const to = isoInDays(windowDays);
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));
  const propertyScope = scope.allowedPropertyIds?.length ? scope.allowedPropertyIds : null;
  const can = (p: PermissionKey) => scope.permissions.includes(p);

  const all: ComplianceItem[] = [];
  const tasks: Array<Promise<void>> = [];

  // --- Documents ----------------------------------------------------------
  if (can('documents:view')) {
    tasks.push(
      (async () => {
        const permissionFilter: SQL | undefined = or(
          isNull(documents.requiredPermission),
          scope.permissions.length ? inArray(documents.requiredPermission, scope.permissions) : undefined,
        );
        const rows = await db
          .select({ id: documents.id, title: documents.title, entityType: documents.entityType, entityId: documents.entityId, expiryDate: documents.expiryDate, categoryName: documentCategories.nameEn })
          .from(documents)
          .leftJoin(documentCategories, eq(documentCategories.id, documents.categoryId))
          .where(and(eq(documents.organizationId, scope.organizationId), isNull(documents.deletedAt), eq(documents.isCurrentVersion, true), isNotNull(documents.expiryDate), gte(documents.expiryDate, from), lte(documents.expiryDate, to), permissionFilter))
          .limit(500);
        const scoped = await filterDocumentsByPropertyScope(scope.organizationId, propertyScope, rows);
        for (const r of scoped) {
          const dr = daysRemaining(r.expiryDate!, today);
          all.push({ category: 'document', id: r.id, title: r.title, subtitle: r.categoryName, expiryDate: r.expiryDate!, daysRemaining: dr, status: dr < 0 ? 'expired' : 'expiring', propertyName: null, href: documentEntityHref(r.entityType, r.entityId), badge: 'Document' });
        }
      })(),
    );
  }

  // --- Asset warranties ---------------------------------------------------
  if (can('assets:view')) {
    tasks.push(
      db
        .select({ id: maintenanceAssets.id, code: maintenanceAssets.code, name: maintenanceAssets.nameEn, warrantyExpiryDate: maintenanceAssets.warrantyExpiryDate, propertyName: properties.nameEn })
        .from(maintenanceAssets)
        .innerJoin(properties, eq(properties.id, maintenanceAssets.propertyId))
        .where(and(eq(maintenanceAssets.organizationId, scope.organizationId), isNull(maintenanceAssets.deletedAt), ne(maintenanceAssets.status, 'decommissioned'), isNotNull(maintenanceAssets.warrantyExpiryDate), gte(maintenanceAssets.warrantyExpiryDate, from), lte(maintenanceAssets.warrantyExpiryDate, to), propertyScope ? inArray(maintenanceAssets.propertyId, propertyScope) : undefined))
        .limit(500)
        .then((rows) => {
          for (const r of rows) {
            const dr = daysRemaining(r.warrantyExpiryDate!, today);
            all.push({ category: 'warranty', id: r.id, title: r.name, subtitle: r.code, expiryDate: r.warrantyExpiryDate!, daysRemaining: dr, status: dr < 0 ? 'expired' : 'expiring', propertyName: r.propertyName, href: `/assets/${r.id}`, badge: 'Warranty' });
          }
        }),
    );
  }

  // --- Contracts (reuses the existing contract expiry data) ---------------
  if (can('contracts:view')) {
    tasks.push(
      db
        .select({ id: contracts.id, contractNumber: contracts.contractNumber, endDate: contracts.endDate, tenantName: tenants.displayName, propertyName: properties.nameEn, status: contracts.status })
        .from(contracts)
        .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
        .innerJoin(properties, eq(properties.id, contracts.propertyId))
        .where(and(eq(contracts.organizationId, scope.organizationId), isNull(contracts.deletedAt), inArray(contracts.status, ['signed', 'active']), gte(contracts.endDate, from), lte(contracts.endDate, to), propertyScope ? inArray(contracts.propertyId, propertyScope) : undefined))
        .limit(500)
        .then((rows) => {
          for (const r of rows) {
            const dr = daysRemaining(r.endDate, today);
            all.push({ category: 'contract', id: r.id, title: r.contractNumber, subtitle: r.tenantName, expiryDate: r.endDate, daysRemaining: dr, status: dr < 0 ? 'expired' : 'expiring', propertyName: r.propertyName, href: `/contracts/${r.id}`, badge: 'Contract' });
          }
        }),
    );
  }

  await Promise.all(tasks);

  // KPIs reflect the whole accessible compliance picture (independent of the
  // active type/status filter), so the cards stay stable while the list filters.
  const kpis: ComplianceKpis = {
    expiringSoon: all.filter((i) => i.status === 'expiring').length,
    expired: all.filter((i) => i.status === 'expired').length,
    documents: all.filter((i) => i.category === 'document').length,
    warranties: all.filter((i) => i.category === 'warranty').length,
    contracts: all.filter((i) => i.category === 'contract').length,
  };

  let filtered = all;
  if (options.type) filtered = filtered.filter((i) => i.category === options.type);
  if (options.filter && options.filter !== 'all') filtered = filtered.filter((i) => i.status === options.filter);
  // Most urgent first (expired < 0 sorts ahead of soon-to-expire).
  filtered.sort((a, b) => a.daysRemaining - b.daysRemaining || a.expiryDate.localeCompare(b.expiryDate));

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  return { items: filtered.slice(start, start + pageSize), total, page, pageSize, kpis };
}
