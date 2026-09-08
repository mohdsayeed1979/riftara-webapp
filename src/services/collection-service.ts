import 'server-only';
import { and, asc, count, desc, eq, ilike, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  collectionActions,
  contracts,
  customers,
  invoices,
  notifications,
  paymentAllocations,
  paymentSchedules,
  payments,
  properties,
  tenantLedgerEntries,
  tenants,
  units,
  users,
} from '@/db/schema';
import type { DbExecutor } from '@/db/types';
import { recordAudit } from '@/lib/audit';
import { conflict, notFound, validationError } from '@/lib/errors';
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

async function nextInvoiceNumber(executor: DbExecutor, organizationId: string): Promise<string> {
  const [{ total }] = await executor
    .select({ total: count() })
    .from(invoices)
    .where(eq(invoices.organizationId, organizationId));
  return `INV-${String(Number(total) + 1).padStart(6, '0')}`;
}

/* -------------------------------------------------------------------------- */
/* Invoice detail (BRD 45)                                                     */
/* -------------------------------------------------------------------------- */

/** Full invoice view with tenant/customer, property/unit, contract, payment
 *  allocations and the collection-action history. Read-only; all financial
 *  figures come from the stored authoritative columns (no re-computation). */
export async function getInvoiceDetail(organizationId: string, invoiceId: string) {
  const db = await getDb();
  const [row] = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      invoiceDate: invoices.invoiceDate,
      dueDate: invoices.dueDate,
      periodStart: invoices.periodStart,
      periodEnd: invoices.periodEnd,
      rentAmount: invoices.rentAmount,
      serviceChargeAmount: invoices.serviceChargeAmount,
      vatAmount: invoices.vatAmount,
      otherChargesAmount: invoices.otherChargesAmount,
      totalAmount: invoices.totalAmount,
      paidAmount: invoices.paidAmount,
      balanceAmount: invoices.balanceAmount,
      notes: invoices.notes,
      tenantId: invoices.tenantId,
      tenantName: tenants.displayName,
      customerId: tenants.customerId,
      customerName: customers.fullNameEn,
      propertyId: invoices.propertyId,
      propertyName: properties.nameEn,
      unitId: invoices.unitId,
      unitNumber: units.unitNumber,
      contractId: invoices.contractId,
      contractNumber: contracts.contractNumber,
    })
    .from(invoices)
    .innerJoin(tenants, eq(tenants.id, invoices.tenantId))
    .innerJoin(customers, eq(customers.id, tenants.customerId))
    .innerJoin(properties, eq(properties.id, invoices.propertyId))
    .innerJoin(units, eq(units.id, invoices.unitId))
    .innerJoin(contracts, eq(contracts.id, invoices.contractId))
    .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, organizationId), isNull(invoices.deletedAt)))
    .limit(1);
  if (!row) return null;

  const allocations = await db
    .select({
      id: paymentAllocations.id,
      amount: paymentAllocations.amount,
      allocationMethod: paymentAllocations.allocationMethod,
      reversedAt: paymentAllocations.reversedAt,
      createdAt: paymentAllocations.createdAt,
      paymentId: payments.id,
      paymentNumber: payments.paymentNumber,
      paymentDate: payments.paymentDate,
      method: payments.method,
      referenceNumber: payments.referenceNumber,
    })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .where(eq(paymentAllocations.invoiceId, invoiceId))
    .orderBy(desc(payments.paymentDate));

  const actions = await db
    .select({
      id: collectionActions.id,
      actionType: collectionActions.actionType,
      daysOverdue: collectionActions.daysOverdue,
      outstandingAmount: collectionActions.outstandingAmount,
      notes: collectionActions.notes,
      outcome: collectionActions.outcome,
      createdAt: collectionActions.createdAt,
      performedBy: users.fullName,
    })
    .from(collectionActions)
    .leftJoin(users, eq(users.id, collectionActions.performedByUserId))
    .where(and(eq(collectionActions.invoiceId, invoiceId), eq(collectionActions.organizationId, organizationId)))
    .orderBy(desc(collectionActions.createdAt));

  const now = new Date();
  return {
    invoice: {
      ...row,
      totalAmount: round2(Number(row.totalAmount)),
      paidAmount: round2(Number(row.paidAmount)),
      balanceAmount: round2(Number(row.balanceAmount)),
      rentAmount: round2(Number(row.rentAmount)),
      serviceChargeAmount: round2(Number(row.serviceChargeAmount)),
      vatAmount: round2(Number(row.vatAmount)),
      otherChargesAmount: round2(Number(row.otherChargesAmount)),
      daysOverdue: daysOverdue(new Date(row.dueDate), now),
    },
    allocations: allocations.map((a) => ({ ...a, amount: round2(Number(a.amount)) })),
    actions: actions.map((a) => ({ ...a, outstandingAmount: round2(Number(a.outstandingAmount)) })),
  };
}

