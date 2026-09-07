import 'server-only';
import { and, count, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  customerIdentifiers,
  customers,
  leadActivities,
  leads,
  leadStages,
  properties,
  proposals,
  reservations,
  tenants,
  units,
  viewings,
} from '@/db/schema';
import type { DbExecutor } from '@/db/types';
import { recordAudit } from '@/lib/audit';
import { notFound } from '@/lib/errors';
import { normalizeEmail, normalizeIdentifier, normalizeMobile } from '@/lib/utils';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Customer service (BRD 21-22).
 *
 * BR-007: duplicate detection runs before creating a customer. A match links
 * the new request to the existing customer instead of creating a duplicate.
 */

export interface DuplicateMatch {
  customerId: string;
  code: string;
  name: string;
  matchedOn: string;
  matchedValue: string;
}

const IDENTIFIER_TYPES = ['mobile', 'email', 'national_id', 'iqama', 'commercial_registration'] as const;

function normalizeIdentifierValue(type: string, value: string): string {
  if (type === 'mobile') return normalizeMobile(value);
  if (type === 'email') return normalizeEmail(value);
  return normalizeIdentifier(value);
}

/** Finds existing customers matching any provided identifier (BR-007). */
export async function detectDuplicates(
  organizationId: string,
  identifiers: Partial<Record<(typeof IDENTIFIER_TYPES)[number], string>>,
): Promise<DuplicateMatch[]> {
  const db = await getDb();

  const lookups = IDENTIFIER_TYPES.flatMap((type) => {
    const raw = identifiers[type];
    if (!raw) return [];
    return [{ type, value: normalizeIdentifierValue(type, raw) }];
  });

  if (lookups.length === 0) return [];

  const rows = await db
    .select({
      customerId: customerIdentifiers.customerId,
      type: customerIdentifiers.identifierType,
      value: customerIdentifiers.identifierValue,
      code: customers.code,
      name: customers.fullNameEn,
    })
    .from(customerIdentifiers)
    .innerJoin(customers, eq(customers.id, customerIdentifiers.customerId))
    .where(
      and(
        eq(customerIdentifiers.organizationId, organizationId),
        isNull(customers.deletedAt),
        or(
          ...lookups.map((lookup) =>
            and(
              eq(customerIdentifiers.identifierType, lookup.type),
              eq(customerIdentifiers.identifierValue, lookup.value),
            ),
          ),
        ),
      ),
    );

  const seen = new Set<string>();
  const matches: DuplicateMatch[] = [];
  for (const row of rows) {
    if (seen.has(row.customerId)) continue;
    seen.add(row.customerId);
    matches.push({
      customerId: row.customerId,
      code: row.code,
      name: row.name,
      matchedOn: row.type,
      matchedValue: row.value,
    });
  }
  return matches;
}

export interface CreateCustomerInput {
  customerType: 'individual' | 'corporate';
  fullNameEn: string;
  fullNameAr?: string | null;
  companyName?: string | null;
  mobile?: string | null;
  alternateMobile?: string | null;
  email?: string | null;
  nationalId?: string | null;
  nationalIdExpiry?: string | null;
  iqama?: string | null;
  iqamaExpiry?: string | null;
  commercialRegistration?: string | null;
  commercialRegistrationExpiry?: string | null;
  nationality?: string | null;
  employer?: string | null;
  monthlyIncome?: number | null;
  businessActivity?: string | null;
  unifiedNumber?: string | null;
  vatNumber?: string | null;
  authorizedRepresentative?: string | null;
  addressLine?: string | null;
  notes?: string | null;
  priority?: string | null;
  tags?: string[];
  marketingConsent?: boolean;
  communicationConsent?: boolean;
}

export interface CreateCustomerResult {
  customerId: string;
  created: boolean;
  duplicate?: DuplicateMatch;
}

/**
 * Creates a customer after duplicate detection. When a duplicate exists the
 * existing customer id is returned with `created: false` (BR-007) — callers
 * link the new request to it rather than inserting a second record.
 */
