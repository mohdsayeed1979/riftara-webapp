import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { bootstrapTestDb } from './setup-db';
import type { Database } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';
import { isUuid } from '@/lib/utils';

// Mock only getSession so the server actions' RBAC guard can be exercised with
// controlled users; every other session export keeps its real implementation.
vi.mock('@/lib/auth/session', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth/session')>();
  return { ...mod, getSession: vi.fn() };
});

const FOREIGN_ORG = '00000000-0000-4000-8000-000000000000';

let db: Database;
let cleanup: () => void;
let admin: SessionUser;
let getSessionMock: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  const ctx = await bootstrapTestDb();
  db = ctx.db;
  cleanup = ctx.cleanup;

  const { users } = await import('@/db/schema');
  const { loadSessionUser, getSession } = await import('@/lib/auth/session');
  getSessionMock = getSession as unknown as ReturnType<typeof vi.fn>;

  const [u] = await db.select().from(users).where(eq(users.email, 'sayeed.almousa@riftara.sa')).limit(1);
  const loaded = await loadSessionUser(u.id);
  if (!loaded) throw new Error('admin actor not found');
  admin = loaded;
}, 180_000);

afterAll(() => cleanup?.());

async function anOpenInvoice() {
  const { invoices } = await import('@/db/schema');
  const [row] = await db
    .select({ id: invoices.id, tenantId: invoices.tenantId, balance: invoices.balanceAmount, total: invoices.totalAmount })
    .from(invoices)
    .where(and(inArray(invoices.status, ['due', 'overdue', 'partially_paid']), isNull(invoices.deletedAt)))
    .limit(1);
  return row;
}

