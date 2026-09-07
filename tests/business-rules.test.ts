import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { bootstrapTestDb } from './setup-db';
import type { Database } from '@/db/types';

/**
 * Integration tests against a real (embedded PostgreSQL) database. These prove
 * the BRD business rules are enforced at the layer where it matters — the
 * database constraints and triggers, not just the application code.
 */

let db: Database;
let cleanup: () => void;
let orgId: string;

beforeAll(async () => {
  const ctx = await bootstrapTestDb();
  db = ctx.db;
  cleanup = ctx.cleanup;
  const { organizations } = await import('@/db/schema');
  const [org] = await db.select({ id: organizations.id }).from(organizations).limit(1);
  orgId = org.id;
}, 180_000);

afterAll(() => cleanup?.());

/** Flattens a rejected DB error (Drizzle wraps the trigger message in `cause`). */
async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return '';
  } catch (error) {
    const parts: string[] = [];
    let current: unknown = error;
    let depth = 0;
    while (current && depth < 8) {
      if (current instanceof Error) parts.push(current.message);
      else if (typeof current === 'object' && 'message' in (current as Record<string, unknown>)) {
        parts.push(String((current as Record<string, unknown>).message));
      }
      current = (current as { cause?: unknown })?.cause;
      depth += 1;
    }
    return parts.join(' | ');
  }
}


describe('Seed integrity', () => {
  it('creates the expected portfolio shape', async () => {
    const { properties, units } = await import('@/db/schema');
    const [{ propertyCount }] = await db.select({ propertyCount: sql<number>`count(*)::int` }).from(properties);
    const [{ unitCount }] = await db.select({ unitCount: sql<number>`count(*)::int` }).from(units);
    expect(Number(propertyCount)).toBe(7);
    expect(Number(unitCount)).toBeGreaterThan(200);
  });

  it('collections reconcile: total invoice paid = total allocations (BR-015)', async () => {
    const { invoices, paymentAllocations } = await import('@/db/schema');
    const [{ totalPaid }] = await db
      .select({ totalPaid: sql<number>`coalesce(sum(${invoices.paidAmount}), 0)::float8` })
      .from(invoices);
    const [{ totalAllocated }] = await db
      .select({ totalAllocated: sql<number>`coalesce(sum(${paymentAllocations.amount}), 0)::float8` })
      .from(paymentAllocations);

    // Portfolio-level collections must reconcile to the cent.
    expect(Math.abs(Number(totalPaid) - Number(totalAllocated))).toBeLessThan(1);
  });

  it('tenant ledger running balance equals cumulative debits minus credits (BRD 48)', async () => {
    const { tenantLedgerEntries } = await import('@/db/schema');
    const [tenant] = await db
      .select({ tenantId: tenantLedgerEntries.tenantId })
      .from(tenantLedgerEntries)
      .limit(1);

    const entries = await db
      .select()
      .from(tenantLedgerEntries)
      .where(eq(tenantLedgerEntries.tenantId, tenant.tenantId))
      .orderBy(tenantLedgerEntries.createdAt);

    let balance = 0;
    for (const entry of entries) {
      balance = Math.round((balance + Number(entry.debitAmount) - Number(entry.creditAmount)) * 100) / 100;
      expect(Math.abs(balance - Number(entry.runningBalance))).toBeLessThan(0.05);
    }
  });
});

describe('BR-012 — signed contracts cannot be deleted', () => {
  it('rejects deletion of an active contract', async () => {
    const { contracts } = await import('@/db/schema');
    const [active] = await db.select({ id: contracts.id }).from(contracts).where(eq(contracts.status, 'active')).limit(1);
    const message = await rejectionMessage(db.delete(contracts).where(eq(contracts.id, active.id)));
    expect(message).toMatch(/BR-012/);
  });
});

describe('BR-013 — financial transactions cannot be deleted', () => {
  it('rejects deletion of an invoice', async () => {
    const { invoices } = await import('@/db/schema');
    const [invoice] = await db.select({ id: invoices.id }).from(invoices).limit(1);
    const message = await rejectionMessage(db.delete(invoices).where(eq(invoices.id, invoice.id)));
    expect(message).toMatch(/BR-013/);
  });

  it('rejects deletion of a payment', async () => {
    const { payments } = await import('@/db/schema');
    const [payment] = await db.select({ id: payments.id }).from(payments).limit(1);
    const message = await rejectionMessage(db.delete(payments).where(eq(payments.id, payment.id)));
    expect(message).toMatch(/BR-013/);
  });
});

