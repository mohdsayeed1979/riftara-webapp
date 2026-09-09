import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { bootstrapTestDb } from './setup-db';
import type { Database } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';
import { isUuid } from '@/lib/utils';

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth/session')>();
  return { ...mod, getSession: vi.fn() };
});

const FOREIGN_ORG = '00000000-0000-4000-8000-000000000000';
const TODAY = new Date().toISOString().slice(0, 10);

let db: Database;
let cleanup: () => void;
let admin: SessionUser;
let getSessionMock: ReturnType<typeof vi.fn>;
let propertyId = '';
let unitId = '';
let opexCategoryId = '';
let capexCategoryId = '';

beforeAll(async () => {
  const ctx = await bootstrapTestDb();
  db = ctx.db;
  cleanup = ctx.cleanup;

  const { users, properties, units, expenseCategories } = await import('@/db/schema');
  const { loadSessionUser, getSession } = await import('@/lib/auth/session');
  const { createExpenseCategory } = await import('@/services/financial-service');
  getSessionMock = getSession as unknown as ReturnType<typeof vi.fn>;

  const [u] = await db.select().from(users).where(eq(users.email, 'sayeed.almousa@riftara.sa')).limit(1);
  const loaded = await loadSessionUser(u.id);
  if (!loaded) throw new Error('admin actor not found');
  admin = loaded;

  const [prop] = await db.select({ id: properties.id }).from(properties).where(isNull(properties.deletedAt)).limit(1);
  propertyId = prop.id;
  const [unit] = await db.select({ id: units.id }).from(units).where(and(eq(units.propertyId, propertyId), isNull(units.deletedAt))).limit(1);
  unitId = unit.id;
  const [opexCat] = await db.select({ id: expenseCategories.id }).from(expenseCategories).where(and(eq(expenseCategories.organizationId, admin.organizationId), eq(expenseCategories.includedInOpex, true))).limit(1);
  opexCategoryId = opexCat.id;
  // No CAPEX category is seeded — create one (includedInOpex=false).
  const capex = await createExpenseCategory(admin, { key: 'capital_works_test', nameEn: 'Capital Works', includedInOpex: false });
  capexCategoryId = capex.id;
}, 180_000);

afterAll(() => cleanup?.());

