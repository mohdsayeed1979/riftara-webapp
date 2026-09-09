import 'server-only';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  budgetLines,
  budgets,
  expenseCategories,
  operatingExpenses,
  properties,
  units,
  valuations,
  vendors,
} from '@/db/schema';
import type { DbExecutor } from '@/db/types';
import { recordAudit } from '@/lib/audit';
import { conflict, forbidden, notFound, validationError } from '@/lib/errors';
import { getPolicy } from '@/lib/settings';
import { round2 } from '@/lib/utils';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Financial operations data-entry service (BRD 56-59, 72).
 *
 * OPEX and CAPEX are both operating_expenses rows; they are distinguished by
 * their expense category's `includedInOpex` flag. The authoritative metrics
 * service sums only OPEX categories into OPEX/NOI (BR-014, BR-016), so CAPEX
 * never inflates NOI. No second calculation engine is introduced.
 */

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                              */
/* -------------------------------------------------------------------------- */

async function nextExpenseReference(tx: DbExecutor, organizationId: string): Promise<string> {
  // Only consider EXP-###### references (seeded rows may use other prefixes);
  // these are zero-padded so lexical max == numeric max.
  const [{ maxRef }] = await tx
    .select({ maxRef: sql<string | null>`max(${operatingExpenses.reference})` })
    .from(operatingExpenses)
    .where(and(eq(operatingExpenses.organizationId, organizationId), sql`${operatingExpenses.reference} like 'EXP-%'`));
  const current = maxRef && /^EXP-\d+$/.test(maxRef) ? Number(maxRef.replace(/\D/g, '')) : 0;
  return `EXP-${String(current + 1).padStart(6, '0')}`;
}

async function validateExpenseRefs(
  tx: DbExecutor,
  organizationId: string,
  input: { propertyId?: string; unitId?: string | null; categoryId?: string; vendorId?: string | null; expectedPropertyId?: string },
): Promise<{ includedInOpex: boolean } | void> {
  const propertyId = input.propertyId ?? input.expectedPropertyId;
  if (input.propertyId) {
    const [p] = await tx.select({ id: properties.id }).from(properties).where(and(eq(properties.id, input.propertyId), eq(properties.organizationId, organizationId), isNull(properties.deletedAt))).limit(1);
    if (!p) throw validationError('The selected property is not valid for this organization.');
  }
  if (input.unitId) {
    const [u] = await tx.select({ id: units.id, propertyId: units.propertyId }).from(units).where(and(eq(units.id, input.unitId), eq(units.organizationId, organizationId), isNull(units.deletedAt))).limit(1);
    if (!u) throw validationError('The selected unit is not valid for this organization.');
    if (propertyId && u.propertyId !== propertyId) throw validationError('The selected unit does not belong to the selected property.');
  }
  if (input.vendorId) {
    const [v] = await tx.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.id, input.vendorId), eq(vendors.organizationId, organizationId))).limit(1);
    if (!v) throw validationError('The selected vendor is not valid for this organization.');
  }
  if (input.categoryId) {
    const [c] = await tx.select({ id: expenseCategories.id, includedInOpex: expenseCategories.includedInOpex }).from(expenseCategories).where(and(eq(expenseCategories.id, input.categoryId), eq(expenseCategories.organizationId, organizationId))).limit(1);
    if (!c) throw validationError('The selected category is not valid for this organization.');
    return { includedInOpex: c.includedInOpex };
  }
}

/** Spend-approval gate: an expense whose amount is at/above the org spend
 *  threshold may only be recorded by a user holding financials:approve.
 *  (No persisted approval state exists in the schema — same pattern as Phase 6
 *  maintenance spend approval.) */
function enforceSpendApproval(actor: SessionUser, amount: number, threshold: number): void {
  if (amount >= threshold && !actor.permissions.includes('financials:approve')) {
    throw forbidden(
      `This entry is at or above the ${threshold.toLocaleString()} SAR approval threshold and must be recorded by a user with financial approval permission.`,
    );
  }
}