export async function createCustomerWithDeduplication(
  actor: SessionUser,
  input: CreateCustomerInput,
  options: { linkOnDuplicate?: boolean } = { linkOnDuplicate: true },
): Promise<CreateCustomerResult> {
  const identifiers: Partial<Record<(typeof IDENTIFIER_TYPES)[number], string>> = {};
  if (input.mobile) identifiers.mobile = input.mobile;
  if (input.email) identifiers.email = input.email;
  if (input.nationalId) identifiers.national_id = input.nationalId;
  if (input.iqama) identifiers.iqama = input.iqama;
  if (input.commercialRegistration) identifiers.commercial_registration = input.commercialRegistration;

  const duplicates = await detectDuplicates(actor.organizationId, identifiers);
  if (duplicates.length > 0 && options.linkOnDuplicate) {
    return { customerId: duplicates[0].customerId, created: false, duplicate: duplicates[0] };
  }

  const db = await getDb();
  return db.transaction(async (tx) => {
    const code = await nextCustomerCode(tx, actor.organizationId);

    const [created] = await tx
      .insert(customers)
      .values({
        organizationId: actor.organizationId,
        code,
        customerType: input.customerType,
        fullNameEn: input.fullNameEn,
        fullNameAr: input.fullNameAr ?? null,
        companyName: input.companyName ?? null,
        mobile: input.mobile ?? null,
        alternateMobile: input.alternateMobile ?? null,
        email: input.email ?? null,
        nationality: input.nationality ?? null,
        employer: input.employer ?? null,
        monthlyIncome: input.monthlyIncome ?? null,
        businessActivity: input.businessActivity ?? null,
        unifiedNumber: input.unifiedNumber ?? null,
        vatNumber: input.vatNumber ?? null,
        authorizedRepresentative: input.authorizedRepresentative ?? null,
        addressLine: input.addressLine ?? null,
        notes: input.notes ?? null,
        priority: input.priority ?? 'medium',
        tags: input.tags ?? [],
        marketingConsent: input.marketingConsent ?? false,
        communicationConsent: input.communicationConsent ?? true,
        ownerUserId: actor.id,
      })
      .returning({ id: customers.id });

    const expiryByType: Record<string, string | null | undefined> = {
      national_id: input.nationalIdExpiry,
      iqama: input.iqamaExpiry,
      commercial_registration: input.commercialRegistrationExpiry,
    };
    const identifierRows = Object.entries(identifiers).map(([type, value], index) => ({
      organizationId: actor.organizationId,
      customerId: created.id,
      identifierType: type,
      identifierValue: normalizeIdentifierValue(type, value),
      expiryDate: expiryByType[type] ?? null,
      isPrimary: index === 0,
    }));
    if (identifierRows.length > 0) {
      await tx.insert(customerIdentifiers).values(identifierRows);
    }

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'create',
      entityType: 'customer',
      entityId: created.id,
      entityLabel: input.fullNameEn,
      newValue: { code, customerType: input.customerType },
      actor: { id: actor.id, fullName: actor.fullName },
    });

    return { customerId: created.id, created: true };
  });
}

async function nextCustomerCode(executor: DbExecutor, organizationId: string): Promise<string> {
  const [{ total }] = await executor
    .select({ total: count() })
    .from(customers)
    .where(eq(customers.organizationId, organizationId));
  return `CUS-${String(Number(total) + 1).padStart(4, '0')}`;
}

/* -------------------------------------------------------------------------- */
/* Customer 360                                                                */
/* -------------------------------------------------------------------------- */

