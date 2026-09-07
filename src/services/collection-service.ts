import 'server-only';
import { and, asc, count, desc, eq, ilike, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  collectionActions,
  invoices,
  paymentAllocations,
  payments,
  properties,
  tenantLedgerEntries,
  tenants,
  units,
} from '@/db/schema';
import type { DbExecutor } from '@/db/types';
import { recordAudit } from '@/lib/audit';
import { notFound, validationError } from '@/lib/errors';
import { allocatePayment, daysOverdue, deriveInvoiceStatus } from '@/lib/calculations/finance';
import { getPolicy } from '@/lib/settings';
import { round2 } from '@/lib/utils';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Collections service (BRD 42-49).
 *
 * BR-013: payments and invoices are never deleted — they are reversed,
 *         cancelled or waived. BR-015: a payment rolls up to unit, property,
 *         city and portfolio collection KPIs via the shared metrics service.
 */

export interface OverdueInvoiceRow {
  id: string;
  invoiceNumber: string;
  tenantName: string;
  tenantId: string;
  propertyName: string;
  unitNumber: string;
  invoiceDate: string;
  dueDate: string;
  totalAmount: number;
  paidAmount: number;
  balance: number;
  daysOverdue: number;
  status: string;
}

export interface InvoiceListFilters {
  organizationId: string;
  allowedPropertyIds?: string[] | null;
  propertyId?: string;
  tenantId?: string;
  status?: string;
  agingBucket?: string;
  search?: string;
  page: number;
  pageSize: number;
}

export async function listInvoices(
  filters: InvoiceListFilters,
): Promise<{ items: OverdueInvoiceRow[]; total: number }> {
  const db = await getDb();
  const conditions: SQL[] = [eq(invoices.organizationId, filters.organizationId), isNull(invoices.deletedAt)];
  if (filters.allowedPropertyIds?.length) conditions.push(inArray(invoices.propertyId, filters.allowedPropertyIds));
  if (filters.propertyId) conditions.push(eq(invoices.propertyId, filters.propertyId));
  if (filters.tenantId) conditions.push(eq(invoices.tenantId, filters.tenantId));
  if (filters.status) conditions.push(eq(invoices.status, filters.status as typeof invoices.$inferSelect.status));
  else conditions.push(inArray(invoices.status, ['due', 'overdue', 'partially_paid']));
  if (filters.search) conditions.push(ilike(invoices.invoiceNumber, `%${filters.search}%`));

  const where = and(...conditions) as SQL;

  const rows = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      tenantName: tenants.displayName,
      tenantId: invoices.tenantId,
      propertyName: properties.nameEn,
      unitNumber: units.unitNumber,
      invoiceDate: invoices.invoiceDate,
      dueDate: invoices.dueDate,
      totalAmount: invoices.totalAmount,
      paidAmount: invoices.paidAmount,
      balance: invoices.balanceAmount,
      status: invoices.status,
    })
    .from(invoices)
    .innerJoin(tenants, eq(tenants.id, invoices.tenantId))
    .innerJoin(properties, eq(properties.id, invoices.propertyId))
    .innerJoin(units, eq(units.id, invoices.unitId))
    .where(where)
    .orderBy(asc(invoices.dueDate))
    .limit(filters.pageSize)
    .offset((filters.page - 1) * filters.pageSize);

  const [{ total }] = await db.select({ total: count() }).from(invoices).where(where);

  const now = new Date();
  return {
    items: rows.map((row) => ({
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      tenantName: row.tenantName,
      tenantId: row.tenantId,
      propertyName: row.propertyName,
      unitNumber: row.unitNumber,
      invoiceDate: row.invoiceDate,
      dueDate: row.dueDate,
      totalAmount: round2(Number(row.totalAmount)),
      paidAmount: round2(Number(row.paidAmount)),
      balance: round2(Number(row.balance)),
      daysOverdue: daysOverdue(new Date(row.dueDate), now),
      status: row.status,
    })),
    total: Number(total),
  };
}

