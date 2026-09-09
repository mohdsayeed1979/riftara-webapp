'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/guard';
import { actionFailure, actionSuccess, type ActionResult } from '@/lib/errors';
import { isUuid } from '@/lib/utils';
import {
  createBudget,
  createExpenseCategory,
  createOperatingExpense,
  createValuation,
  updateOperatingExpense,
  upsertBudgetLine,
} from '@/services/financial-service';

function opt(v: FormDataEntryValue | null): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}
const optUuid = z.string().uuid('Select a valid option.').optional();

function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const fe: Record<string, string[]> = {};
  for (const issue of error.issues) (fe[String(issue.path[0] ?? '_form')] ??= []).push(issue.message);
  return fe;
}
function invalid<T>(error: z.ZodError): ActionResult<T> {
  return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(error) };
}

/* -------------------------------- Expenses -------------------------------- */

const expenseSchema = z.object({
  categoryId: z.string().uuid('Select a category.'),
  propertyId: z.string().uuid('Select a property.'),
  unitId: optUuid,
  vendorId: optUuid,
  description: z.string().trim().min(1, 'Enter a description.').max(240),
  amount: z.coerce.number().positive('Amount must be greater than zero.'),
  vatAmount: z.coerce.number().nonnegative().optional(),
  incurredOn: z.string().min(1, 'Select a date.'),
  isRecoverable: z.coerce.boolean().optional(),
  invoiceNumber: z.string().trim().max(60).optional(),
});

function readExpense(formData: FormData) {
  return {
    categoryId: opt(formData.get('categoryId')),
    propertyId: opt(formData.get('propertyId')),
    unitId: opt(formData.get('unitId')),
    vendorId: opt(formData.get('vendorId')),
    description: opt(formData.get('description')),
    amount: opt(formData.get('amount')),
    vatAmount: opt(formData.get('vatAmount')),
    incurredOn: opt(formData.get('incurredOn')),
    isRecoverable: formData.get('isRecoverable') === 'on' || formData.get('isRecoverable') === 'true',
    invoiceNumber: opt(formData.get('invoiceNumber')),
  };
}

export interface ExpenseActionResult {
  id: string;
  reference?: string;
}