export async function getCustomer360(organizationId: string, customerId: string) {
  const db = await getDb();

  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, organizationId), isNull(customers.deletedAt)))
    .limit(1);
  if (!customer) throw notFound('Customer', customerId);

  const [
    identifiers,
    customerLeads,
    customerViewings,
    customerProposals,
    customerReservations,
    activities,
    tenantRecord,
  ] = await Promise.all([
    db.select().from(customerIdentifiers).where(eq(customerIdentifiers.customerId, customerId)),
    db
      .select({
        id: leads.id,
        code: leads.code,
        stageLabel: leadStages.nameEn,
        stageColor: leadStages.colorToken,
        propertyName: properties.nameEn,
        createdAt: leads.createdAt,
        nextAction: leads.nextAction,
      })
      .from(leads)
      .innerJoin(leadStages, eq(leadStages.id, leads.stageId))
      .leftJoin(properties, eq(properties.id, leads.requestedPropertyId))
      .where(and(eq(leads.customerId, customerId), isNull(leads.deletedAt)))
      .orderBy(desc(leads.createdAt)),
    db
      .select({
        id: viewings.id,
        code: viewings.code,
        propertyName: properties.nameEn,
        unitNumber: units.unitNumber,
        scheduledDate: viewings.scheduledDate,
        status: viewings.status,
      })
      .from(viewings)
      .innerJoin(properties, eq(properties.id, viewings.propertyId))
      .leftJoin(units, eq(units.id, viewings.unitId))
      .where(eq(viewings.customerId, customerId))
      .orderBy(desc(viewings.scheduledDate)),
    db
      .select({
        id: proposals.id,
        reference: proposals.reference,
        version: proposals.version,
        annualRent: proposals.annualRent,
        status: proposals.status,
        createdAt: proposals.createdAt,
      })
      .from(proposals)
      .where(eq(proposals.customerId, customerId))
      .orderBy(desc(proposals.createdAt)),
    db
      .select({
        id: reservations.id,
        code: reservations.code,
        unitNumber: units.unitNumber,
        expiryDate: reservations.expiryDate,
        status: reservations.status,
      })
      .from(reservations)
      .innerJoin(units, eq(units.id, reservations.unitId))
      .where(eq(reservations.customerId, customerId))
      .orderBy(desc(reservations.reservationDate)),
    db
      .select()
      .from(leadActivities)
      .where(eq(leadActivities.customerId, customerId))
      .orderBy(desc(leadActivities.occurredAt))
      .limit(30),
    db.select({ id: tenants.id }).from(tenants).where(eq(tenants.customerId, customerId)).limit(1),
  ]);

  return {
    customer,
    identifiers,
    leads: customerLeads,
    viewings: customerViewings,
    proposals: customerProposals,
    reservations: customerReservations,
    activities,
    tenantId: tenantRecord[0]?.id ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Customer list + edit                                                        */
/* -------------------------------------------------------------------------- */

export interface CustomerListFilters {
  organizationId: string;
  search?: string;
  customerType?: string;
  priority?: string;
  page: number;
  pageSize: number;
}

export interface CustomerListItem {
  id: string;
  code: string;
  customerType: string;
  fullNameEn: string;
  companyName: string | null;
  mobile: string | null;
  email: string | null;
  priority: string;
  identification: string | null;
  activeContracts: number;
  hasTenant: boolean;
  createdAt: Date;
}

export async function listCustomers(
  filters: CustomerListFilters,
): Promise<{ items: CustomerListItem[]; total: number }> {
  const db = await getDb();
  const where = and(
    eq(customers.organizationId, filters.organizationId),
    isNull(customers.deletedAt),
    filters.customerType ? eq(customers.customerType, filters.customerType as 'individual' | 'corporate') : undefined,
    filters.priority ? eq(customers.priority, filters.priority) : undefined,
    filters.search
      ? or(
          ilike(customers.fullNameEn, `%${filters.search}%`),
          ilike(customers.companyName, `%${filters.search}%`),
          ilike(customers.mobile, `%${filters.search}%`),
          ilike(customers.email, `%${filters.search}%`),
          ilike(customers.code, `%${filters.search}%`),
        )
      : undefined,
  );

  const activeContracts = sql<number>`(
    select count(*)::int from contracts c
    join tenants t on t.id = c.tenant_id
    where t.customer_id = customers.id and c.is_active = true
  )`;
  const hasTenant = sql<boolean>`exists (
    select 1 from tenants t where t.customer_id = customers.id and t.deleted_at is null
  )`;
  const identification = sql<string | null>`(
    select ci.identifier_type || ':' || ci.identifier_value from customer_identifiers ci
    where ci.customer_id = customers.id
      and ci.identifier_type in ('national_id','iqama','commercial_registration')
    order by ci.is_primary desc limit 1
  )`;

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: customers.id,
        code: customers.code,
        customerType: customers.customerType,
        fullNameEn: customers.fullNameEn,
        companyName: customers.companyName,
        mobile: customers.mobile,
        email: customers.email,
        priority: customers.priority,
        identification,
        activeContracts,
        hasTenant,
        createdAt: customers.createdAt,
      })
      .from(customers)
      .where(where)
      .orderBy(desc(customers.createdAt))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize),
    db.select({ total: count() }).from(customers).where(where),
  ]);

  return {
    items: rows.map((r) => ({
      ...r,
      activeContracts: Number(r.activeContracts),
      hasTenant: Boolean(r.hasTenant),
    })),
    total: Number(totalRow[0]?.total ?? 0),
  };
}