function periodOf(dateIso: string): { year: number; month: number } {
  const d = new Date(dateIso);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/* -------------------------------------------------------------------------- */
/* Expense categories (enables CAPEX classification)                           */
/* -------------------------------------------------------------------------- */

export async function listExpenseCategories(organizationId: string) {
  const db = await getDb();
  return db
    .select({ id: expenseCategories.id, name: expenseCategories.nameEn, includedInOpex: expenseCategories.includedInOpex, isRecoverable: expenseCategories.isRecoverable })
    .from(expenseCategories)
    .where(and(eq(expenseCategories.organizationId, organizationId), eq(expenseCategories.isActive, true)))
    .orderBy(asc(expenseCategories.nameEn));
}

export interface CreateExpenseCategoryInput {
  key: string;
  nameEn: string;
  nameAr?: string;
  includedInOpex: boolean;
  isRecoverable?: boolean;
}

/** Creates an expense category. Setting includedInOpex=false defines a CAPEX /
 *  non-operating category so capital spend is kept out of OPEX/NOI. */
export async function createExpenseCategory(actor: SessionUser, input: CreateExpenseCategoryInput): Promise<{ id: string }> {
  const db = await getDb();
  const [existing] = await db
    .select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(and(eq(expenseCategories.organizationId, actor.organizationId), eq(expenseCategories.key, input.key)))
    .limit(1);
  if (existing) throw conflict('An expense category with this key already exists.');

  const [created] = await db
    .insert(expenseCategories)
    .values({
      organizationId: actor.organizationId,
      key: input.key,
      nameEn: input.nameEn,
      nameAr: input.nameAr ?? null,
      includedInOpex: input.includedInOpex,
      isRecoverable: input.isRecoverable ?? false,
    })
    .returning({ id: expenseCategories.id });

  await recordAudit(db, {
    organizationId: actor.organizationId,
    action: 'create',
    entityType: 'expense_category',
    entityId: created.id,
    entityLabel: input.nameEn,
    newValue: { key: input.key, includedInOpex: input.includedInOpex },
    actor: { id: actor.id, fullName: actor.fullName },
  });
  return { id: created.id };
}

/* -------------------------------------------------------------------------- */
/* Operating expenses (OPEX + CAPEX)                                           */
/* -------------------------------------------------------------------------- */

export interface OperatingExpenseInput {
  categoryId: string;
  propertyId: string;
  unitId?: string;
  vendorId?: string;
  description: string;
  amount: number;
  vatAmount?: number;
  incurredOn: string;
  isRecoverable?: boolean;
  invoiceNumber?: string;
}

export async function createOperatingExpense(actor: SessionUser, input: OperatingExpenseInput): Promise<{ id: string; reference: string }> {
  if (input.amount <= 0) throw validationError('Amount must be greater than zero.');
  const db = await getDb();
  const policy = await getPolicy(actor.organizationId);
  enforceSpendApproval(actor, input.amount, policy.maintenanceSpendApprovalThreshold);

  return db.transaction(async (tx) => {
    await validateExpenseRefs(tx, actor.organizationId, { propertyId: input.propertyId, unitId: input.unitId ?? null, categoryId: input.categoryId, vendorId: input.vendorId ?? null });
    const reference = await nextExpenseReference(tx, actor.organizationId);
    const period = periodOf(input.incurredOn);
    const [created] = await tx
      .insert(operatingExpenses)
      .values({
        organizationId: actor.organizationId,
        reference,
        propertyId: input.propertyId,
        unitId: input.unitId ?? null,
        categoryId: input.categoryId,
        vendorId: input.vendorId ?? null,
        description: input.description,
        amount: round2(input.amount),
        vatAmount: round2(input.vatAmount ?? 0),
        incurredOn: input.incurredOn,
        periodYear: period.year,
        periodMonth: period.month,
        invoiceNumber: input.invoiceNumber ?? null,
        isRecoverable: input.isRecoverable ?? false,
        recordedByUserId: actor.id,
      })
      .returning({ id: operatingExpenses.id });

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'create',
      entityType: 'operating_expense',
      entityId: created.id,
      entityLabel: reference,
      newValue: { amount: input.amount, categoryId: input.categoryId, propertyId: input.propertyId },
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: created.id, reference };
  });
}