export interface TopOverdueTenant {
  tenantId: string;
  tenantName: string;
  outstanding: number;
  maxDaysOverdue: number;
  invoiceCount: number;
}

export async function getTopOverdueTenants(
  organizationId: string,
  allowedPropertyIds: string[] | null,
  limit = 6,
): Promise<TopOverdueTenant[]> {
  const db = await getDb();
  const conditions: SQL[] = [
    eq(invoices.organizationId, organizationId),
    eq(invoices.status, 'overdue'),
  ];
  if (allowedPropertyIds?.length) conditions.push(inArray(invoices.propertyId, allowedPropertyIds));

  const rows = await db
    .select({
      tenantId: invoices.tenantId,
      tenantName: tenants.displayName,
      outstanding: sql<number>`sum(${invoices.balanceAmount})::float8`,
      minDue: sql<string>`min(${invoices.dueDate})`,
      invoiceCount: sql<number>`count(*)::int`,
    })
    .from(invoices)
    .innerJoin(tenants, eq(tenants.id, invoices.tenantId))
    .where(and(...conditions))
    .groupBy(invoices.tenantId, tenants.displayName)
    .orderBy(desc(sql`sum(${invoices.balanceAmount})`))
    .limit(limit);

  const now = Date.now();
  return rows.map((row) => ({
    tenantId: row.tenantId,
    tenantName: row.tenantName,
    outstanding: round2(Number(row.outstanding)),
    maxDaysOverdue: Math.max(0, Math.floor((now - new Date(row.minDue).getTime()) / 86_400_000)),
    invoiceCount: Number(row.invoiceCount),
  }));
}

/* -------------------------------------------------------------------------- */
/* Payment recording + allocation (BRD 40, 49; BR-013, BR-015)                 */
/* -------------------------------------------------------------------------- */

export interface RecordPaymentInput {
  tenantId: string;
  amount: number;
  paymentDate: string;
  method: string;
  referenceNumber?: string;
  bankName?: string;
  paymentType?: string;
  contractId?: string;
  notes?: string;
  /** Explicit invoice to settle; otherwise oldest-first auto-allocation. */
  invoiceId?: string;
}