export async function createOperatingExpenseAction(
  _prev: ActionResult<ExpenseActionResult> | null,
  formData: FormData,
): Promise<ActionResult<ExpenseActionResult>> {
  try {
    const user = await requirePermission('financials:create');
    const parsed = expenseSchema.safeParse(readExpense(formData));
    if (!parsed.success) return invalid(parsed.error);
    const result = await createOperatingExpense(user, parsed.data);
    try { revalidatePath('/financials/expenses'); revalidatePath('/financials'); revalidatePath('/dashboard'); } catch { /* cache hint */ }
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateOperatingExpenseAction(
  expenseId: string,
  _prev: ActionResult<ExpenseActionResult> | null,
  formData: FormData,
): Promise<ActionResult<ExpenseActionResult>> {
  try {
    if (!isUuid(expenseId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Expense not found.' } };
    const user = await requirePermission('financials:edit');
    const parsed = expenseSchema.safeParse(readExpense(formData));
    if (!parsed.success) return invalid(parsed.error);
    const result = await updateOperatingExpense(user, expenseId, parsed.data);
    try { revalidatePath('/financials/expenses'); revalidatePath('/financials'); revalidatePath('/dashboard'); } catch { /* cache hint */ }
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

/* --------------------------- Expense categories --------------------------- */

const categorySchema = z.object({
  key: z.string().trim().min(2, 'Enter a key.').max(64).regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers and underscores.'),
  nameEn: z.string().trim().min(1, 'Enter an English name.').max(120),
  nameAr: z.string().trim().max(120).optional(),
  includedInOpex: z.boolean(),
  isRecoverable: z.boolean().optional(),
});

export async function createExpenseCategoryAction(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission('financials:edit');
    const parsed = categorySchema.safeParse({
      key: opt(formData.get('key')),
      nameEn: opt(formData.get('nameEn')),
      nameAr: opt(formData.get('nameAr')),
      includedInOpex: formData.get('includedInOpex') === 'on' || formData.get('includedInOpex') === 'true',
      isRecoverable: formData.get('isRecoverable') === 'on' || formData.get('isRecoverable') === 'true',
    });
    if (!parsed.success) return invalid(parsed.error);
    const result = await createExpenseCategory(user, parsed.data);
    try { revalidatePath('/financials/expenses'); } catch { /* cache hint */ }
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

/* ------------------------------- Valuations ------------------------------- */

const valuationSchema = z.object({
  propertyId: z.string().uuid('Select a property.'),
  valuationDate: z.string().min(1, 'Select a date.'),
  marketValue: z.coerce.number().positive('Market value must be greater than zero.'),
  bookValue: z.coerce.number().nonnegative().optional(),
  acquisitionCost: z.coerce.number().nonnegative().optional(),
  valuationCompany: z.string().trim().max(160).optional(),
  valuationMethod: z.string().trim().max(32).optional(),
  capRate: z.coerce.number().min(0).max(100).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function createValuationAction(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission('financials:create');
    const parsed = valuationSchema.safeParse({
      propertyId: opt(formData.get('propertyId')),
      valuationDate: opt(formData.get('valuationDate')),
      marketValue: opt(formData.get('marketValue')),
      bookValue: opt(formData.get('bookValue')),
      acquisitionCost: opt(formData.get('acquisitionCost')),
      valuationCompany: opt(formData.get('valuationCompany')),
      valuationMethod: opt(formData.get('valuationMethod')),
      capRate: opt(formData.get('capRate')),
      notes: opt(formData.get('notes')),
    });
    if (!parsed.success) return invalid(parsed.error);
    const result = await createValuation(user, parsed.data);
    try { revalidatePath('/financials/valuations'); revalidatePath('/financials'); revalidatePath('/dashboard'); } catch { /* cache hint */ }
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

/* -------------------------------- Budgets --------------------------------- */

const budgetSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(160),
  fiscalYear: z.coerce.number().int().min(2000).max(2100),
  propertyId: optUuid,
  status: z.enum(['draft', 'approved', 'closed']).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function createBudgetAction(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission('financials:create');
    const parsed = budgetSchema.safeParse({
      name: opt(formData.get('name')),
      fiscalYear: opt(formData.get('fiscalYear')),
      propertyId: opt(formData.get('propertyId')),
      status: opt(formData.get('status')),
      notes: opt(formData.get('notes')),
    });
    if (!parsed.success) return invalid(parsed.error);
    const result = await createBudget(user, parsed.data);
    try { revalidatePath('/financials/budgets'); } catch { /* cache hint */ }
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

const budgetLineSchema = z.object({
  budgetId: z.string().uuid('Select a budget.'),
  lineType: z.enum(['revenue', 'collection', 'opex', 'maintenance', 'noi']),
  periodMonth: z.coerce.number().int().min(1).max(12),
  categoryId: optUuid,
  budgetAmount: z.coerce.number().nonnegative('Enter a non-negative amount.'),
  notes: z.string().trim().max(2000).optional(),
});

export async function upsertBudgetLineAction(
  _prev: ActionResult<{ id: string; created: boolean }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; created: boolean }>> {
  try {
    const user = await requirePermission('financials:edit');
    const parsed = budgetLineSchema.safeParse({
      budgetId: opt(formData.get('budgetId')),
      lineType: opt(formData.get('lineType')),
      periodMonth: opt(formData.get('periodMonth')),
      categoryId: opt(formData.get('categoryId')),
      budgetAmount: opt(formData.get('budgetAmount')),
      notes: opt(formData.get('notes')),
    });
    if (!parsed.success) return invalid(parsed.error);
    const result = await upsertBudgetLine(user, parsed.data);
    try { revalidatePath('/financials/budgets'); } catch { /* cache hint */ }
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}