export async function updateOperatingExpense(actor: SessionUser, expenseId: string, input: OperatingExpenseInput): Promise<{ id: string }> {
  if (input.amount <= 0) throw validationError('Amount must be greater than zero.');
  const db = await getDb();
  const policy = await getPolicy(actor.organizationId);
  enforceSpendApproval(actor, input.amount, policy.maintenanceSpendApprovalThreshold);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: operatingExpenses.id, reference: operatingExpenses.reference })
      .from(operatingExpenses)
      .where(and(eq(operatingExpenses.id, expenseId), eq(operatingExpenses.organizationId, actor.organizationId), isNull(operatingExpenses.deletedAt)))
      .limit(1);
    if (!existing) throw notFound('Operating expense', expenseId);

    await validateExpenseRefs(tx, actor.organizationId, { propertyId: input.propertyId, unitId: input.unitId ?? null, categoryId: input.categoryId, vendorId: input.vendorId ?? null });
    const period = periodOf(input.incurredOn);
    await tx
      .update(operatingExpenses)
      .set({
        propertyId: input.propertyId,
        unitId: input.unitId ?? null,
        categoryId: input.categoryId,
        vendorId: input.vendorId ?? null,
        description: input.description,
        amount: round2(input.amount),
        vatAmount: round2(input.vatAmount ?? 0),
        incurredOn: input.incurredOn,
        periodYear: period.year,
        periodMonth: period.month,
        invoiceNumber: input.invoiceNumber ?? null,
        isRecoverable: input.isRecoverable ?? false,
        updatedAt: new Date(),
      })
      .where(eq(operatingExpenses.id, expenseId));

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'operating_expense',
      entityId: expenseId,
      entityLabel: existing.reference,
      newValue: { amount: input.amount, categoryId: input.categoryId },
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: expenseId };
  });
}

export async function getOperatingExpenseDetail(organizationId: string, expenseId: string) {
  const db = await getDb();
  const [row] = await db
    .select({
      id: operatingExpenses.id,
      reference: operatingExpenses.reference,
      description: operatingExpenses.description,
      amount: operatingExpenses.amount,
      vatAmount: operatingExpenses.vatAmount,
      incurredOn: operatingExpenses.incurredOn,
      periodYear: operatingExpenses.periodYear,
      periodMonth: operatingExpenses.periodMonth,
      isRecoverable: operatingExpenses.isRecoverable,
      invoiceNumber: operatingExpenses.invoiceNumber,
      categoryId: operatingExpenses.categoryId,
      categoryName: expenseCategories.nameEn,
      includedInOpex: expenseCategories.includedInOpex,
      propertyId: operatingExpenses.propertyId,
      propertyName: properties.nameEn,
      unitId: operatingExpenses.unitId,
      unitNumber: units.unitNumber,
      vendorName: vendors.nameEn,
    })
    .from(operatingExpenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, operatingExpenses.categoryId))
    .innerJoin(properties, eq(properties.id, operatingExpenses.propertyId))
    .leftJoin(units, eq(units.id, operatingExpenses.unitId))
    .leftJoin(vendors, eq(vendors.id, operatingExpenses.vendorId))
    .where(and(eq(operatingExpenses.id, expenseId), eq(operatingExpenses.organizationId, organizationId), isNull(operatingExpenses.deletedAt)))
    .limit(1);
  return row ?? null;
}

/* -------------------------------------------------------------------------- */
/* Valuations (BRD 58-59)                                                      */
/* -------------------------------------------------------------------------- */

export interface ValuationInput {
  propertyId: string;
  valuationDate: string;
  marketValue: number;
  bookValue?: number;
  acquisitionCost?: number;
  landValue?: number;
  buildingValue?: number;
  valuationCompany?: string;
  valuationMethod?: string;
  capRate?: number;
  notes?: string;
}

/** Records a new current valuation. The prior current valuation for the
 *  property is superseded (history preserved), and change vs the previous
 *  market value is computed. Only the newest approved valuation is `isCurrent`,
 *  which is what the metrics service reads for portfolio value. */
