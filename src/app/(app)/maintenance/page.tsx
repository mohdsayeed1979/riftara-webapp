import type { Metadata } from 'next';
import Link from 'next/link';
import { Banknote, CheckCircle2, ClipboardList, Clock, Plus, Star, Timer, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { FilterBar } from '@/components/app/filter-bar';
import { KpiCard } from '@/components/ui/kpi-card';
import { EmptyState } from '@/components/ui/misc';
import { KpiGrid, PageHeader } from '@/components/ui/page';
import { StatusBadge } from '@/components/ui/status-badge';
import { Pagination, Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ColumnChart, DonutChart, DonutLegend } from '@/components/charts/primitives';
import { GeneratePmWorkOrderButton, RunSlaScanButton } from '@/features/maintenance/maintenance-buttons';
import { can, requirePermission } from '@/lib/auth/guard';
import { formatCompactCurrency, formatDate, formatPercent } from '@/lib/format';
import { getRequestLocale, getRequestLocationId } from '@/lib/locale';
import { getMessages, interpolate, type Messages } from '@/i18n';
import {
  getUpcomingPreventiveMaintenance,
  getVendorPerformance,
  listWorkOrders,
  type WorkOrderListFilters,
} from '@/services/maintenance-service';
import { getMaintenanceSummary, getTrendSeries, scopeFromSession } from '@/services/metrics-service';

export const metadata: Metadata = { title: 'Maintenance' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 15;

const STATUS_COLOR: Record<string, string> = {
  open: 'var(--color-status-reserved)',
  assigned: 'var(--color-info)',
  in_progress: 'var(--color-chart-2)',
  pending: 'var(--color-warning)',
  completed: 'var(--color-status-available)',
  cancelled: 'var(--color-neutral)',
};

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission('maintenance:view');
  const params = await searchParams;
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  const t = m.maintenance;
  const cityId = await getRequestLocationId();
  const page = Math.max(1, Number(params.page) || 1);
  const allowedPropertyIds = user.scopedPropertyIds.length ? user.scopedPropertyIds : null;

  const scope = scopeFromSession(user, { cityId, propertyId: params.propertyId ?? null });

  const [summary, trend, vendors, preventive, workOrders] = await Promise.all([
    getMaintenanceSummary(scope),
    getTrendSeries(scope, 12),
    getVendorPerformance(user.organizationId),
    getUpcomingPreventiveMaintenance(user.organizationId, allowedPropertyIds),
    listWorkOrders({
      organizationId: user.organizationId,
      allowedPropertyIds,
      propertyId: params.propertyId,
      status: params.status,
      priority: params.priority,
      slaBreached: params.slaBreached === 'true',
      search: params.search,
      page,
      pageSize: PAGE_SIZE,
    } satisfies WorkOrderListFilters),
  ]);

  const money = (value: number) => formatCompactCurrency(value, { locale });

  const trendData = trend.map((point) => ({
    label: point.label,
    Created: point.workOrdersCreated,
    Completed: point.workOrdersCompleted,
  }));

  const st = m.common.statuses;
  const statusDonut = [
    { label: st.open, value: summary.open, color: STATUS_COLOR.open, href: '/maintenance?status=open' },
    { label: st.assigned, value: summary.assigned, color: STATUS_COLOR.assigned, href: '/maintenance?status=assigned' },
    { label: st.in_progress, value: summary.inProgress, color: STATUS_COLOR.in_progress, href: '/maintenance?status=in_progress' },
    { label: st.pending, value: summary.pending, color: STATUS_COLOR.pending, href: '/maintenance?status=pending' },
    { label: st.completed, value: summary.completed, color: STATUS_COLOR.completed, href: '/maintenance?status=completed' },
  ].filter((slice) => slice.value > 0);

  const buildHref = (targetPage: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== 'page') query.set(key, value);
    }
    query.set('page', String(targetPage));
    return `/maintenance?${query.toString()}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <>
            {can(user, 'maintenance:edit') ? <RunSlaScanButton /> : null}
            {can(user, 'maintenance:create') ? (
              <Button asChild>
                <Link href="/maintenance/new"><Plus />{t.createWorkOrder}</Link>
              </Button>
            ) : null}
          </>
        }
      />

      <KpiGrid columns={6}>
        <KpiCard label={t.totalWorkOrders} value={summary.total.toLocaleString()} caption={t.thisPeriod} icon={<ClipboardList />} tone="neutral" />
        <KpiCard label={t.open} value={String(summary.open + summary.assigned + summary.inProgress)} caption={t.inProgressCaption} icon={<Clock />} tone="warning" higherIsBetter={false} href="/maintenance?status=open" />
        <KpiCard label={t.completed} value={String(summary.completed)} caption={t.thisPeriod} icon={<CheckCircle2 />} tone="success" />
        <KpiCard label={t.avgResolution} value={interpolate(t.days, { count: summary.averageResolutionDays })} icon={<Timer />} tone="info" higherIsBetter={false} />
        <KpiCard label={t.slaCompliance} value={formatPercent(summary.slaCompliance, { locale })} caption={t.withinTarget} icon={<CheckCircle2 />} tone={summary.slaCompliance >= 95 ? 'success' : 'warning'} ringValue={summary.slaCompliance} />
        <KpiCard label={t.totalCosts} value={money(summary.totalCost)} caption={t.thisPeriod} icon={<Banknote />} tone="neutral" higherIsBetter={false} href="/financials/expenses" />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1fr_1.1fr]">
        <Card>
          <CardHeader title={t.workOrderTrend} description={t.createdVsCompleted} />
          <CardBody className="pt-0">
            <ColumnChart
              data={trendData}
              series={[
                { key: 'Created', label: 'Created', color: 'var(--color-border-strong)' },
                { key: 'Completed', label: 'Completed', color: 'var(--color-chart-1)' },
              ]}
              height={230}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t.workOrderStatus} />
          <CardBody className="pt-0">
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <DonutChart data={statusDonut} centerValue={String(summary.total)} centerLabel={t.totalWOs} height={180} />
              <div className="w-full flex-1">
                <DonutLegend data={statusDonut} total={summary.total} />
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t.vendorPerformance} />
          {vendors.length === 0 ? (
            <EmptyState title={t.noVendors} />
          ) : (
            <TableContainer>
              <Table>
                <THead>
                  <TR><TH>{t.vendor}</TH><TH alignment="end">{t.wosCol}</TH><TH alignment="end">{t.slaCol}</TH><TH alignment="end">{t.ratingCol}</TH></TR>
                </THead>
                <TBody>
                  {vendors.map((vendor) => (
                    <TR key={vendor.id}>
                      <TD className="font-medium">{vendor.name}</TD>
                      <TD alignment="end" numeric>{vendor.workOrders}</TD>
                      <TD alignment="end" numeric className="text-[var(--color-success)]">{vendor.slaCompliance}%</TD>
                      <TD alignment="end">
                        <span className="inline-flex items-center gap-0.5 text-[var(--color-gold-600)]">
                          <Star className="size-3 fill-current" />
                          {vendor.rating.toFixed(1)}
                        </span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title={t.upcomingPM} />
          {preventive.length === 0 ? (
            <EmptyState title={t.noScheduledPM} />
          ) : (
            <TableContainer>
              <Table>
                <THead>
                  <TR><TH>#</TH><TH>{m.properties.property}</TH><TH>{m.units.unitType}</TH><TH alignment="end">{t.scheduledCol}</TH><TH alignment="center">{m.common.status}</TH>{can(user, 'maintenance:create') ? <TH alignment="end">{t.actionCol}</TH> : null}</TR>
                </THead>
                <TBody>
                  {preventive.map((schedule, index) => (
                    <TR key={schedule.id}>
                      <TD className="text-[var(--color-text-tertiary)]">{index + 1}</TD>
                      <TD className="font-medium">{schedule.propertyName}</TD>
                      <TD className="text-[var(--color-text-secondary)]">{schedule.categoryName ?? schedule.name}</TD>
                      <TD alignment="end" className="whitespace-nowrap">{formatDate(schedule.nextDueDate, { locale, style: 'short' })}</TD>
                      <TD alignment="center"><StatusBadge status={schedule.status === 'scheduled' ? 'scheduled' : schedule.status === 'overdue' ? 'overdue' : 'due'} dot={false} /></TD>
                      {can(user, 'maintenance:create') ? <TD alignment="end"><GeneratePmWorkOrderButton scheduleId={schedule.id} /></TD> : null}
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
          )}
        </Card>

        <Card>
          <CardHeader title={t.recentWorkOrders} />
          <FilterBarWrapper t={t} st={st} />
          {workOrders.items.length === 0 ? (
            <EmptyState icon={<Wrench />} title={t.noWorkOrdersFound} />
          ) : (
            <>
              <TableContainer>
                <Table>
                  <THead>
                    <TR><TH>#</TH><TH>{t.titleCol}</TH><TH>{m.properties.property}</TH><TH alignment="center">{t.priority}</TH><TH alignment="center">{m.common.status}</TH></TR>
                  </THead>
                  <TBody>
                    {workOrders.items.map((workOrder) => (
                      <TR key={workOrder.id} interactive>
                        <TD>
                          <Link href={`/maintenance/${workOrder.id}`} className="font-medium hover:text-[var(--color-info)]">
                            {workOrder.code}
                          </Link>
                        </TD>
                        <TD className="max-w-40 truncate">{workOrder.title}</TD>
                        <TD className="text-[var(--color-text-secondary)]">{workOrder.propertyName}</TD>
                        <TD alignment="center"><StatusBadge status={workOrder.priority} dot={false} /></TD>
                        <TD alignment="center"><StatusBadge status={workOrder.status} /></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableContainer>
              <Pagination page={page} pageSize={PAGE_SIZE} total={workOrders.total} buildHref={buildHref} />
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function FilterBarWrapper({ t, st }: { t: Messages['maintenance']; st: Messages['common']['statuses'] }) {
  return (
    <div className="px-5 pb-3">
      <FilterBar
        searchPlaceholder={t.searchPlaceholder}
        filters={[
          {
            key: 'status',
            placeholder: t.allStatuses,
            options: [
              { value: 'open', label: st.open },
              { value: 'assigned', label: st.assigned },
              { value: 'in_progress', label: st.in_progress },
              { value: 'pending', label: st.pending },
              { value: 'completed', label: st.completed },
            ],
          },
          {
            key: 'priority',
            placeholder: t.allPriorities,
            options: [
              { value: 'critical', label: st.critical },
              { value: 'high', label: st.high },
              { value: 'medium', label: st.medium },
              { value: 'low', label: st.low },
            ],
          },
        ]}
      />
    </div>
  );
}
