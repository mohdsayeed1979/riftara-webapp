import type { Metadata } from 'next';
import Link from 'next/link';
import { Bell, CircleDollarSign, Clock, Download, FileText, Receipt, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { EmptyState } from '@/components/ui/misc';
import { KpiGrid, PageHeader } from '@/components/ui/page';
import { StatusBadge } from '@/components/ui/status-badge';
import { Pagination, Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ColumnChart, TrendAreaChart } from '@/components/charts/primitives';
import { RecordPaymentButton } from '@/features/collections/record-payment-button';
import { can, requirePermission } from '@/lib/auth/guard';
import { formatCompactCurrency, formatCurrency, formatDate, formatPercent } from '@/lib/format';
import { getRequestLocale, getRequestLocationId } from '@/lib/locale';
import { getMessages, interpolate } from '@/i18n';
import {
  getCollectionSummary,
  getTrendSeries,
  scopeFromSession,
} from '@/services/metrics-service';
import {
  getTopOverdueTenants,
  listInvoices,
  type InvoiceListFilters,
} from '@/services/collection-service';

export const metadata: Metadata = { title: 'Collections' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 15;

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission('collections:view');
  const params = await searchParams;
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  const t = m.collections;
  const cityId = await getRequestLocationId();
  const page = Math.max(1, Number(params.page) || 1);
  const allowedPropertyIds = user.scopedPropertyIds.length ? user.scopedPropertyIds : null;

  const scope = scopeFromSession(user, { cityId, propertyId: params.propertyId ?? null });

  const [summary, trend, topOverdue, invoices] = await Promise.all([
    getCollectionSummary(scope),
    getTrendSeries(scope, 12),
    getTopOverdueTenants(user.organizationId, allowedPropertyIds),
    listInvoices({
      organizationId: user.organizationId,
      allowedPropertyIds,
      propertyId: params.propertyId,
      status: params.status,
      search: params.search,
      page,
      pageSize: PAGE_SIZE,
    } satisfies InvoiceListFilters),
  ]);

  const money = (value: number) => formatCompactCurrency(value, { locale });

  const collectionTrend = trend.map((point) => ({
    label: point.label,
    Billed: point.billed,
    Collected: point.collected,
  }));

  const agingChart = summary.aging.map((bucket) => ({
    label: bucket.label,
    Amount: bucket.amount,
  }));

  const buildHref = (targetPage: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== 'page') query.set(key, value);
    }
    query.set('page', String(targetPage));
    return `/collections?${query.toString()}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href="/collections/dunning">
                <Bell />
                {t.dunning}
              </Link>
            </Button>
            {can(user, 'collections:create') ? (
              <Button variant="secondary" asChild>
                <Link href="/collections/invoices/generate">
                  <FileText />
                  {t.generateInvoices}
                </Link>
              </Button>
            ) : null}
            {can(user, 'collections:export') ? (
              <Button variant="secondary" asChild>
                <a href="/api/v1/collections/export">
                  <Download />
                  {m.common.export}
                </a>
              </Button>
            ) : null}
            {can(user, 'collections:create') ? <RecordPaymentButton /> : null}
          </>
        }
      />

      <KpiGrid columns={4}>
        <KpiCard
          label={t.totalBilled}
          value={money(summary.billed)}
          caption={t.trailing12m}
          icon={<Receipt />}
          tone="neutral"
        />
        <KpiCard
          label={t.totalCollected}
          value={money(summary.collected)}
          caption={interpolate(t.collectionRateCaption, { rate: formatPercent(summary.collectionRate, { locale }) })}
          icon={<CircleDollarSign />}
          tone="success"
          ringValue={summary.collectionRate}
        />
        <KpiCard
          label={t.outstanding}
          value={money(summary.outstanding)}
          caption={interpolate(t.avgAge, { days: summary.averageDaysOutstanding })}
          icon={<Clock />}
          tone="warning"
          higherIsBetter={false}
          href="/collections?status=due"
        />
        <KpiCard
          label={t.overdue}
          value={money(summary.overdue)}
          caption={t.pastDue}
          icon={<XCircle />}
          tone="error"
          higherIsBetter={false}
          href="/collections?status=overdue"
        />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.2fr_0.9fr]">
        <Card>
          <CardHeader title={t.agingAnalysis} description={`${money(summary.outstanding)} ${t.outstanding}`} />
          <CardBody className="pt-0">
            <ColumnChart
              data={agingChart}
              series={[{ key: 'Amount', label: 'Outstanding' }]}
              height={230}
              yTickFormatter={(value) => formatCompactCurrency(value, { locale }).replace('SAR ', '')}
              valueFormatter={(value) => formatCompactCurrency(value, { locale })}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t.collectionTrend} description={t.billedVsCollected} />
          <CardBody className="pt-0">
            <TrendAreaChart
              data={collectionTrend}
              series={[
                { key: 'Billed', label: 'Billed', color: 'var(--color-chart-3)' },
                { key: 'Collected', label: 'Collected', color: 'var(--color-chart-1)' },
              ]}
              height={230}
              yTickFormatter={(value) => formatCompactCurrency(value, { locale }).replace('SAR ', '')}
              valueFormatter={(value) => formatCompactCurrency(value, { locale })}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t.topOverdueTenants}
            action={
              <Link href="/collections?status=overdue" className="text-[12px] font-medium text-[var(--color-info)] hover:underline">
                {m.common.viewAll}
              </Link>
            }
          />
          {topOverdue.length === 0 ? (
            <EmptyState title={t.noOverdueTenants} description={t.allCurrent} />
          ) : (
            <ul className="divide-y divide-[var(--color-border-subtle)] border-t border-[var(--color-border-subtle)]">
              {topOverdue.map((tenant) => (
                <li key={tenant.tenantId}>
                  <Link
                    href={`/tenants/${tenant.tenantId}`}
                    className="flex items-center justify-between gap-2 px-5 py-2.5 transition-colors hover:bg-[var(--color-surface-muted)]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium text-[var(--color-text-primary)]">
                        {tenant.tenantName}
                      </span>
                      <span className="block text-[11px] text-[var(--color-text-tertiary)]">
                        {interpolate(t.invoicesCount, { count: tenant.invoiceCount })}
                      </span>
                    </span>
                    <span className="text-end">
                      <span className="block text-[12.5px] font-semibold text-[var(--color-text-primary)] tabular">
                        {money(tenant.outstanding)}
                      </span>
                      <Badge tone={tenant.maxDaysOverdue > 90 ? 'error' : 'warning'} size="sm">
                        {tenant.maxDaysOverdue}d
                      </Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title={t.overdueInvoices} description={t.receivablesAction} />
        {invoices.items.length === 0 ? (
          <EmptyState title={t.noOpenInvoices} description={t.noOpenInvoicesHint} />
        ) : (
          <>
            <TableContainer>
              <Table>
                <THead>
                  <TR>
                    <TH>{t.invoiceNumberCol}</TH>
                    <TH>{m.contracts.tenant}</TH>
                    <TH>{m.properties.property}</TH>
                    <TH>{m.units.unit}</TH>
                    <TH alignment="end">{t.dueDate}</TH>
                    <TH alignment="end">{t.amount}</TH>
                    <TH alignment="end">{t.outstandingCol}</TH>
                    <TH alignment="end">{t.days}</TH>
                    <TH alignment="center">{m.common.status}</TH>
                  </TR>
                </THead>
                <TBody>
                  {invoices.items.map((invoice) => (
                    <TR key={invoice.id} interactive>
                      <TD>
                        <Link href={`/collections/invoices/${invoice.id}`} className="font-medium hover:text-[var(--color-info)]">
                          {invoice.invoiceNumber}
                        </Link>
                      </TD>
                      <TD>
                        <Link href={`/tenants/${invoice.tenantId}`} className="hover:text-[var(--color-info)]">
                          {invoice.tenantName}
                        </Link>
                      </TD>
                      <TD className="text-[var(--color-text-secondary)]">{invoice.propertyName}</TD>
                      <TD className="text-[var(--color-text-secondary)]">{invoice.unitNumber}</TD>
                      <TD alignment="end" className="whitespace-nowrap">{formatDate(invoice.dueDate, { locale, style: 'short' })}</TD>
                      <TD alignment="end" numeric>{formatCurrency(invoice.totalAmount, { locale })}</TD>
                      <TD alignment="end" numeric className="font-medium text-[var(--color-error)]">
                        {formatCurrency(invoice.balance, { locale })}
                      </TD>
                      <TD alignment="end">
                        {invoice.daysOverdue > 0 ? (
                          <Badge tone={invoice.daysOverdue > 90 ? 'error' : 'warning'} size="sm">
                            {invoice.daysOverdue}
                          </Badge>
                        ) : (
                          <span className="text-[var(--color-text-tertiary)]">—</span>
                        )}
                      </TD>
                      <TD alignment="center"><StatusBadge status={invoice.status} /></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
            <Pagination page={page} pageSize={PAGE_SIZE} total={invoices.total} buildHref={buildHref} />
          </>
        )}
      </Card>
    </div>
  );
}