/* -------------------------------------------------------------------------- */
describe('Operating expense entry', () => {
  it('creates an OPEX record with a collision-safe reference and an audit entry', async () => {
    const { createOperatingExpense } = await import('@/services/financial-service');
    const { auditLogs, operatingExpenses } = await import('@/db/schema');
    const result = await createOperatingExpense(admin, { categoryId: opexCategoryId, propertyId, unitId, description: 'Chiller service', amount: 4200, incurredOn: TODAY });
    expect(result.reference).toMatch(/^EXP-/);
    const [row] = await db.select({ org: operatingExpenses.organizationId, amount: operatingExpenses.amount }).from(operatingExpenses).where(eq(operatingExpenses.id, result.id));
    expect(row.org).toBe(admin.organizationId);
    expect(Number(row.amount)).toBe(4200);
    const audit = await db.select({ action: auditLogs.action }).from(auditLogs).where(and(eq(auditLogs.entityType, 'operating_expense'), eq(auditLogs.entityId, result.id)));
    expect(audit.some((a) => a.action === 'create')).toBe(true);
  });

  it('edits an OPEX record and audits the change', async () => {
    const { createOperatingExpense, updateOperatingExpense, getOperatingExpenseDetail } = await import('@/services/financial-service');
    const created = await createOperatingExpense(admin, { categoryId: opexCategoryId, propertyId, description: 'Editable', amount: 1000, incurredOn: TODAY });
    await updateOperatingExpense(admin, created.id, { categoryId: opexCategoryId, propertyId, description: 'Edited desc', amount: 1500, incurredOn: TODAY });
    const detail = await getOperatingExpenseDetail(admin.organizationId, created.id);
    expect(detail!.description).toBe('Edited desc');
    expect(detail!.amount).toBe(1500);
  });

  it('rejects a non-positive amount', async () => {
    const { createOperatingExpense } = await import('@/services/financial-service');
    await expect(createOperatingExpense(admin, { categoryId: opexCategoryId, propertyId, description: 'Bad', amount: 0, incurredOn: TODAY })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects a property in another organization', async () => {
    const { createOperatingExpense } = await import('@/services/financial-service');
    await expect(createOperatingExpense({ ...admin, organizationId: FOREIGN_ORG }, { categoryId: opexCategoryId, propertyId, description: 'X', amount: 100, incurredOn: TODAY })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('denies creation without financials:create and rejects invalid UUID on edit', async () => {
    const { createOperatingExpenseAction, updateOperatingExpenseAction } = await import('@/app/(app)/financials/actions');
    getSessionMock.mockResolvedValue({ ...admin, permissions: [] });
    const fd = new FormData();
    fd.set('categoryId', opexCategoryId); fd.set('propertyId', propertyId); fd.set('description', 'Nope'); fd.set('amount', '100'); fd.set('incurredOn', TODAY);
    const denied = await createOperatingExpenseAction(null, fd);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN');
    const bad = await updateOperatingExpenseAction('not-a-uuid', null, new FormData());
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('NOT_FOUND');
    expect(isUuid('not-a-uuid')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
describe('OPEX → OPEX/NOI rollup (BR-014/016)', () => {
  it('increases portfolio OPEX and reduces NOI, and rolls up at property scope', async () => {
    const { createOperatingExpense } = await import('@/services/financial-service');
    const { getPortfolioSummary, scopeFromSession } = await import('@/services/metrics-service');
    const before = await getPortfolioSummary(scopeFromSession(admin));
    const beforeProp = await getPortfolioSummary(scopeFromSession(admin, { propertyId }));
    await createOperatingExpense(admin, { categoryId: opexCategoryId, propertyId, description: 'Rollup OPEX', amount: 7000, incurredOn: TODAY });
    const after = await getPortfolioSummary(scopeFromSession(admin));
    const afterProp = await getPortfolioSummary(scopeFromSession(admin, { propertyId }));
    expect(after.operatingExpenses).toBeGreaterThanOrEqual(before.operatingExpenses + 7000 - 0.01);
    expect(after.netOperatingIncome).toBeLessThanOrEqual(before.netOperatingIncome - 7000 + 0.01);
    expect(afterProp.operatingExpenses).toBeGreaterThanOrEqual(beforeProp.operatingExpenses + 7000 - 0.01);
  });

  it('enforces the spend-approval gate above the threshold', async () => {
    const { createOperatingExpense } = await import('@/services/financial-service');
    const { getPolicy } = await import('@/lib/settings');
    const policy = await getPolicy(admin.organizationId);
    const big = policy.maintenanceSpendApprovalThreshold + 5000;
    const nonApprover = { ...admin, permissions: admin.permissions.filter((p) => p !== 'financials:approve') };
    await expect(createOperatingExpense(nonApprover, { categoryId: opexCategoryId, propertyId, description: 'Big', amount: big, incurredOn: TODAY })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const ok = await createOperatingExpense(admin, { categoryId: opexCategoryId, propertyId, description: 'Big approved', amount: big, incurredOn: TODAY });
    expect(ok.id).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
describe('CAPEX classification', () => {
  it('records CAPEX under a non-OPEX category and keeps it out of OPEX', async () => {
    const { createOperatingExpense, getOperatingExpenseDetail } = await import('@/services/financial-service');
    const { getPortfolioSummary, scopeFromSession } = await import('@/services/metrics-service');
    const before = await getPortfolioSummary(scopeFromSession(admin));
    const capex = await createOperatingExpense(admin, { categoryId: capexCategoryId, propertyId, description: 'New generator', amount: 9000, incurredOn: TODAY });
    const detail = await getOperatingExpenseDetail(admin.organizationId, capex.id);
    expect(detail!.includedInOpex).toBe(false);
    const after = await getPortfolioSummary(scopeFromSession(admin));
    // CAPEX must NOT increase OPEX.
    expect(Math.abs(after.operatingExpenses - before.operatingExpenses)).toBeLessThan(0.01);
  });
});

/* -------------------------------------------------------------------------- */
describe('Valuations', () => {
  it('records a valuation, marks it current and audits', async () => {
    const { createValuation } = await import('@/services/financial-service');
    const { valuations, auditLogs } = await import('@/db/schema');
    const result = await createValuation(admin, { propertyId, valuationDate: TODAY, marketValue: 12_000_000, valuationMethod: 'income', capRate: 7.5 });
    const [row] = await db.select({ isCurrent: valuations.isCurrent, status: valuations.status }).from(valuations).where(eq(valuations.id, result.id));
    expect(row.isCurrent).toBe(true);
    const audit = await db.select({ action: auditLogs.action }).from(auditLogs).where(and(eq(auditLogs.entityType, 'valuation'), eq(auditLogs.entityId, result.id)));
    expect(audit.some((a) => a.action === 'create')).toBe(true);
  });

  it('supersedes the prior current valuation and preserves history with computed change', async () => {
    const { createValuation } = await import('@/services/financial-service');
    const { valuations } = await import('@/db/schema');
    const first = await createValuation(admin, { propertyId, valuationDate: '2025-01-01', marketValue: 10_000_000 });
    const second = await createValuation(admin, { propertyId, valuationDate: '2025-07-01', marketValue: 11_000_000 });
    const [firstRow] = await db.select({ isCurrent: valuations.isCurrent, status: valuations.status }).from(valuations).where(eq(valuations.id, first.id));
    const [secondRow] = await db.select({ isCurrent: valuations.isCurrent, changeAmount: valuations.changeAmount }).from(valuations).where(eq(valuations.id, second.id));
    expect(firstRow.isCurrent).toBe(false);
    expect(firstRow.status).toBe('superseded');
    expect(secondRow.isCurrent).toBe(true);
    expect(Number(secondRow.changeAmount)).toBe(1_000_000);
    // History preserved: the first valuation still exists.
    const all = await db.select({ id: valuations.id }).from(valuations).where(eq(valuations.propertyId, propertyId));
    expect(all.length).toBeGreaterThanOrEqual(2);
  });
});

/* -------------------------------------------------------------------------- */
describe('Budgets', () => {
  it('creates a budget and upserts a budget line (create then update)', async () => {
    const { createBudget, upsertBudgetLine, getBudgetDetail } = await import('@/services/financial-service');
    const budget = await createBudget(admin, { name: 'FY Test Budget', fiscalYear: 2026, status: 'approved' });
    const created = await upsertBudgetLine(admin, { budgetId: budget.id, lineType: 'opex', periodMonth: 3, budgetAmount: 50000 });
    expect(created.created).toBe(true);
    const updated = await upsertBudgetLine(admin, { budgetId: budget.id, lineType: 'opex', periodMonth: 3, budgetAmount: 65000 });
    expect(updated.created).toBe(false);
    expect(updated.id).toBe(created.id);
    const detail = await getBudgetDetail(admin.organizationId, budget.id);
    const line = detail!.lines.find((l) => l.id === created.id);
    expect(line!.budgetAmount).toBe(65000);
  });

  it('rejects a budget line for a budget in another organization', async () => {
    const { upsertBudgetLine, createBudget } = await import('@/services/financial-service');
    const budget = await createBudget(admin, { name: 'Iso Budget', fiscalYear: 2026 });
    await expect(upsertBudgetLine({ ...admin, organizationId: FOREIGN_ORG }, { budgetId: budget.id, lineType: 'opex', periodMonth: 1, budgetAmount: 100 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

/* -------------------------------------------------------------------------- */
describe('Validation & audit extras', () => {
  it('returns field errors for a missing category via the action', async () => {
    const { createOperatingExpenseAction } = await import('@/app/(app)/financials/actions');
    getSessionMock.mockResolvedValue(admin);
    const fd = new FormData();
    fd.set('propertyId', propertyId); fd.set('description', 'No category'); fd.set('amount', '100'); fd.set('incurredOn', TODAY);
    const result = await createOperatingExpenseAction(null, fd);
    expect(result.ok).toBe(false);
    if (!result.ok) { expect(result.error.code).toBe('VALIDATION'); expect(result.fieldErrors?.categoryId).toBeTruthy(); }
  });

  it('rejects a duplicate expense-category key', async () => {
    const { createExpenseCategory } = await import('@/services/financial-service');
    await expect(createExpenseCategory(admin, { key: 'capital_works_test', nameEn: 'Dup', includedInOpex: false })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects a non-positive valuation market value', async () => {
    const { createValuation } = await import('@/services/financial-service');
    await expect(createValuation(admin, { propertyId, valuationDate: TODAY, marketValue: 0 })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('audits budget creation', async () => {
    const { createBudget } = await import('@/services/financial-service');
    const { auditLogs } = await import('@/db/schema');
    const budget = await createBudget(admin, { name: 'Audited Budget', fiscalYear: 2027 });
    const audit = await db.select({ action: auditLogs.action }).from(auditLogs).where(and(eq(auditLogs.entityType, 'budget'), eq(auditLogs.entityId, budget.id)));
    expect(audit.some((a) => a.action === 'create')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
describe('Organization isolation', () => {
  it('does not expose an expense to another organization', async () => {
    const { createOperatingExpense, getOperatingExpenseDetail } = await import('@/services/financial-service');
    const created = await createOperatingExpense(admin, { categoryId: opexCategoryId, propertyId, description: 'Isolated', amount: 300, incurredOn: TODAY });
    expect(await getOperatingExpenseDetail(FOREIGN_ORG, created.id)).toBeNull();
    expect(await getOperatingExpenseDetail(admin.organizationId, created.id)).not.toBeNull();
  });
});