export async function createValuation(actor: SessionUser, input: ValuationInput): Promise<{ id: string }> {
  if (input.marketValue <= 0) throw validationError('Market value must be greater than zero.');
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [property] = await tx.select({ id: properties.id }).from(properties).where(and(eq(properties.id, input.propertyId), eq(properties.organizationId, actor.organizationId), isNull(properties.deletedAt))).limit(1);
    if (!property) throw validationError('The selected property is not valid for this organization.');

    const [previous] = await tx
      .select({ id: valuations.id, marketValue: valuations.marketValue })
      .from(valuations)
      .where(and(eq(valuations.propertyId, input.propertyId), eq(valuations.organizationId, actor.organizationId), eq(valuations.isCurrent, true)))
      .orderBy(desc(valuations.valuationDate))
      .limit(1);

    const previousMarketValue = previous ? Number(previous.marketValue) : null;
    const changeAmount = previousMarketValue !== null ? round2(input.marketValue - previousMarketValue) : null;
    const changePercent = previousMarketValue ? round2(((input.marketValue - previousMarketValue) / previousMarketValue) * 100) : null;

    if (previous) {
      await tx.update(valuations).set({ isCurrent: false, status: 'superseded', updatedAt: new Date() }).where(eq(valuations.id, previous.id));
    }

    const [created] = await tx
      .insert(valuations)
      .values({
        organizationId: actor.organizationId,
        propertyId: input.propertyId,
        valuationDate: input.valuationDate,
        marketValue: round2(input.marketValue),
        bookValue: input.bookValue !== undefined ? round2(input.bookValue) : null,
        acquisitionCost: input.acquisitionCost !== undefined ? round2(input.acquisitionCost) : null,
        landValue: input.landValue !== undefined ? round2(input.landValue) : null,
        buildingValue: input.buildingValue !== undefined ? round2(input.buildingValue) : null,
        previousMarketValue,
        changeAmount,
        changePercent,
        valuationCompany: input.valuationCompany ?? null,
        valuationMethod: input.valuationMethod ?? null,
        capRate: input.capRate ?? null,
        status: 'approved',
        isCurrent: true,
        notes: input.notes ?? null,
        approvedByUserId: actor.id,
      })
      .returning({ id: valuations.id });

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'create',
      entityType: 'valuation',
      entityId: created.id,
      entityLabel: `${input.marketValue}`,
      newValue: { propertyId: input.propertyId, marketValue: input.marketValue },
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: created.id };
  });
}

/* -------------------------------------------------------------------------- */
/* Budgets & budget lines (BRD 72)                                             */
/* -------------------------------------------------------------------------- */

export interface BudgetInput {
  name: string;
  fiscalYear: number;
  propertyId?: string;
  status?: string;
  notes?: string;
}

export async function createBudget(actor: SessionUser, input: BudgetInput): Promise<{ id: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    if (input.propertyId) {
      const [p] = await tx.select({ id: properties.id }).from(properties).where(and(eq(properties.id, input.propertyId), eq(properties.organizationId, actor.organizationId), isNull(properties.deletedAt))).limit(1);
      if (!p) throw validationError('The selected property is not valid for this organization.');
    }
    const [created] = await tx
      .insert(budgets)
      .values({
        organizationId: actor.organizationId,
        name: input.name,
        fiscalYear: input.fiscalYear,
        propertyId: input.propertyId ?? null,
        status: input.status ?? 'draft',
        notes: input.notes ?? null,
      })
      .returning({ id: budgets.id });

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'create',
      entityType: 'budget',
      entityId: created.id,
      entityLabel: input.name,
      newValue: { fiscalYear: input.fiscalYear },
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: created.id };
  });
}

export interface BudgetLineInput {
  budgetId: string;
  lineType: string;
  periodMonth: number;
  categoryId?: string;
  budgetAmount: number;
  notes?: string;
}

/** Creates or updates (by the unique budget/lineType/month/category key) a
 *  budget line, keeping budget-vs-actual totals consistent. */