export async function recordPayment(
  actor: SessionUser,
  input: RecordPaymentInput,
): Promise<{ paymentId: string; paymentNumber: string; allocated: number; unallocated: number }> {
  if (input.amount <= 0) throw validationError('Payment amount must be greater than zero.');

  const db = await getDb();
  const policy = await getPolicy(actor.organizationId);

  return db.transaction(async (tx) => {
    const [tenant] = await tx
      .select({ id: tenants.id, displayName: tenants.displayName })
      .from(tenants)
      .where(and(eq(tenants.id, input.tenantId), eq(tenants.organizationId, actor.organizationId)))
      .limit(1);
    if (!tenant) throw notFound('Tenant', input.tenantId);

    const paymentNumber = await nextSequence(tx, 'payments', actor.organizationId, 'PMT', 6);

    // Resolve one representative property/unit for the payment header.
    const [ref] = await tx
      .select({ propertyId: invoices.propertyId, unitId: invoices.unitId })
      .from(invoices)
      .where(and(eq(invoices.tenantId, input.tenantId), inArray(invoices.status, ['due', 'overdue', 'partially_paid'])))
      .orderBy(asc(invoices.dueDate))
      .limit(1);

    const [payment] = await tx
      .insert(payments)
      .values({
        organizationId: actor.organizationId,
        paymentNumber,
        tenantId: input.tenantId,
        contractId: input.contractId ?? null,
        propertyId: ref?.propertyId ?? null,
        unitId: ref?.unitId ?? null,
        paymentDate: input.paymentDate,
        amount: round2(input.amount),
        unallocatedAmount: round2(input.amount),
        method: input.method,
        referenceNumber: input.referenceNumber ?? null,
        bankName: input.bankName ?? null,
        status: 'received',
        paymentType: input.paymentType ?? 'rent',
        notes: input.notes ?? null,
        recordedByUserId: actor.id,
      })
      .returning({ id: payments.id });

    // Determine the invoices to settle.
    let openInvoices: Array<{ invoiceId: string; dueDate: Date; balance: number }>;
    if (input.invoiceId) {
      const [target] = await tx
        .select({ id: invoices.id, dueDate: invoices.dueDate, balance: invoices.balanceAmount })
        .from(invoices)
        .where(and(eq(invoices.id, input.invoiceId), eq(invoices.tenantId, input.tenantId)))
        .limit(1);
      openInvoices = target ? [{ invoiceId: target.id, dueDate: new Date(target.dueDate), balance: Number(target.balance) }] : [];
    } else if (policy.autoAllocatePayments) {
      const rows = await tx
        .select({ id: invoices.id, dueDate: invoices.dueDate, balance: invoices.balanceAmount })
        .from(invoices)
        .where(
          and(
            eq(invoices.tenantId, input.tenantId),
            inArray(invoices.status, ['due', 'overdue', 'partially_paid']),
          ),
        )
        .orderBy(asc(invoices.dueDate));
      openInvoices = rows.map((row) => ({ invoiceId: row.id, dueDate: new Date(row.dueDate), balance: Number(row.balance) }));
    } else {
      openInvoices = [];
    }

    const allocation = allocatePayment(input.amount, openInvoices);

    for (const line of allocation.lines) {
      await tx.insert(paymentAllocations).values({
        paymentId: payment.id,
        invoiceId: line.invoiceId,
        amount: line.amount,
        allocationMethod: input.invoiceId ? 'manual' : 'automatic',
        allocatedByUserId: actor.id,
      });

      // Update the invoice paid/balance and status.
      const [invoice] = await tx
        .select({
          totalAmount: invoices.totalAmount,
          paidAmount: invoices.paidAmount,
          dueDate: invoices.dueDate,
          invoiceDate: invoices.invoiceDate,
        })
        .from(invoices)
        .where(eq(invoices.id, line.invoiceId))
        .limit(1);

      const newPaid = round2(Number(invoice.paidAmount) + line.amount);
      const status = deriveInvoiceStatus({
        totalAmount: Number(invoice.totalAmount),
        paidAmount: newPaid,
        dueDate: new Date(invoice.dueDate),
        invoiceDate: new Date(invoice.invoiceDate),
      });

      await tx
        .update(invoices)
        .set({
          paidAmount: newPaid,
          balanceAmount: round2(Number(invoice.totalAmount) - newPaid),
          status,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, line.invoiceId));
    }

    await tx
      .update(payments)
      .set({ unallocatedAmount: allocation.unallocated, status: allocation.unallocated > 0 ? 'received' : 'reconciled' })
      .where(eq(payments.id, payment.id));

    // Append the payment to the tenant ledger (BRD 48).
    await appendLedgerEntry(tx, {
      organizationId: actor.organizationId,
      tenantId: input.tenantId,
      contractId: input.contractId ?? null,
      entryDate: input.paymentDate,
      entryType: 'payment',
      description: `Payment ${paymentNumber} received`,
      debit: 0,
      credit: round2(input.amount),
      paymentId: payment.id,
      userId: actor.id,
    });

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'allocate',
      entityType: 'payment',
      entityId: payment.id,
      entityLabel: paymentNumber,
      newValue: { amount: input.amount, allocated: allocation.allocated, tenant: tenant.displayName },
      actor: { id: actor.id, fullName: actor.fullName },
    });

    return {
      paymentId: payment.id,
      paymentNumber,
      allocated: allocation.allocated,
      unallocated: allocation.unallocated,
    };
  });
}

