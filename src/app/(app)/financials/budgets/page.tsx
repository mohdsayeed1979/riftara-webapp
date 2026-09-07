import type { Metadata } from 'next';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { budgetLines, budgets, invoices, maintenanceCosts, operatingExpenses } from '@/db/schema';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/page';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { requirePermission } from '@/lib/auth/guard';
import { budgetVariance } from '@/lib/calculations/metrics';
import { formatCompactCurrency } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Budget vs Actual' };
export const dynamic = 'force-dynamic';

export default async function BudgetsPage() {
  const user = await requirePermission('financials:view');
  const locale = await getRequestLocale();
  const db = await getDb();
  const year = new Date().getUTCFullYear();
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  // Budget totals by line type across the organization.
  const budgetRows = await db
    .select({
      lineType: budgetLines.lineType,
      total: sql<number>`coalesce(sum(${budgetLines.budgetAmount}), 0)::float8`,
    })
    .from(budgetLines)
    .innerJoin(budgets, eq(budgets.id, budgetLines.budgetId))
    .where(and(eq(budgets.organizationId, user.organizationId), eq(budgets.fiscalYear, year)))
    .groupBy(budgetLines.lineType);

  const budgetByType = new Map(budgetRows.map((row) => [row.lineType, Number(row.total)]));

  const [revenueRow] = await db
    .select({ collected: sql<number>`coalesce(sum(${invoices.paidAmount}), 0)::float8`, billed: sql<number>`coalesce(sum(${invoices.totalAmount}), 0)::float8` })
    .from(invoices)
    .where(and(eq(invoices.organizationId, user.organizationId), gte(invoices.invoiceDate, yearStart), lte(invoices.invoiceDate, yearEnd)));

  const [opexRow] = await db
    .select({ total: sql<number>`coalesce(sum(${operatingExpenses.amount}), 0)::float8` })
    .from(operatingExpenses)
    .where(and(eq(operatingExpenses.organizationId, user.organizationId), gte(operatingExpenses.incurredOn, yearStart), lte(operatingExpenses.incurredOn, yearEnd)));

  const [maintenanceRow] = await db
    .select({ total: sql<number>`coalesce(sum(${maintenanceCosts.amount}), 0)::float8` })
    .from(maintenanceCosts)
    .where(and(eq(maintenanceCosts.organizationId, user.organizationId), gte(maintenanceCosts.incurredOn, yearStart), lte(maintenanceCosts.incurredOn, yearEnd)));

  const revenueActual = Number(revenueRow?.billed ?? 0);
  const collectionActual = Number(revenueRow?.collected ?? 0);
  const opexActual = Number(opexRow?.total ?? 0);
  const maintenanceActual = Number(maintenanceRow?.total ?? 0);
  const noiActual = revenueActual - opexActual;

  const lines = [
    { label: 'Revenue', ...budgetVariance(revenueActual, budgetByType.get('revenue') ?? 0, true) },
    { label: 'Collections', ...budgetVariance(collectionActual, budgetByType.get('collection') ?? 0, true) },
    { label: 'Operating Expenses', ...budgetVariance(opexActual, budgetByType.get('opex') ?? 0, false) },
    { label: 'Maintenance', ...budgetVariance(maintenanceActual, budgetByType.get('maintenance') ?? 0, false) },
    { label: 'Net Operating Income', ...budgetVariance(noiActual, budgetByType.get('noi') ?? 0, true) },
  ];

  const money = (value: number) => formatCompactCurrency(value, { locale });
  const hasBudget = budgetRows.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Financials', href: '/financials' }, { label: 'Budget vs Actual' }]}
        title="Budget vs Actual"
        subtitle={`Fiscal year ${year} — actuals against the approved operating budget.`}
      />
      <Card>
        {!hasBudget ? (
          <EmptyState title="No budget configured" description="Approved budgets will appear here for variance analysis." />
        ) : (
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH>Line</TH>
                  <TH alignment="end">Budget</TH>
                  <TH alignment="end">Actual</TH>
                  <TH alignment="end">Variance</TH>
                  <TH alignment="end">Variance %</TH>
                </TR>
              </THead>
              <TBody>
                {lines.map((line) => (
                  <TR key={line.label}>
                    <TD className="font-medium">{line.label}</TD>
                    <TD alignment="end" numeric>{money(line.budget)}</TD>
                    <TD alignment="end" numeric>{money(line.actual)}</TD>
                    <TD alignment="end" numeric className={cn('font-medium', line.favourable ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]')}>
                      {line.variance >= 0 ? '+' : ''}{money(line.variance)}
                    </TD>
                    <TD alignment="end" numeric className={cn(line.favourable ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]')}>
                      {line.variancePercent >= 0 ? '+' : ''}{line.variancePercent}%
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        )}
      </Card>
    </div>
  );
}
