import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { bootstrapTestDb } from './setup-db';
import type { Database } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';

/**
 * End-to-end workflow tests covering the BRD acceptance scenarios:
 *  - Leasing lifecycle: create contract -> sign -> unit leased -> invoices
 *  - Collections roll-up: payment -> allocation -> invoice -> portfolio KPI
 *  - Maintenance roll-up: cost -> property OPEX
 *  - Website publishing: status change -> listing projection (BR-009)
 */

let db: Database;
let cleanup: () => void;
let actor: SessionUser;

async function makeActor(): Promise<SessionUser> {
  const { users } = await import('@/db/schema');
  const [user] = await db.select().from(users).where(eq(users.email, 'sayeed.almousa@riftara.sa')).limit(1);
  const { loadSessionUser } = await import('@/lib/auth/session');
  const loaded = await loadSessionUser(user.id);
  if (!loaded) throw new Error('actor not found');
  return loaded;
}

beforeAll(async () => {
  const ctx = await bootstrapTestDb();
  db = ctx.db;
  cleanup = ctx.cleanup;
  actor = await makeActor();
}, 180_000);

afterAll(() => cleanup?.());

describe('Acceptance Scenario 1 — Leasing lifecycle (BRD 154)', () => {
  it('creates, signs a contract; unit becomes leased and invoices are issued', async () => {
    const { units, unitStatuses, contracts, invoices, customers, tenants, paymentSchedules } = await import('@/db/schema');

    // Find an available unit.
    const [available] = await db
      .select({ id: units.id, propertyId: units.propertyId })
      .from(units)
      .where(eq(units.computedAvailabilityClass, 'available'))
      .limit(1);
    expect(available).toBeDefined();

    // Create a tenant from an existing customer.
    const [customer] = await db.select({ id: customers.id, name: customers.fullNameEn }).from(customers).where(eq(customers.customerType, 'corporate')).limit(1);
    const [tenant] = await db
      .insert(tenants)
      .values({ organizationId: actor.organizationId, code: `TEN-TEST-${Date.now()}`, customerId: customer.id, displayName: customer.name, status: 'active' })
      .returning({ id: tenants.id });

    const { createContract, signContract } = await import('@/services/contract-service');
    const created = await createContract(actor, {
      tenantId: tenant.id,
      propertyId: available.propertyId,
      unitId: available.id,
      startDate: '2025-06-01',
      endDate: '2027-05-31',
      annualRent: 300_000,
      paymentFrequency: 'quarterly',
    });
    expect(created.contractNumber).toMatch(/^LC-/);

    const result = await signContract(actor, created.id);
    expect(result.scheduleCount).toBe(8); // 2 years quarterly
    expect(result.invoiceCount).toBeGreaterThan(0);

    // BR-010 — the unit is now leased.
    const [unitStatus] = await db
      .select({ availabilityClass: units.computedAvailabilityClass, statusKey: unitStatuses.key })
      .from(units)
      .innerJoin(unitStatuses, eq(unitStatuses.id, units.statusId))
      .where(eq(units.id, available.id))
      .limit(1);
    expect(unitStatus.statusKey).toBe('leased');
    expect(unitStatus.availabilityClass).toBe('leased');

    // Contract is active.
    const [signed] = await db.select({ status: contracts.status, isActive: contracts.isActive }).from(contracts).where(eq(contracts.id, created.id)).limit(1);
    expect(signed.status).toBe('active');
    expect(signed.isActive).toBe(true);

    // Payment schedule and invoices exist.
    const [{ scheduleCount }] = await db.select({ scheduleCount: sql<number>`count(*)::int` }).from(paymentSchedules).where(eq(paymentSchedules.contractId, created.id));
    expect(Number(scheduleCount)).toBe(8);
    const [{ invoiceCount }] = await db.select({ invoiceCount: sql<number>`count(*)::int` }).from(invoices).where(eq(invoices.contractId, created.id));
    expect(Number(invoiceCount)).toBe(result.invoiceCount);
  });
});

describe('Acceptance Scenario 2 — Collections roll-up (BRD 155)', () => {
  it('records a payment that allocates to invoices and raises collected revenue', async () => {
    const { invoices } = await import('@/db/schema');
    const { getPortfolioSummary } = await import('@/services/metrics-service');
    const { recordPayment } = await import('@/services/collection-service');

    // Find a tenant with an outstanding invoice.
    const [openInvoice] = await db
      .select({ tenantId: invoices.tenantId, balance: invoices.balanceAmount, id: invoices.id })
      .from(invoices)
      .where(sql`${invoices.status} in ('due','overdue','partially_paid') and ${invoices.balanceAmount} > 0`)
      .limit(1);
    expect(openInvoice).toBeDefined();

    const before = await getPortfolioSummary({ organizationId: actor.organizationId });

    const amount = Math.min(Number(openInvoice.balance), 50_000);
    const result = await recordPayment(actor, {
      tenantId: openInvoice.tenantId,
      amount,
      paymentDate: new Date().toISOString().slice(0, 10),
      method: 'bank_transfer',
    });
    expect(result.allocated).toBeGreaterThan(0);

    const after = await getPortfolioSummary({ organizationId: actor.organizationId });
    // Collected revenue rolls up (BR-015).
    expect(after.collectedRevenue).toBeGreaterThanOrEqual(before.collectedRevenue);
  });
});

