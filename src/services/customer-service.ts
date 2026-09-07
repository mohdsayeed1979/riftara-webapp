import 'server-only';
import { and, count, desc, eq, isNull, or } from 'drizzle-orm';
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
  email?: string | null;
  nationalId?: string | null;
  iqama?: string | null;
  commercialRegistration?: string | null;
  nationality?: string | null;
  businessActivity?: string | null;
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
        email: input.email ?? null,
        nationality: input.nationality ?? null,
        businessActivity: input.businessActivity ?? null,
        ownerUserId: actor.id,
      })
      .returning({ id: customers.id });

    const identifierRows = Object.entries(identifiers).map(([type, value], index) => ({
      organizationId: actor.organizationId,
      customerId: created.id,
      identifierType: type,
      identifierValue: normalizeIdentifierValue(type, value),
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