/** Customer scalar fields + identifiers, for the edit form. */
export async function getCustomerForEdit(organizationId: string, customerId: string) {
  const db = await getDb();
  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, organizationId), isNull(customers.deletedAt)))
    .limit(1);
  if (!customer) return null;
  const identifiers = await db
    .select()
    .from(customerIdentifiers)
    .where(eq(customerIdentifiers.customerId, customerId));
  return { customer, identifiers };
}

async function syncIdentifier(
  tx: DbExecutor,
  organizationId: string,
  customerId: string,
  type: string,
  rawValue: string | null | undefined,
  expiry: string | null | undefined,
) {
  const [existing] = await tx
    .select({ id: customerIdentifiers.id })
    .from(customerIdentifiers)
    .where(and(eq(customerIdentifiers.customerId, customerId), eq(customerIdentifiers.identifierType, type)))
    .limit(1);

  if (!rawValue) {
    if (existing) await tx.delete(customerIdentifiers).where(eq(customerIdentifiers.id, existing.id));
    return;
  }
  const value = normalizeIdentifierValue(type, rawValue);
  if (existing) {
    await tx
      .update(customerIdentifiers)
      .set({ identifierValue: value, expiryDate: expiry ?? null })
      .where(eq(customerIdentifiers.id, existing.id));
  } else {
    await tx.insert(customerIdentifiers).values({
      organizationId,
      customerId,
      identifierType: type,
      identifierValue: value,
      expiryDate: expiry ?? null,
    });
  }
}

export async function updateCustomer(
  actor: SessionUser,
  customerId: string,
  input: CreateCustomerInput,
): Promise<{ id: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.organizationId, actor.organizationId), isNull(customers.deletedAt)))
      .limit(1);
    if (!existing) throw notFound('Customer', customerId);

    await tx
      .update(customers)
      .set({
        customerType: input.customerType,
        fullNameEn: input.fullNameEn,
        fullNameAr: input.fullNameAr ?? null,
        companyName: input.companyName ?? null,
        mobile: input.mobile ?? null,
        alternateMobile: input.alternateMobile ?? null,
        email: input.email ?? null,
        nationality: input.nationality ?? null,
        employer: input.employer ?? null,
        monthlyIncome: input.monthlyIncome ?? null,
        businessActivity: input.businessActivity ?? null,
        unifiedNumber: input.unifiedNumber ?? null,
        vatNumber: input.vatNumber ?? null,
        authorizedRepresentative: input.authorizedRepresentative ?? null,
        addressLine: input.addressLine ?? null,
        notes: input.notes ?? null,
        priority: input.priority ?? existing.priority,
        tags: input.tags ?? existing.tags,
        marketingConsent: input.marketingConsent ?? existing.marketingConsent,
        communicationConsent: input.communicationConsent ?? existing.communicationConsent,
        updatedAt: new Date(),
      })
      .where(eq(customers.id, customerId));

    // Keep identifier rows in sync (BR-007 unique — collisions surface as a
    // friendly conflict via translateDatabaseError in the action).
    await syncIdentifier(tx, actor.organizationId, customerId, 'mobile', input.mobile, null);
    await syncIdentifier(tx, actor.organizationId, customerId, 'email', input.email, null);
    await syncIdentifier(tx, actor.organizationId, customerId, 'national_id', input.nationalId, input.nationalIdExpiry);
    await syncIdentifier(tx, actor.organizationId, customerId, 'iqama', input.iqama, input.iqamaExpiry);
    await syncIdentifier(tx, actor.organizationId, customerId, 'commercial_registration', input.commercialRegistration, input.commercialRegistrationExpiry);

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'customer',
      entityId: customerId,
      entityLabel: input.fullNameEn,
      previousValue: { fullNameEn: existing.fullNameEn, customerType: existing.customerType },
      newValue: { customerType: input.customerType },
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: customerId };
  });
}