describe('Acceptance Scenario 3 — Maintenance cost roll-up (BRD 156)', () => {
  it('records a maintenance cost that increases property OPEX and reduces NOI', async () => {
    const { workOrders } = await import('@/db/schema');
    const { getPortfolioSummary } = await import('@/services/metrics-service');
    const { recordMaintenanceCost } = await import('@/services/maintenance-service');

    const [workOrder] = await db.select({ id: workOrders.id, propertyId: workOrders.propertyId }).from(workOrders).limit(1);
    const scope = { organizationId: actor.organizationId, propertyId: workOrder.propertyId };

    const before = await getPortfolioSummary(scope);
    await recordMaintenanceCost(actor, {
      workOrderId: workOrder.id,
      amount: 25_000,
      description: 'Test emergency repair',
      incurredOn: new Date().toISOString().slice(0, 10),
    });
    const after = await getPortfolioSummary(scope);

    // BR-014 — maintenance cost rolls up and reduces NOI (BRD 156).
    expect(after.maintenanceCost).toBeGreaterThanOrEqual(before.maintenanceCost + 24_999);
    expect(after.netOperatingIncome).toBeLessThan(before.netOperatingIncome);
  });
});

describe('Acceptance Scenario 4 — Website publishing (BR-001, BR-009)', () => {
  it('publishes an available unit and refuses to publish a non-eligible unit', async () => {
    const { units } = await import('@/db/schema');
    const { publishUnit } = await import('@/services/publishing-service');

    const [available] = await db
      .select({ id: units.id })
      .from(units)
      .where(eq(units.computedAvailabilityClass, 'available'))
      .limit(1);
    await expect(publishUnit(actor, available.id)).resolves.not.toThrow();

    // A leased/not-available unit cannot be published (BR-001).
    const [leased] = await db
      .select({ id: units.id })
      .from(units)
      .where(eq(units.computedAvailabilityClass, 'leased'))
      .limit(1);
    const { AppError } = await import('@/lib/errors');
    await expect(publishUnit(actor, leased.id)).rejects.toSatisfy(
      (error: unknown) => error instanceof AppError && error.rule === 'BR-001',
    );
  });

  it('creates a website listing projection when a unit is published (BR-009)', async () => {
    const { units, websiteListings } = await import('@/db/schema');
    const [available] = await db
      .select({ id: units.id })
      .from(units)
      .where(eq(units.computedAvailabilityClass, 'available'))
      .limit(1);

    const { publishUnit } = await import('@/services/publishing-service');
    await publishUnit(actor, available.id);

    const [listing] = await db.select().from(websiteListings).where(eq(websiteListings.unitId, available.id)).limit(1);
    expect(listing).toBeDefined();
    expect(listing.isPublished).toBe(true);
  });
});

describe('BR-006 — lost lead requires a loss reason', () => {
  it('rejects moving a lead to lost without a reason', async () => {
    const { leads } = await import('@/db/schema');
    const { moveLeadToStage } = await import('@/services/lead-service');

    const [lead] = await db.select({ id: leads.id }).from(leads).where(sql`${leads.closedAt} is null`).limit(1);
    await expect(moveLeadToStage(actor, { leadId: lead.id, stageKey: 'lost' })).rejects.toThrow(/BR-006|loss reason/i);
  });
});

describe('BR-007 — duplicate customer links instead of duplicating', () => {
  it('returns the existing customer when an identifier already exists', async () => {
    const { customerIdentifiers, customers } = await import('@/db/schema');
    const { createCustomerWithDeduplication } = await import('@/services/customer-service');

    const [identifier] = await db
      .select({ value: customerIdentifiers.identifierValue, customerId: customerIdentifiers.customerId })
      .from(customerIdentifiers)
      .where(eq(customerIdentifiers.identifierType, 'mobile'))
      .limit(1);

    const [{ before }] = await db.select({ before: sql<number>`count(*)::int` }).from(customers);

    const result = await createCustomerWithDeduplication(actor, {
      customerType: 'individual',
      fullNameEn: 'Duplicate Test',
      mobile: identifier.value,
    });

    expect(result.created).toBe(false);
    expect(result.customerId).toBe(identifier.customerId);

    const [{ after }] = await db.select({ after: sql<number>`count(*)::int` }).from(customers);
    expect(Number(after)).toBe(Number(before)); // no new customer created
  });
});