/* -------------------------------------------------------------------------- */
/* Invoice generation from authoritative payment schedules (BRD 44)            */
/* -------------------------------------------------------------------------- */

export interface PendingScheduleRow {
  scheduleId: string;
  contractId: string;
  contractNumber: string;
  tenantName: string;
  propertyName: string;
  unitNumber: string;
  installmentNumber: number;
  invoiceDate: string;
  dueDate: string;
  totalAmount: number;
}

/** Payment-schedule installments that have not yet been turned into invoices. */
export async function listPendingSchedules(
  organizationId: string,
  opts: { allowedPropertyIds?: string[] | null; onlyDue?: boolean; limit?: number } = {},
): Promise<PendingScheduleRow[]> {
  const db = await getDb();
  const conditions: SQL[] = [
    eq(paymentSchedules.organizationId, organizationId),
    isNull(paymentSchedules.invoiceId),
    inArray(contracts.status, ['signed', 'active']),
  ];
  if (opts.allowedPropertyIds?.length) conditions.push(inArray(contracts.propertyId, opts.allowedPropertyIds));
  if (opts.onlyDue) conditions.push(sql`${paymentSchedules.invoiceDate} <= now()`);

  const rows = await db
    .select({
      scheduleId: paymentSchedules.id,
      contractId: paymentSchedules.contractId,
      contractNumber: contracts.contractNumber,
      tenantName: tenants.displayName,
      propertyName: properties.nameEn,
      unitNumber: units.unitNumber,
      installmentNumber: paymentSchedules.installmentNumber,
      invoiceDate: paymentSchedules.invoiceDate,
      dueDate: paymentSchedules.dueDate,
      totalAmount: paymentSchedules.totalAmount,
    })
    .from(paymentSchedules)
    .innerJoin(contracts, eq(contracts.id, paymentSchedules.contractId))
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .innerJoin(properties, eq(properties.id, contracts.propertyId))
    .innerJoin(units, eq(units.id, contracts.unitId))
    .where(and(...conditions))
    .orderBy(asc(paymentSchedules.invoiceDate))
    .limit(opts.limit ?? 100);

  return rows.map((r) => ({ ...r, totalAmount: round2(Number(r.totalAmount)) }));
}

/** Generates one invoice from a payment-schedule installment. Amounts are taken
 *  from the authoritative schedule row — never from client input. Idempotent:
 *  a schedule already linked to an invoice returns that invoice unchanged
 *  (duplicate prevention, BR-013). */