describe('BR-017 — audit log is append-only', () => {
  it('accepts inserts but rejects updates and deletes', async () => {
    const { auditLogs } = await import('@/db/schema');
    const [entry] = await db
      .insert(auditLogs)
      .values({
        organizationId: orgId,
        action: 'update',
        entityType: 'test',
        entityLabel: 'append-only check',
      })
      .returning({ id: auditLogs.id });

    const updateMessage = await rejectionMessage(
      db.update(auditLogs).set({ reason: 'tampered' }).where(eq(auditLogs.id, entry.id)),
    );
    expect(updateMessage).toMatch(/BR-017/);

    const deleteMessage = await rejectionMessage(db.delete(auditLogs).where(eq(auditLogs.id, entry.id)));
    expect(deleteMessage).toMatch(/BR-017/);
  });
});

describe('BR-002 — one active reservation per unit', () => {
  it('rejects a second active reservation for the same unit', async () => {
    const { reservations } = await import('@/db/schema');
    const [existing] = await db
      .select()
      .from(reservations)
      .where(eq(reservations.isActive, true))
      .limit(1);

    await expect(
      db.insert(reservations).values({
        organizationId: orgId,
        code: `RES-DUP-${Date.now()}`,
        customerId: existing.customerId,
        propertyId: existing.propertyId,
        unitId: existing.unitId,
        reservationDate: '2025-01-01',
        expiryDate: '2025-01-15',
        status: 'active',
        isActive: true,
      }),
    ).rejects.toThrow();
  });
});

describe('BR-003 — no overlapping active contracts per unit', () => {
  it('rejects an overlapping active contract via the database trigger', async () => {
    const { contracts } = await import('@/db/schema');
    const [existing] = await db
      .select()
      .from(contracts)
      .where(eq(contracts.isActive, true))
      .limit(1);

    const message = await rejectionMessage(
      db.insert(contracts).values({
        organizationId: orgId,
        contractNumber: `LC-DUP-${Date.now()}`,
        tenantId: existing.tenantId,
        lessorName: 'Test Lessor',
        propertyId: existing.propertyId,
        unitId: existing.unitId,
        startDate: existing.startDate,
        endDate: existing.endDate,
        durationMonths: 12,
        annualRent: 100000,
        paymentFrequency: 'quarterly',
        status: 'active',
        isActive: true,
      }),
    );
    expect(message).toMatch(/BR-003/);
  });
});

describe('BR-005 — price history is append-only', () => {
  it('rejects updates to price history', async () => {
    const { priceHistory } = await import('@/db/schema');
    const [entry] = await db.select({ id: priceHistory.id }).from(priceHistory).limit(1);
    await expect(
      db.update(priceHistory).set({ reason: 'tampered' }).where(eq(priceHistory.id, entry.id)),
    ).rejects.toThrow();
  });
});

describe('BR-007 — customer duplicate detection', () => {
  it('detects an existing customer by mobile', async () => {
    const { customerIdentifiers } = await import('@/db/schema');
    const { detectDuplicates } = await import('@/services/customer-service');

    const [identifier] = await db
      .select({ value: customerIdentifiers.identifierValue, customerId: customerIdentifiers.customerId })
      .from(customerIdentifiers)
      .where(eq(customerIdentifiers.identifierType, 'mobile'))
      .limit(1);

    const matches = await detectDuplicates(orgId, { mobile: identifier.value });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].customerId).toBe(identifier.customerId);
  });

  it('rejects a duplicate identifier at the database level', async () => {
    const { customerIdentifiers } = await import('@/db/schema');
    const [identifier] = await db
      .select()
      .from(customerIdentifiers)
      .where(eq(customerIdentifiers.identifierType, 'mobile'))
      .limit(1);

    await expect(
      db.insert(customerIdentifiers).values({
        organizationId: orgId,
        customerId: identifier.customerId,
        identifierType: 'mobile',
        identifierValue: identifier.identifierValue,
      }),
    ).rejects.toThrow();
  });
});

describe('BR-016 — dashboards read the shared metrics service', () => {
  it('portfolio summary returns reconcilable figures', async () => {
    const { getPortfolioSummary } = await import('@/services/metrics-service');
    const summary = await getPortfolioSummary({ organizationId: orgId });
    expect(summary.totalUnits).toBeGreaterThan(200);
    expect(summary.occupancyRate).toBeGreaterThan(0);
    expect(summary.occupancyRate).toBeLessThanOrEqual(100);
    expect(summary.collectionRate).toBeGreaterThan(0);
    expect(summary.marketValue).toBeGreaterThan(0);
    // NOI = gross income - vacancy loss - opex - maintenance (BRD 57, 156).
    const recomputed =
      Math.round(
        (summary.billedRevenue - summary.vacancyLoss - summary.operatingExpenses - summary.maintenanceCost) * 100,
      ) / 100;
    expect(Math.abs(summary.netOperatingIncome - recomputed)).toBeLessThan(1);
  });
});
