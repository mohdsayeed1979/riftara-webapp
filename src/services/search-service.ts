import 'server-only';
import { and, eq, ilike, inArray, isNull, or } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  contracts,
  customerIdentifiers,
  customers,
  documents,
  invoices,
  leads,
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
 * Global search (BRD 131). Results are grouped by entity type and each result
 * links to its record. Groups the caller has no permission to view are
 * omitted entirely.
 */

export interface SearchResultItem {
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  badge: string | null;
}

export interface SearchResultGroup {
  entityType: string;
  label: string;
  items: SearchResultItem[];
}

interface SearchContext {
  organizationId: string;
  permissions: PermissionKey[];
  allowedPropertyIds: string[] | null;
  limitPerGroup: number;
}

export async function globalSearch(
  term: string,
  context: Omit<SearchContext, 'limitPerGroup'> & { limitPerGroup?: number },
): Promise<SearchResultGroup[]> {
  const query = term.trim();
  if (query.length < 2) return [];

  const ctx: SearchContext = { ...context, limitPerGroup: context.limitPerGroup ?? 5 };
  const like = `%${query}%`;
  const digits = query.replace(/\D/g, '');
  const db = await getDb();
  const groups: SearchResultGroup[] = [];

  const can = (permission: PermissionKey) => ctx.permissions.includes(permission);
  const propertyScope = ctx.allowedPropertyIds?.length ? ctx.allowedPropertyIds : null;

  // --- Properties ---------------------------------------------------------
  if (can('properties:view')) {
    const rows = await db
      .select({
        id: properties.id,
        name: properties.nameEn,
        nameAr: properties.nameAr,
        code: properties.code,
        status: properties.status,
      })
      .from(properties)
      .where(
        and(
          eq(properties.organizationId, ctx.organizationId),
          isNull(properties.deletedAt),
          propertyScope ? inArray(properties.id, propertyScope) : undefined,
          or(
            ilike(properties.nameEn, like),
            ilike(properties.nameAr, like),
            ilike(properties.code, like),
            ilike(properties.addressLine, like),
          ),
        ),
      )
      .limit(ctx.limitPerGroup);

    pushGroup(groups, 'property', 'Properties', rows, (row) => ({
      id: row.id,
      title: row.name,
      subtitle: row.code,
      href: `/properties/${row.id}`,
      badge: row.status,
    }));
  }

  // --- Units --------------------------------------------------------------
  if (can('units:view')) {
    const rows = await db
      .select({
        id: units.id,
        code: units.code,
        unitNumber: units.unitNumber,
        propertyName: properties.nameEn,
        availability: units.computedAvailabilityClass,
      })
      .from(units)
      .innerJoin(properties, eq(properties.id, units.propertyId))
      .where(
        and(
          eq(units.organizationId, ctx.organizationId),
          isNull(units.deletedAt),
          propertyScope ? inArray(units.propertyId, propertyScope) : undefined,
          or(ilike(units.code, like), ilike(units.unitNumber, like)),
        ),
      )
      .limit(ctx.limitPerGroup);

    pushGroup(groups, 'unit', 'Units', rows, (row) => ({
      id: row.id,
      title: `Unit ${row.unitNumber}`,
      subtitle: row.propertyName,
      href: `/units/${row.id}`,
      badge: row.availability,
    }));
  }

  // --- Customers (name, mobile, email, identification, CR) ----------------
  if (can('customers:view')) {
    const identifierMatches = await db
      .select({ customerId: customerIdentifiers.customerId })
      .from(customerIdentifiers)
      .where(
        and(
          eq(customerIdentifiers.organizationId, ctx.organizationId),
          or(
            ilike(customerIdentifiers.identifierValue, like),
            digits.length >= 6
              ? eq(customerIdentifiers.identifierValue, normalizeMobile(digits))
              : undefined,
          ),
        ),
      )
      .limit(20);

    const identifierIds = identifierMatches.map((row) => row.customerId);

    const rows = await db
      .select({
        id: customers.id,
        name: customers.fullNameEn,
        code: customers.code,
        mobile: customers.mobile,
        type: customers.customerType,
      })
      .from(customers)
      .where(
        and(
          eq(customers.organizationId, ctx.organizationId),
          isNull(customers.deletedAt),
          or(
            ilike(customers.fullNameEn, like),
            ilike(customers.companyName, like),
            ilike(customers.mobile, like),
            ilike(customers.email, like),
            ilike(customers.code, like),
            identifierIds.length > 0 ? inArray(customers.id, identifierIds) : undefined,
          ),
        ),
      )
      .limit(ctx.limitPerGroup);

    pushGroup(groups, 'customer', 'Customers', rows, (row) => ({
      id: row.id,
      title: row.name,
      subtitle: row.mobile ?? row.code,
      href: `/leasing/customers/${row.id}`,
      badge: row.type,
    }));
  }

  // --- Tenants ------------------------------------------------------------
  if (can('tenants:view')) {
    const rows = await db
      .select({ id: tenants.id, name: tenants.displayName, code: tenants.code, status: tenants.status })
      .from(tenants)
      .where(
        and(
          eq(tenants.organizationId, ctx.organizationId),
          isNull(tenants.deletedAt),
          or(ilike(tenants.displayName, like), ilike(tenants.code, like)),
        ),
      )
      .limit(ctx.limitPerGroup);

    pushGroup(groups, 'tenant', 'Tenants', rows, (row) => ({
      id: row.id,
      title: row.name,
      subtitle: row.code,
      href: `/tenants/${row.id}`,
      badge: row.status,
    }));
  }

  // --- Leads --------------------------------------------------------------
  if (can('leasing:view')) {
    const rows = await db
      .select({
        id: leads.id,
        code: leads.code,
        customerName: customers.fullNameEn,
        qualification: leads.qualification,
      })
      .from(leads)
      .innerJoin(customers, eq(customers.id, leads.customerId))
      .where(
        and(
          eq(leads.organizationId, ctx.organizationId),
          isNull(leads.deletedAt),
          or(ilike(leads.code, like), ilike(customers.fullNameEn, like)),
        ),
      )
      .limit(ctx.limitPerGroup);

    pushGroup(groups, 'lead', 'Leads', rows, (row) => ({
      id: row.id,
      title: row.customerName,
      subtitle: row.code,
      href: `/leasing/leads/${row.id}`,
      badge: row.qualification,
    }));
  }

  // --- Contracts ----------------------------------------------------------
  if (can('contracts:view')) {
    const rows = await db
      .select({
        id: contracts.id,
        contractNumber: contracts.contractNumber,
        ejarReference: contracts.ejarReference,
        tenantName: tenants.displayName,
        status: contracts.status,
      })
      .from(contracts)
      .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
      .where(
        and(
          eq(contracts.organizationId, ctx.organizationId),
          isNull(contracts.deletedAt),
          propertyScope ? inArray(contracts.propertyId, propertyScope) : undefined,
          or(
            ilike(contracts.contractNumber, like),
            ilike(contracts.ejarReference, like),
            ilike(tenants.displayName, like),
          ),
        ),
      )
      .limit(ctx.limitPerGroup);

    pushGroup(groups, 'contract', 'Contracts', rows, (row) => ({
      id: row.id,
      title: row.contractNumber,
      subtitle: row.tenantName,
      href: `/contracts/${row.id}`,
      badge: row.status,
    }));
  }

  // --- Invoices and payments ---------------------------------------------
  if (can('collections:view')) {
    const invoiceRows = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        tenantName: tenants.displayName,
        status: invoices.status,
      })
      .from(invoices)
      .innerJoin(tenants, eq(tenants.id, invoices.tenantId))
      .where(
        and(
          eq(invoices.organizationId, ctx.organizationId),
          propertyScope ? inArray(invoices.propertyId, propertyScope) : undefined,
          ilike(invoices.invoiceNumber, like),
        ),
      )
      .limit(ctx.limitPerGroup);

    pushGroup(groups, 'invoice', 'Invoices', invoiceRows, (row) => ({
      id: row.id,
      title: row.invoiceNumber,
      subtitle: row.tenantName,
      href: `/collections/invoices/${row.id}`,
      badge: row.status,
    }));

    const paymentRows = await db
      .select({
        id: payments.id,
        paymentNumber: payments.paymentNumber,
        referenceNumber: payments.referenceNumber,
        tenantName: tenants.displayName,
        status: payments.status,
      })
      .from(payments)
      .innerJoin(tenants, eq(tenants.id, payments.tenantId))
      .where(
        and(
          eq(payments.organizationId, ctx.organizationId),
          or(ilike(payments.paymentNumber, like), ilike(payments.referenceNumber, like)),
        ),
      )
      .limit(ctx.limitPerGroup);

    pushGroup(groups, 'payment', 'Payments', paymentRows, (row) => ({
      id: row.id,
      title: row.paymentNumber,
      subtitle: row.tenantName,
      href: `/collections/payments/${row.id}`,
      badge: row.status,
    }));
  }

  // --- Work orders --------------------------------------------------------
  if (can('maintenance:view')) {
    const rows = await db
      .select({
        id: workOrders.id,
        code: workOrders.code,
        title: workOrders.title,
        status: workOrders.status,
      })
      .from(workOrders)
      .where(
        and(
          eq(workOrders.organizationId, ctx.organizationId),
          isNull(workOrders.deletedAt),
          propertyScope ? inArray(workOrders.propertyId, propertyScope) : undefined,
          or(ilike(workOrders.code, like), ilike(workOrders.title, like)),
        ),
      )
      .limit(ctx.limitPerGroup);

    pushGroup(groups, 'work_order', 'Work Orders', rows, (row) => ({
      id: row.id,
      title: row.code,
      subtitle: row.title,
      href: `/maintenance/${row.id}`,
      badge: row.status,
    }));
  }

  // --- Ownership documents and commercial registration --------------------
  if (can('properties:view')) {
    const rows = await db
      .select({
        id: propertyOwnerships.id,
        propertyId: propertyOwnerships.propertyId,
        documentNumber: propertyOwnerships.documentNumber,
        ownerName: propertyOwnerships.ownerName,
        documentType: propertyOwnerships.documentType,
      })
      .from(propertyOwnerships)
      .innerJoin(properties, eq(properties.id, propertyOwnerships.propertyId))
      .where(
        and(
          eq(properties.organizationId, ctx.organizationId),
          or(
            ilike(propertyOwnerships.documentNumber, like),
            ilike(propertyOwnerships.commercialRegistration, like),
            ilike(propertyOwnerships.identificationNumber, like),
            ilike(propertyOwnerships.ownerName, like),
          ),
        ),
      )
      .limit(ctx.limitPerGroup);

    pushGroup(groups, 'ownership', 'Ownership Documents', rows, (row) => ({
      id: row.id,
      title: row.documentNumber,
      subtitle: `${row.documentType} · ${row.ownerName}`,
      href: `/properties/${row.propertyId}?tab=ownership`,
      badge: null,
    }));
  }

  // --- Documents ----------------------------------------------------------
  if (can('documents:view')) {
    const rows = await db
      .select({
        id: documents.id,
        title: documents.title,
        entityType: documents.entityType,
        entityId: documents.entityId,
        fileName: documents.fileName,
      })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, ctx.organizationId),
          isNull(documents.deletedAt),
          eq(documents.isCurrentVersion, true),
          or(ilike(documents.title, like), ilike(documents.fileName, like)),
        ),
      )
      .limit(ctx.limitPerGroup);

    pushGroup(groups, 'document', 'Documents', rows, (row) => ({
      id: row.id,
      title: row.title,
      subtitle: row.fileName,
      href: `/api/v1/documents/${row.id}/download`,
      badge: row.entityType,
    }));
  }

  return groups;
}

function pushGroup<T>(
  groups: SearchResultGroup[],
  entityType: string,
  label: string,
  rows: T[],
  map: (row: T) => SearchResultItem,
): void {
  if (rows.length === 0) return;
  groups.push({ entityType, label, items: rows.map(map) });
}