/* -------------------------------------------------------------------------- */
describe('Invoice detail', () => {
  it('returns a full invoice for the owning organization', async () => {
    const { getInvoiceDetail } = await import('@/services/collection-service');
    const open = await anOpenInvoice();
    const detail = await getInvoiceDetail(admin.organizationId, open.id);
    expect(detail).not.toBeNull();
    expect(detail!.invoice.id).toBe(open.id);
    expect(detail!.invoice.tenantName).toBeTruthy();
    expect(detail!.invoice.balanceAmount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(detail!.allocations)).toBe(true);
  });

  it('rejects invalid UUIDs at the route guard', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(FOREIGN_ORG)).toBe(true);
  });

  it('returns null for a missing invoice and for another organization', async () => {
    const { getInvoiceDetail } = await import('@/services/collection-service');
    const open = await anOpenInvoice();
    expect(await getInvoiceDetail(admin.organizationId, FOREIGN_ORG)).toBeNull();
    expect(await getInvoiceDetail(FOREIGN_ORG, open.id)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
describe('Invoice generation', () => {
  async function insertSchedule(contractId: string, organizationId: string, installmentNumber: number) {
    const { paymentSchedules } = await import('@/db/schema');
    const [sch] = await db
      .insert(paymentSchedules)
      .values({
        organizationId,
        contractId,
        installmentNumber,
        periodStart: '2025-01-01',
        periodEnd: '2025-03-31',
        invoiceDate: '2025-01-01',
        dueDate: '2025-01-15',
        rentAmount: 30000,
        serviceChargeAmount: 3000,
        vatAmount: 4950,
        totalAmount: 37950,
      })
      .returning({ id: paymentSchedules.id });
    return sch.id;
  }

  it('generates an invoice from a schedule and is idempotent (duplicate prevention)', async () => {
    const { contracts, paymentSchedules, invoices, auditLogs } = await import('@/db/schema');
    const { generateInvoiceFromSchedule } = await import('@/services/collection-service');
    const [contract] = await db
      .select({ id: contracts.id })
      .from(contracts)
      .where(inArray(contracts.status, ['signed', 'active']))
      .limit(1);
    const scheduleId = await insertSchedule(contract.id, admin.organizationId, 900);

    const first = await generateInvoiceFromSchedule(admin, scheduleId);
    expect(first.alreadyExisted).toBe(false);
    expect(first.invoiceNumber).toMatch(/^INV-/);

    const [sch] = await db.select({ invoiceId: paymentSchedules.invoiceId }).from(paymentSchedules).where(eq(paymentSchedules.id, scheduleId));
    expect(sch.invoiceId).toBe(first.invoiceId);

    const [inv] = await db.select({ balance: invoices.balanceAmount, total: invoices.totalAmount }).from(invoices).where(eq(invoices.id, first.invoiceId));
    expect(Number(inv.total)).toBe(37950);
    expect(Number(inv.balance)).toBe(37950);

    const audit = await db.select({ action: auditLogs.action }).from(auditLogs).where(and(eq(auditLogs.entityType, 'invoice'), eq(auditLogs.entityId, first.invoiceId)));
    expect(audit.some((a) => a.action === 'create')).toBe(true);

    const second = await generateInvoiceFromSchedule(admin, scheduleId);
    expect(second.alreadyExisted).toBe(true);
    expect(second.invoiceId).toBe(first.invoiceId);
  });

  it('rejects generation for a non signed/active contract', async () => {
    const { contracts } = await import('@/db/schema');
    const { generateInvoiceFromSchedule } = await import('@/services/collection-service');
    const [contract] = await db
      .select({ id: contracts.id, status: contracts.status })
      .from(contracts)
      .where(inArray(contracts.status, ['signed', 'active']))
      .offset(1)
      .limit(1);
    await db.update(contracts).set({ status: 'draft' }).where(eq(contracts.id, contract.id));
    const scheduleId = await insertSchedule(contract.id, admin.organizationId, 901);
    await expect(generateInvoiceFromSchedule(admin, scheduleId)).rejects.toMatchObject({ code: 'CONFLICT' });
    // restore
    await db.update(contracts).set({ status: contract.status }).where(eq(contracts.id, contract.id));
  });

  it('rejects a schedule from another organization', async () => {
    const { contracts } = await import('@/db/schema');
    const { generateInvoiceFromSchedule } = await import('@/services/collection-service');
    const [contract] = await db.select({ id: contracts.id }).from(contracts).where(inArray(contracts.status, ['signed', 'active'])).limit(1);
    const foreignActor = { ...admin, organizationId: FOREIGN_ORG };
    // A schedule exists in the real org; a foreign actor must not resolve it.
    const { paymentSchedules } = await import('@/db/schema');
    const [sch] = await db.select({ id: paymentSchedules.id }).from(paymentSchedules).where(eq(paymentSchedules.contractId, contract.id)).limit(1);
    await expect(generateInvoiceFromSchedule(foreignActor, sch.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('denies generation without collections:create (RBAC)', async () => {
    const { generateInvoiceAction } = await import('@/app/(app)/collections/actions');
    const { paymentSchedules } = await import('@/db/schema');
    const [sch] = await db.select({ id: paymentSchedules.id }).from(paymentSchedules).limit(1);
    getSessionMock.mockResolvedValue({ ...admin, permissions: [] });
    const result = await generateInvoiceAction(sch.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');
  });
});

/* -------------------------------------------------------------------------- */
describe('Payment recording & allocation', () => {
  it('records a partial payment, reduces the balance and writes a ledger entry + audit', async () => {
    const { recordPayment } = await import('@/services/collection-service');
    const { invoices, tenantLedgerEntries, auditLogs } = await import('@/db/schema');
    const open = await anOpenInvoice();
    const before = Number(open.balance);
    const part = Math.max(1, Math.round(before / 2));

    const result = await recordPayment(admin, {
      tenantId: open.tenantId,
      amount: part,
      paymentDate: '2025-02-01',
      method: 'bank_transfer',
      invoiceId: open.id,
    });
    expect(result.allocated).toBeGreaterThan(0);

    const [after] = await db.select({ balance: invoices.balanceAmount, paid: invoices.paidAmount, status: invoices.status }).from(invoices).where(eq(invoices.id, open.id));
    expect(Number(after.balance)).toBeLessThan(before);

    const ledger = await db.select({ id: tenantLedgerEntries.id }).from(tenantLedgerEntries).where(eq(tenantLedgerEntries.paymentId, result.paymentId));
    expect(ledger.length).toBe(1);

    const audit = await db.select({ action: auditLogs.action }).from(auditLogs).where(and(eq(auditLogs.entityType, 'payment'), eq(auditLogs.entityId, result.paymentId)));
    expect(audit.some((a) => a.action === 'allocate')).toBe(true);
  });

  it('prevents over-allocation by returning the excess as unallocated', async () => {
    const { recordPayment } = await import('@/services/collection-service');
    const open = await anOpenInvoice();
    const huge = Number(open.balance) + 1_000_000;
    const result = await recordPayment(admin, {
      tenantId: open.tenantId,
      amount: huge,
      paymentDate: '2025-02-02',
      method: 'bank_transfer',
      invoiceId: open.id,
    });
    expect(result.unallocated).toBeGreaterThan(0);
    expect(result.allocated).toBeLessThanOrEqual(huge);
  });

  it('does not allocate to an invoice belonging to a different tenant', async () => {
    const { recordPayment } = await import('@/services/collection-service');
    const { invoices } = await import('@/db/schema');
    const open = await anOpenInvoice();
    const candidates = await db
      .select({ id: invoices.id, tenantId: invoices.tenantId })
      .from(invoices)
      .where(and(inArray(invoices.status, ['due', 'overdue', 'partially_paid']), isNull(invoices.deletedAt)))
      .limit(200);
    const foreignInvoice = candidates.find((r) => r.tenantId !== open.tenantId);
    if (!foreignInvoice) return; // single-tenant dataset — nothing to assert
    const result = await recordPayment(admin, {
      tenantId: open.tenantId,
      amount: 500,
      paymentDate: '2025-02-03',
      method: 'cash',
      invoiceId: foreignInvoice.id,
    });
    // The targeted invoice is not the payer's, so nothing is allocated to it.
    expect(result.allocated).toBe(0);
    expect(result.unallocated).toBeCloseTo(500, 2);
  });

  it('rejects a payment for a tenant in another organization', async () => {
    const { recordPayment } = await import('@/services/collection-service');
    const open = await anOpenInvoice();
    await expect(
      recordPayment({ ...admin, organizationId: FOREIGN_ORG }, {
        tenantId: open.tenantId,
        amount: 100,
        paymentDate: '2025-02-04',
        method: 'cash',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

/* -------------------------------------------------------------------------- */
describe('Tenant ledger & receivables rollup', () => {
  it('returns ledger entries and a running balance scoped to the organization', async () => {
    const { getTenantLedger } = await import('@/services/collection-service');
    const open = await anOpenInvoice();
    const ledger = await getTenantLedger(admin.organizationId, open.tenantId);
    expect(ledger.tenant.id).toBe(open.tenantId);
    expect(Array.isArray(ledger.entries)).toBe(true);
    await expect(getTenantLedger(FOREIGN_ORG, open.tenantId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('computes tenant receivables totals', async () => {
    const { getTenantReceivables } = await import('@/services/collection-service');
    const open = await anOpenInvoice();
    const r = await getTenantReceivables(admin.organizationId, open.tenantId);
    expect(r.totalInvoiced).toBeGreaterThan(0);
    expect(r.outstanding).toBeGreaterThanOrEqual(0);
    expect(r.totalPaid).toBeGreaterThanOrEqual(0);
  });
});

/* -------------------------------------------------------------------------- */
describe('Overdue notifications (idempotent runtime generation)', () => {
  it('marks overdue invoices, creates one notification each, and never duplicates', async () => {
    const { invoices, notifications } = await import('@/db/schema');
    const { generateOverdueNotifications } = await import('@/services/collection-service');

    // Force a known invoice to be past-due and open, with no prior notification.
    const open = await anOpenInvoice();
    await db.update(invoices).set({ status: 'due', dueDate: '2024-01-01' }).where(eq(invoices.id, open.id));
    await db
      .delete(notifications)
      .where(and(eq(notifications.notificationType, 'payment_overdue'), eq(notifications.entityId, open.id)));

    const first = await generateOverdueNotifications({ id: admin.id, organizationId: admin.organizationId, fullName: admin.fullName });
    expect(first.notificationsCreated).toBeGreaterThan(0);

    const created = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.organizationId, admin.organizationId), eq(notifications.notificationType, 'payment_overdue'), eq(notifications.entityId, open.id)));
    expect(created.length).toBe(1);

    // Second run is idempotent: no new notification for the same invoice.
    const second = await generateOverdueNotifications({ id: admin.id, organizationId: admin.organizationId, fullName: admin.fullName });
    const after = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.organizationId, admin.organizationId), eq(notifications.notificationType, 'payment_overdue'), eq(notifications.entityId, open.id)));
    expect(after.length).toBe(1);
    expect(second.notificationsCreated).toBeGreaterThanOrEqual(0);
  });
});

/* -------------------------------------------------------------------------- */
describe('Dunning queue & collection actions', () => {
  it('lists overdue tenants with a recommended action and records an action + audit', async () => {
    const { getDunningQueue, recordCollectionAction, listCollectionActions } = await import('@/services/collection-service');
    const { auditLogs } = await import('@/db/schema');

    const queue = await getDunningQueue(admin.organizationId, null);
    expect(queue.length).toBeGreaterThan(0);
    const target = queue[0];
    expect(target.recommendedAction === null || typeof target.recommendedAction === 'string').toBe(true);

    const action = await recordCollectionAction(admin, {
      tenantId: target.tenantId,
      actionType: 'reminder',
      outstandingAmount: target.outstanding,
      daysOverdue: target.maxDaysOverdue,
      notes: 'Test reminder',
    });
    expect(action.id).toBeTruthy();

    const history = await listCollectionActions(admin.organizationId, target.tenantId);
    expect(history.some((h) => h.id === action.id)).toBe(true);

    const audit = await db.select({ action: auditLogs.action }).from(auditLogs).where(and(eq(auditLogs.entityType, 'collection_action'), eq(auditLogs.entityId, action.id)));
    expect(audit.some((a) => a.action === 'create')).toBe(true);
  });

  it('denies logging a collection action without collections:edit (RBAC)', async () => {
    const { recordCollectionActionAction } = await import('@/app/(app)/collections/actions');
    const { getDunningQueue } = await import('@/services/collection-service');
    const [target] = await getDunningQueue(admin.organizationId, null);
    getSessionMock.mockResolvedValue({ ...admin, permissions: [] });
    const result = await recordCollectionActionAction({
      tenantId: target.tenantId,
      actionType: 'reminder',
      outstandingAmount: target.outstanding,
      daysOverdue: target.maxDaysOverdue,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');
  });
});

/* -------------------------------------------------------------------------- */
describe('Statement export', () => {
  it('returns statement rows for the tenant and rejects another organization', async () => {
    const { getTenantStatementRows } = await import('@/services/collection-service');
    const open = await anOpenInvoice();
    const statement = await getTenantStatementRows(admin.organizationId, open.tenantId);
    expect(statement.tenantName).toBeTruthy();
    expect(statement.rows.length).toBeGreaterThan(0);
    expect(statement.rows[0]).toHaveProperty('outstanding');
    await expect(getTenantStatementRows(FOREIGN_ORG, open.tenantId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