export async function generateInvoiceFromSchedule(
  actor: SessionUser,
  scheduleId: string,
): Promise<{ invoiceId: string; invoiceNumber: string; alreadyExisted: boolean }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [sch] = await tx
      .select({
        id: paymentSchedules.id,
        contractId: paymentSchedules.contractId,
        invoiceId: paymentSchedules.invoiceId,
        installmentNumber: paymentSchedules.installmentNumber,
        periodStart: paymentSchedules.periodStart,
        periodEnd: paymentSchedules.periodEnd,
        invoiceDate: paymentSchedules.invoiceDate,
        dueDate: paymentSchedules.dueDate,
        rentAmount: paymentSchedules.rentAmount,
        serviceChargeAmount: paymentSchedules.serviceChargeAmount,
        vatAmount: paymentSchedules.vatAmount,
        totalAmount: paymentSchedules.totalAmount,
        contractStatus: contracts.status,
        tenantId: contracts.tenantId,
        propertyId: contracts.propertyId,
        unitId: contracts.unitId,
      })
      .from(paymentSchedules)
      .innerJoin(contracts, eq(contracts.id, paymentSchedules.contractId))
      .where(and(eq(paymentSchedules.id, scheduleId), eq(paymentSchedules.organizationId, actor.organizationId)))
      .limit(1);
    if (!sch) throw notFound('Payment schedule', scheduleId);

    if (sch.invoiceId) {
      const [existing] = await tx
        .select({ number: invoices.invoiceNumber })
        .from(invoices)
        .where(eq(invoices.id, sch.invoiceId))
        .limit(1);
      return { invoiceId: sch.invoiceId, invoiceNumber: existing?.number ?? '', alreadyExisted: true };
    }

    if (sch.contractStatus !== 'signed' && sch.contractStatus !== 'active') {
      throw conflict('Invoices can only be generated for signed or active contracts.');
    }

    const invoiceNumber = await nextInvoiceNumber(tx, actor.organizationId);
    const total = round2(Number(sch.totalAmount));
    const status = deriveInvoiceStatus({
      totalAmount: total,
      paidAmount: 0,
      dueDate: new Date(sch.dueDate),
      invoiceDate: new Date(sch.invoiceDate),
    });

    const [created] = await tx
      .insert(invoices)
      .values({
        organizationId: actor.organizationId,
        invoiceNumber,
        contractId: sch.contractId,
        scheduleId: sch.id,
        tenantId: sch.tenantId,
        propertyId: sch.propertyId,
        unitId: sch.unitId,
        invoiceDate: sch.invoiceDate,
        dueDate: sch.dueDate,
        periodStart: sch.periodStart,
        periodEnd: sch.periodEnd,
        rentAmount: round2(Number(sch.rentAmount)),
        serviceChargeAmount: round2(Number(sch.serviceChargeAmount)),
        vatAmount: round2(Number(sch.vatAmount)),
        otherChargesAmount: 0,
        totalAmount: total,
        paidAmount: 0,
        balanceAmount: total,
        status,
      })
      .returning({ id: invoices.id });

    await tx
      .update(paymentSchedules)
      .set({ invoiceId: created.id, updatedAt: new Date() })
      .where(eq(paymentSchedules.id, sch.id));

    await appendLedgerEntry(tx, {
      organizationId: actor.organizationId,
      tenantId: sch.tenantId,
      contractId: sch.contractId,
      entryDate: sch.invoiceDate,
      entryType: 'invoice',
      description: `Invoice ${invoiceNumber} — installment ${sch.installmentNumber}`,
      debit: total,
      credit: 0,
      invoiceId: created.id,
      userId: actor.id,
    });

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'create',
      entityType: 'invoice',
      entityId: created.id,
      entityLabel: invoiceNumber,
      newValue: { scheduleId: sch.id, contractId: sch.contractId, total },
      actor: { id: actor.id, fullName: actor.fullName },
    });

    return { invoiceId: created.id, invoiceNumber, alreadyExisted: false };
  });
}

/** Bulk-generates invoices for every due, un-invoiced installment in scope.
 *  Each installment is generated in its own transaction and is idempotent. */
export async function generateDueInvoices(
  actor: SessionUser,
  opts: { allowedPropertyIds?: string[] | null } = {},
): Promise<{ generated: number; invoiceNumbers: string[] }> {
  const pending = await listPendingSchedules(actor.organizationId, {
    allowedPropertyIds: opts.allowedPropertyIds,
    onlyDue: true,
    limit: 500,
  });
  const invoiceNumbers: string[] = [];
  for (const row of pending) {
    const result = await generateInvoiceFromSchedule(actor, row.scheduleId);
    if (!result.alreadyExisted) invoiceNumbers.push(result.invoiceNumber);
  }
  return { generated: invoiceNumbers.length, invoiceNumbers };
}

/* -------------------------------------------------------------------------- */
/* Dunning queue + collection-action history (BRD 47)                          */
/* -------------------------------------------------------------------------- */

export interface DunningRow {
  tenantId: string;
  tenantName: string;
  outstanding: number;
  overdue: number;
  maxDaysOverdue: number;
  invoiceCount: number;
  recommendedAction: string | null;
  lastActionType: string | null;
  lastActionAt: string | null;
}

/** Tenants with overdue balances plus the recommended next collection action
 *  derived from the configurable escalation ladder (policy). */