/** Appends a ledger entry with a correct running balance (BRD 48). */
async function appendLedgerEntry(
  executor: DbExecutor,
  input: {
    organizationId: string;
    tenantId: string;
    contractId: string | null;
    entryDate: string;
    entryType: string;
    description: string;
    debit: number;
    credit: number;
    invoiceId?: string;
    paymentId?: string;
    userId: string;
  },
): Promise<void> {
  const [last] = await executor
    .select({ balance: tenantLedgerEntries.runningBalance })
    .from(tenantLedgerEntries)
    .where(eq(tenantLedgerEntries.tenantId, input.tenantId))
    .orderBy(desc(tenantLedgerEntries.createdAt))
    .limit(1);

  const previousBalance = Number(last?.balance ?? 0);
  const runningBalance = round2(previousBalance + input.debit - input.credit);

  await executor.insert(tenantLedgerEntries).values({
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    contractId: input.contractId,
    entryDate: input.entryDate,
    entryType: input.entryType,
    description: input.description,
    debitAmount: round2(input.debit),
    creditAmount: round2(input.credit),
    runningBalance,
    invoiceId: input.invoiceId ?? null,
    paymentId: input.paymentId ?? null,
    createdByUserId: input.userId,
  });
}

/** Records a collection workflow action (BRD 47). */
export async function recordCollectionAction(
  actor: SessionUser,
  input: {
    tenantId: string;
    contractId?: string;
    invoiceId?: string;
    actionType: 'reminder' | 'follow_up' | 'escalation' | 'formal_notice' | 'legal_review' | 'payment_plan' | 'resolved';
    outstandingAmount: number;
    daysOverdue: number;
    notes?: string;
    outcome?: string;
    nextActionDate?: string;
  },
): Promise<{ id: string }> {
  const db = await getDb();
  const [action] = await db
    .insert(collectionActions)
    .values({
      organizationId: actor.organizationId,
      tenantId: input.tenantId,
      contractId: input.contractId ?? null,
      invoiceId: input.invoiceId ?? null,
      actionType: input.actionType,
      outstandingAmount: round2(input.outstandingAmount),
      daysOverdue: input.daysOverdue,
      notes: input.notes ?? null,
      outcome: input.outcome ?? null,
      nextActionDate: input.nextActionDate ?? null,
      performedByUserId: actor.id,
    })
    .returning({ id: collectionActions.id });

  await recordAudit(db, {
    organizationId: actor.organizationId,
    action: 'create',
    entityType: 'collection_action',
    entityId: action.id,
    entityLabel: input.actionType,
    newValue: { actionType: input.actionType, outstanding: input.outstandingAmount },
    actor: { id: actor.id, fullName: actor.fullName },
  });

  return { id: action.id };
}

/** Tenant ledger with running balance (BRD 48). */
export async function getTenantLedger(organizationId: string, tenantId: string) {
  const db = await getDb();
  const [tenant] = await db
    .select({ id: tenants.id, displayName: tenants.displayName })
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.organizationId, organizationId)))
    .limit(1);
  if (!tenant) throw notFound('Tenant', tenantId);

  const entries = await db
    .select()
    .from(tenantLedgerEntries)
    .where(eq(tenantLedgerEntries.tenantId, tenantId))
    .orderBy(desc(tenantLedgerEntries.entryDate), desc(tenantLedgerEntries.createdAt))
    .limit(200);

  const [summary] = await db
    .select({
      totalDebit: sql<number>`coalesce(sum(${tenantLedgerEntries.debitAmount}), 0)::float8`,
      totalCredit: sql<number>`coalesce(sum(${tenantLedgerEntries.creditAmount}), 0)::float8`,
    })
    .from(tenantLedgerEntries)
    .where(eq(tenantLedgerEntries.tenantId, tenantId));

  const currentBalance = round2(Number(summary?.totalDebit ?? 0) - Number(summary?.totalCredit ?? 0));

  return { tenant, entries, currentBalance };
}

async function nextSequence(
  executor: DbExecutor,
  table: 'payments',
  organizationId: string,
  prefix: string,
  width: number,
): Promise<string> {
  const [{ total }] = await executor
    .select({ total: count() })
    .from(payments)
    .where(eq(payments.organizationId, organizationId));
  return `${prefix}-${String(Number(total) + 1).padStart(width, '0')}`;
}