export async function upsertBudgetLine(actor: SessionUser, input: BudgetLineInput): Promise<{ id: string; created: boolean }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [budget] = await tx.select({ id: budgets.id, name: budgets.name }).from(budgets).where(and(eq(budgets.id, input.budgetId), eq(budgets.organizationId, actor.organizationId))).limit(1);
    if (!budget) throw notFound('Budget', input.budgetId);

    const [existing] = await tx
      .select({ id: budgetLines.id })
      .from(budgetLines)
      .where(and(
        eq(budgetLines.budgetId, input.budgetId),
        eq(budgetLines.lineType, input.lineType),
        eq(budgetLines.periodMonth, input.periodMonth),
        input.categoryId ? eq(budgetLines.categoryId, input.categoryId) : isNull(budgetLines.categoryId),
      ))
      .limit(1);

    let id: string;
    let created: boolean;
    if (existing) {
      await tx.update(budgetLines).set({ budgetAmount: round2(input.budgetAmount), notes: input.notes ?? null, updatedAt: new Date() }).where(eq(budgetLines.id, existing.id));
      id = existing.id;
      created = false;
    } else {
      const [row] = await tx
        .insert(budgetLines)
        .values({ budgetId: input.budgetId, lineType: input.lineType, periodMonth: input.periodMonth, categoryId: input.categoryId ?? null, budgetAmount: round2(input.budgetAmount), notes: input.notes ?? null })
        .returning({ id: budgetLines.id });
      id = row.id;
      created = true;
    }

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: created ? 'create' : 'update',
      entityType: 'budget_line',
      entityId: id,
      entityLabel: `${budget.name} · ${input.lineType}`,
      newValue: { lineType: input.lineType, periodMonth: input.periodMonth, budgetAmount: input.budgetAmount },
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id, created };
  });
}

export async function getBudgetDetail(organizationId: string, budgetId: string) {
  const db = await getDb();
  const [budget] = await db
    .select({ id: budgets.id, name: budgets.name, fiscalYear: budgets.fiscalYear, propertyId: budgets.propertyId, status: budgets.status, notes: budgets.notes })
    .from(budgets)
    .where(and(eq(budgets.id, budgetId), eq(budgets.organizationId, organizationId)))
    .limit(1);
  if (!budget) return null;
  const lines = await db
    .select({ id: budgetLines.id, lineType: budgetLines.lineType, periodMonth: budgetLines.periodMonth, categoryId: budgetLines.categoryId, budgetAmount: budgetLines.budgetAmount })
    .from(budgetLines)
    .where(eq(budgetLines.budgetId, budgetId))
    .orderBy(asc(budgetLines.periodMonth));
  return { budget, lines: lines.map((l) => ({ ...l, budgetAmount: round2(Number(l.budgetAmount)) })) };
}

export async function listBudgets(organizationId: string) {
  const db = await getDb();
  return db
    .select({
      id: budgets.id,
      name: budgets.name,
      fiscalYear: budgets.fiscalYear,
      status: budgets.status,
      total: sql<number>`coalesce((select sum(${budgetLines.budgetAmount}) from ${budgetLines} where ${budgetLines.budgetId} = ${budgets.id}), 0)::float8`,
    })
    .from(budgets)
    .where(eq(budgets.organizationId, organizationId))
    .orderBy(desc(budgets.fiscalYear), asc(budgets.name));
}

/* -------------------------------------------------------------------------- */
/* Form reference data                                                         */
/* -------------------------------------------------------------------------- */

export async function getFinancialFormReferenceData(organizationId: string) {
  const db = await getDb();
  const [propertyRows, unitRows, categoryRows, vendorRows] = await Promise.all([
    db.select({ id: properties.id, name: properties.nameEn }).from(properties).where(and(eq(properties.organizationId, organizationId), isNull(properties.deletedAt))).orderBy(asc(properties.nameEn)),
    db.select({ id: units.id, unitNumber: units.unitNumber, propertyId: units.propertyId }).from(units).where(and(eq(units.organizationId, organizationId), isNull(units.deletedAt))).orderBy(asc(units.unitNumber)),
    db.select({ id: expenseCategories.id, name: expenseCategories.nameEn, includedInOpex: expenseCategories.includedInOpex }).from(expenseCategories).where(and(eq(expenseCategories.organizationId, organizationId), eq(expenseCategories.isActive, true))).orderBy(asc(expenseCategories.nameEn)),
    db.select({ id: vendors.id, name: vendors.nameEn }).from(vendors).where(and(eq(vendors.organizationId, organizationId), eq(vendors.isActive, true))).orderBy(asc(vendors.nameEn)),
  ]);
  return { properties: propertyRows, units: unitRows, categories: categoryRows, vendors: vendorRows };
}