export async function getDunningQueue(
  organizationId: string,
  allowedPropertyIds: string[] | null,
): Promise<DunningRow[]> {
  const db = await getDb();
  const policy = await getPolicy(organizationId);
  const ladder = [...policy.collectionEscalationLadder].sort((a, b) => a.daysOverdue - b.daysOverdue);

  const conditions: SQL[] = [
    eq(invoices.organizationId, organizationId),
    eq(invoices.status, 'overdue'),
    isNull(invoices.deletedAt),
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
    .orderBy(desc(sql`sum(${invoices.balanceAmount})`));

  const now = new Date();
  const result: DunningRow[] = [];
  for (const row of rows) {
    const maxDaysOverdue = daysOverdue(new Date(row.minDue), now);
    const step = [...ladder].reverse().find((s) => maxDaysOverdue >= s.daysOverdue);
    const [last] = await db
      .select({ actionType: collectionActions.actionType, createdAt: collectionActions.createdAt })
      .from(collectionActions)
      .where(and(eq(collectionActions.organizationId, organizationId), eq(collectionActions.tenantId, row.tenantId)))
      .orderBy(desc(collectionActions.createdAt))
      .limit(1);
    result.push({
      tenantId: row.tenantId,
      tenantName: row.tenantName,
      outstanding: round2(Number(row.outstanding)),
      overdue: round2(Number(row.outstanding)),
      maxDaysOverdue,
      invoiceCount: Number(row.invoiceCount),
      recommendedAction: step?.action ?? null,
      lastActionType: last?.actionType ?? null,
      lastActionAt: last ? last.createdAt.toISOString() : null,
    });
  }
  return result;
}

/** Collection-action history for a tenant (most recent first). */
export async function listCollectionActions(organizationId: string, tenantId: string) {
  const db = await getDb();
  return db
    .select({
      id: collectionActions.id,
      actionType: collectionActions.actionType,
      daysOverdue: collectionActions.daysOverdue,
      outstandingAmount: collectionActions.outstandingAmount,
      notes: collectionActions.notes,
      outcome: collectionActions.outcome,
      nextActionDate: collectionActions.nextActionDate,
      createdAt: collectionActions.createdAt,
      performedBy: users.fullName,
    })
    .from(collectionActions)
    .leftJoin(users, eq(users.id, collectionActions.performedByUserId))
    .where(and(eq(collectionActions.organizationId, organizationId), eq(collectionActions.tenantId, tenantId)))
    .orderBy(desc(collectionActions.createdAt))
    .limit(100);
}

/* -------------------------------------------------------------------------- */
/* Receivables rollups (BR-015)                                                */
/* -------------------------------------------------------------------------- */

export interface TenantReceivables {
  totalInvoiced: number;
  totalPaid: number;
  outstanding: number;
  overdue: number;
  openInvoiceCount: number;
}

/** Per-tenant receivables totals from the authoritative invoice columns. */
export async function getTenantReceivables(organizationId: string, tenantId: string): Promise<TenantReceivables> {
  const db = await getDb();
  const rows = await db
    .select({
      status: invoices.status,
      total: invoices.totalAmount,
      paid: invoices.paidAmount,
      balance: invoices.balanceAmount,
    })
    .from(invoices)
    .where(and(eq(invoices.organizationId, organizationId), eq(invoices.tenantId, tenantId), isNull(invoices.deletedAt)));

  let totalInvoiced = 0;
  let totalPaid = 0;
  let outstanding = 0;
  let overdue = 0;
  let openInvoiceCount = 0;
  for (const row of rows) {
    if (row.status === 'cancelled' || row.status === 'waived') continue;
    totalInvoiced += Number(row.total);
    totalPaid += Number(row.paid);
    outstanding += Number(row.balance);
    if (Number(row.balance) > 0) openInvoiceCount += 1;
    if (row.status === 'overdue') overdue += Number(row.balance);
  }
  return {
    totalInvoiced: round2(totalInvoiced),
    totalPaid: round2(totalPaid),
    outstanding: round2(outstanding),
    overdue: round2(overdue),
    openInvoiceCount,
  };
}

/* -------------------------------------------------------------------------- */
/* Statement rows (for CSV export)                                             */
/* -------------------------------------------------------------------------- */

export interface StatementRow {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  charges: number;
  paid: number;
  outstanding: number;
  status: string;
}

/** Every invoice for a tenant, for a statement of account export. */
export async function getTenantStatementRows(organizationId: string, tenantId: string): Promise<{ tenantName: string; rows: StatementRow[] }> {
  const db = await getDb();
  const [tenant] = await db
    .select({ displayName: tenants.displayName })
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.organizationId, organizationId)))
    .limit(1);
  if (!tenant) throw notFound('Tenant', tenantId);

  const rows = await db
    .select({
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      dueDate: invoices.dueDate,
      charges: invoices.totalAmount,
      paid: invoices.paidAmount,
      outstanding: invoices.balanceAmount,
      status: invoices.status,
    })
    .from(invoices)
    .where(and(eq(invoices.organizationId, organizationId), eq(invoices.tenantId, tenantId), isNull(invoices.deletedAt)))
    .orderBy(asc(invoices.invoiceDate));

  return {
    tenantName: tenant.displayName,
    rows: rows.map((r) => ({
      invoiceNumber: r.invoiceNumber,
      invoiceDate: r.invoiceDate,
      dueDate: r.dueDate,
      charges: round2(Number(r.charges)),
      paid: round2(Number(r.paid)),
      outstanding: round2(Number(r.outstanding)),
      status: r.status,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Runtime overdue notification generation (BRD 46; idempotent)                */
/* -------------------------------------------------------------------------- */

/** Scans open invoices whose due date has passed, flips them to `overdue`
 *  (audited), and creates a single `payment_overdue` notification per invoice.
 *
 *  Idempotent: an invoice that already has a `payment_overdue` notification is
 *  never notified again, and an already-overdue invoice is not re-flipped. Safe
 *  to invoke repeatedly (e.g. from a scheduled job) without creating duplicates.
 *  This function performs no unbounded work at request time — it is capped and
 *  intended to be driven by a scheduler, never by page loads. */
export async function generateOverdueNotifications(
  actor: { id: string | null; organizationId: string; fullName: string },
): Promise<{ scanned: number; markedOverdue: number; notificationsCreated: number }> {
  const db = await getDb();
  const organizationId = actor.organizationId;

  const candidates = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      dueDate: invoices.dueDate,
      balance: invoices.balanceAmount,
      tenantId: invoices.tenantId,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        inArray(invoices.status, ['due', 'partially_paid', 'overdue']),
        isNull(invoices.deletedAt),
        sql`${invoices.balanceAmount} > 0`,
        sql`${invoices.dueDate} < now()`,
      ),
    )
    .limit(500);

  const now = new Date();
  let markedOverdue = 0;
  let notificationsCreated = 0;

  for (const inv of candidates) {
    const overdueDays = daysOverdue(new Date(inv.dueDate), now);

    if (inv.status !== 'overdue') {
      await db.transaction(async (tx) => {
        await tx.update(invoices).set({ status: 'overdue', updatedAt: new Date() }).where(eq(invoices.id, inv.id));
        await recordAudit(tx, {
          organizationId,
          action: 'update',
          entityType: 'invoice',
          entityId: inv.id,
          entityLabel: inv.invoiceNumber,
          previousValue: { status: inv.status },
          newValue: { status: 'overdue', daysOverdue: overdueDays },
          actor: actor.id ? { id: actor.id, fullName: actor.fullName } : undefined,
        });
      });
      markedOverdue += 1;
    }

    // Idempotency guard: one payment_overdue notification per invoice, ever.
    const [existing] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.organizationId, organizationId),
          eq(notifications.notificationType, 'payment_overdue'),
          eq(notifications.entityType, 'invoice'),
          eq(notifications.entityId, inv.id),
        ),
      )
      .limit(1);
    if (existing) continue;

    const balance = round2(Number(inv.balance));
    await db.insert(notifications).values({
      organizationId,
      userId: null,
      requiredPermission: 'collections:view',
      notificationType: 'payment_overdue',
      severity: overdueDays > 60 || balance > 100_000 ? 'error' : 'warning',
      title: `Invoice ${inv.invoiceNumber} is overdue`,
      body: `${balance.toLocaleString()} SAR outstanding, ${overdueDays} day(s) past due.`,
      linkHref: `/collections/invoices/${inv.id}`,
      entityType: 'invoice',
      entityId: inv.id,
    });
    notificationsCreated += 1;
  }

  return { scanned: candidates.length, markedOverdue, notificationsCreated };
}
