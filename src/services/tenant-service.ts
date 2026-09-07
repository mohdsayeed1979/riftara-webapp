import 'server-only';
import { and, asc, count, eq, ilike, isNull, or } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { customers, tenants, users } from '@/db/schema';
import { recordAudit } from '@/lib/audit';
import { conflict, notFound } from '@/lib/errors';
import type { DbExecutor } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Tenant service (BRD 24). In the existing schema a Tenant is a customer's
 * organization-level leasing account (customerId, status, account manager) —
 * it is NOT tied to a property/unit. Unit occupancy is established later via a
 * Contract (contracts.tenantId + unitId). Every mutation is org-scoped and
 * audited.
 */

/** Customer options for the tenant form's customer picker. */
export async function searchCustomers(organizationId: string, query: string, limit = 20) {
  const db = await getDb();
  const rows = await db
    .select({
      id: customers.id,
      name: customers.fullNameEn,
      code: customers.code,
      mobile: customers.mobile,
      customerType: customers.customerType,
    })
    .from(customers)
    .where(
      and(
        eq(customers.organizationId, organizationId),
        isNull(customers.deletedAt),
        query
          ? or(
              ilike(customers.fullNameEn, `%${query}%`),
              ilike(customers.companyName, `%${query}%`),
              ilike(customers.mobile, `%${query}%`),
              ilike(customers.code, `%${query}%`),
            )
          : undefined,
      ),
    )
    .orderBy(asc(customers.fullNameEn))
    .limit(limit);
  return rows;
}

export async function getTenantFormReferenceData(organizationId: string) {
  const db = await getDb();
  const [customerRows, managerRows] = await Promise.all([
    db
      .select({ id: customers.id, name: customers.fullNameEn, code: customers.code })
      .from(customers)
      .where(and(eq(customers.organizationId, organizationId), isNull(customers.deletedAt)))
      .orderBy(asc(customers.fullNameEn))
      .limit(500),
    db
      .select({ id: users.id, name: users.fullName })
      .from(users)
      .where(and(eq(users.organizationId, organizationId), eq(users.isActive, true), isNull(users.deletedAt)))
      .orderBy(asc(users.fullName)),
  ]);
  return { customers: customerRows, managers: managerRows };
}

export async function nextTenantCode(executor: DbExecutor, organizationId: string): Promise<string> {
  const [{ total }] = await executor
    .select({ total: count() })
    .from(tenants)
    .where(eq(tenants.organizationId, organizationId));
  return `TEN-${String(Number(total) + 1).padStart(4, '0')}`;
}

export interface TenantWriteInput {
  customerId: string;
  displayName: string;
  displayNameAr?: string | null;
  industry?: string | null;
  status: string;
  onboardedAt?: string | null;
  accountManagerId?: string | null;
  creditRating?: string | null;
  notes?: string | null;
}

async function assertCustomerInOrg(
  tx: Parameters<Parameters<Awaited<ReturnType<typeof getDb>>['transaction']>[0]>[0],
  organizationId: string,
  customerId: string,
) {
  const [customer] = await tx
    .select({ id: customers.id, name: customers.fullNameEn })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, organizationId), isNull(customers.deletedAt)))
    .limit(1);
  if (!customer) throw notFound('Customer', customerId);
  return customer;
}

export async function createTenant(actor: SessionUser, input: TenantWriteInput): Promise<{ id: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    await assertCustomerInOrg(tx, actor.organizationId, input.customerId);

    // The app models one tenant account per customer (Customer 360 links a
    // single tenant). Block a second active account for the same customer.
    const [existingTenant] = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.customerId, input.customerId), isNull(tenants.deletedAt)))
      .limit(1);
    if (existingTenant) {
      throw conflict('This customer already has a tenant account. Open the existing tenant instead of creating a duplicate.');
    }

    const code = await nextTenantCode(tx, actor.organizationId);
    const [created] = await tx
      .insert(tenants)
      .values({
        organizationId: actor.organizationId, // session org only — never client-supplied
        code,
        customerId: input.customerId,
        displayName: input.displayName,
        displayNameAr: input.displayNameAr ?? null,
        industry: input.industry ?? null,
        status: input.status,
        onboardedAt: input.onboardedAt ?? null,
        accountManagerId: input.accountManagerId ?? null,
        creditRating: input.creditRating ?? null,
        notes: input.notes ?? null,
      })
      .returning({ id: tenants.id });

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'create',
      entityType: 'tenant',
      entityId: created.id,
      entityLabel: input.displayName,
      newValue: { code, customerId: input.customerId, status: input.status },
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return created;
  });
}

export async function updateTenant(actor: SessionUser, tenantId: string, input: TenantWriteInput): Promise<{ id: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(tenants)
      .where(and(eq(tenants.id, tenantId), eq(tenants.organizationId, actor.organizationId), isNull(tenants.deletedAt)))
      .limit(1);
    if (!existing) throw notFound('Tenant', tenantId);

    // The customer link is immutable on edit — a tenant belongs to its customer.
    await tx
      .update(tenants)
      .set({
        displayName: input.displayName,
        displayNameAr: input.displayNameAr ?? null,
        industry: input.industry ?? null,
        status: input.status,
        onboardedAt: input.onboardedAt ?? null,
        accountManagerId: input.accountManagerId ?? null,
        creditRating: input.creditRating ?? null,
        notes: input.notes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'tenant',
      entityId: tenantId,
      entityLabel: input.displayName,
      previousValue: { displayName: existing.displayName, status: existing.status },
      newValue: { status: input.status },
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: tenantId };
  });
}

export async function getTenantForEdit(organizationId: string, tenantId: string) {
  const db = await getDb();
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.organizationId, organizationId), isNull(tenants.deletedAt)))
    .limit(1);
  return tenant ?? null;
}
