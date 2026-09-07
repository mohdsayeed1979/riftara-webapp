import type { Metadata } from 'next';
import Link from 'next/link';
import { Banknote, Building2, TrendingUp, Wallet } from 'lucide-react';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { expenseCategories, operatingExpenses } from '@/db/schema';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { EmptyState } from '@/components/ui/misc';
import { KpiGrid, PageHeader } from '@/components/ui/page';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ColumnChart } from '@/components/charts/primitives';
import { requirePermission } from '@/lib/auth/guard';
import { formatCompactCurrency, formatPercent } from '@/lib/format';
import { getRequestLocale, getRequestLocationId } from '@/lib/locale';
import { getPortfolioSummary, getTrendSeries, scopeFromSession } from '@/services/metrics-service';

export const metadata: Metadata = { title: 'Financials' };
export const dynamic = 'force-dynamic';

export default async function FinancialsPage() {
  const user = await requirePermission('financials:view');
  const locale = await getRequestLocale();
  const cityId = await getRequestLocationId();
  const scope = scopeFromSession(user, { cityId });
  const db = await getDb();

  const yearStart = new Date();
  yearStart.setUTCMonth(yearStart.getUTCMonth() - 12);
  const yearStartIso = yearStart.toISOString().slice(0, 10);

  const [summary, trend, opexByCategory] = await Promise.all([
    getPortfolioSummary(scope),
    getTrendSeries(scope, 12),
    db
      .select({
        category: expenseCategories.nameEn,
        total: sql<number>`sum(${operatingExpenses.amount})::float8`,
      })
      .from(operatingExpenses)
      .innerJoin(expenseCategories, eq(expenseCategories.id, operatingExpenses.categoryId))
      .where(and(eq(operatingExpenses.organizationId, user.organizationId), gte(operatingExpenses.incurredOn, yearStartIso)))
      .groupBy(expenseCategories.nameEn)
      .orderBy(desc(sql`sum(${operatingExpenses.amount})`)),
  ]);

  const money = (value: number) => formatCompactCurrency(value, { locale });
  const noiTrend = trend.map((point) => ({ label: point.label, NOI: point.noi, OPEX: point.opex }));
  const totalOpex = opexByCategory.reduce((sum, row) => sum + Number(row.total), 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Financials" subtitle="Portfolio revenue, operating expenses, NOI and valuation." />

      <KpiGrid columns={6}>
        <KpiCard label="Portfolio Value" value={money(summary.marketValue)} caption="Market valuation" icon={<Building2 />} tone="gold" href="/financials/valuations" />
        <KpiCard label="Book Value" value={money(summary.bookValue)} icon={<Wallet />} tone="neutral" />
        <KpiCard label="Contracted Revenue" value={money(summary.contractedRevenue)} caption="Active leases" icon={<Banknote />} tone="info" />
        <KpiCard label="Operating Expenses" value={money(summary.operatingExpenses)} caption="Trailing 12 months" icon={<Wallet />} tone="warning" higherIsBetter={false} href="/financials/expenses" />
        <KpiCard label="Net Operating Income" value={money(summary.netOperatingIncome)} caption={`${formatPercent(summary.noiMargin, { locale })} margin`} icon={<TrendingUp />} tone="success" />
        <KpiCard label="Gross Yield" value={formatPercent(summary.grossYield, { locale, decimals: 1 })} icon={<TrendingUp />} tone="gold" />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="NOI & OPEX Trend" description="Last 12 months" />
          <CardBody className="pt-0">
            <ColumnChart
              data={noiTrend}
              series={[
                { key: 'NOI', label: 'NOI', color: 'var(--color-chart-1)' },
                { key: 'OPEX', label: 'OPEX', color: 'var(--color-chart-4)' },
              ]}
              height={250}
              yTickFormatter={(value) => formatCompactCurrency(value, { locale }).replace('SAR ', '')}
              valueFormatter={(value) => formatCompactCurrency(value, { locale })}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Operating Expenses by Category" description="Trailing 12 months" />
          {opexByCategory.length === 0 ? (
            <EmptyState title="No expenses recorded" />
          ) : (
            <TableContainer>
              <Table>
                <THead>
                  <TR><TH>Category</TH><TH alignment="end">Amount</TH><TH alignment="end">Share</TH></TR>
                </THead>
                <TBody>
                  {opexByCategory.map((row) => (
                    <TR key={row.category}>
                      <TD className="font-medium">{row.category}</TD>
                      <TD alignment="end" numeric>{money(Number(row.total))}</TD>
                      <TD alignment="end" numeric className="text-[var(--color-text-secondary)]">
                        {((Number(row.total) / totalOpex) * 100).toFixed(1)}%
                      </TD>
                    </TR>
                  ))}
                  <TR className="bg-[var(--color-surface-muted)] font-semibold">
                    <TD>Total OPEX</TD>
                    <TD alignment="end" numeric>{money(totalOpex)}</TD>
                    <TD alignment="end" numeric>100%</TD>
                  </TR>
                </TBody>
              </Table>
            </TableContainer>
          )}
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href="/financials/expenses" className="rounded-[var(--radius-control)] border border-[var(--color-border-base)] bg-[var(--color-surface)] px-4 py-2.5 text-[13px] font-medium transition-colors hover:bg-[var(--color-surface-alt)]">
          Operating Expenses →
        </Link>
        <Link href="/financials/valuations" className="rounded-[var(--radius-control)] border border-[var(--color-border-base)] bg-[var(--color-surface)] px-4 py-2.5 text-[13px] font-medium transition-colors hover:bg-[var(--color-surface-alt)]">
          Asset Valuations →
        </Link>
        <Link href="/financials/budgets" className="rounded-[var(--radius-control)] border border-[var(--color-border-base)] bg-[var(--color-surface)] px-4 py-2.5 text-[13px] font-medium transition-colors hover:bg-[var(--color-surface-alt)]">
          Budget vs Actual →
        </Link>
      </div>
    </div>
  );
}
