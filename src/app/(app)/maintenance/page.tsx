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

  const statusDonut = [
    { label: 'Open', value: summary.open, color: STATUS_COLOR.open, href: '/maintenance?status=open' },
    { label: 'Assigned', value: summary.assigned, color: STATUS_COLOR.assigned, href: '/maintenance?status=assigned' },
    { label: 'In Progress', value: summary.inProgress, color: STATUS_COLOR.in_progress, href: '/maintenance?status=in_progress' },
    { label: 'Pending', value: summary.pending, color: STATUS_COLOR.pending, href: '/maintenance?status=pending' },
    { label: 'Completed', value: summary.completed, color: STATUS_COLOR.completed, href: '/maintenance?status=completed' },
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
        title="Maintenance Operations"
        subtitle="Manage work orders, track SLA performance and oversee preventive maintenance."
        actions={
          <>
            {can(user, 'maintenance:edit') ? <RunSlaScanButton /> : null}
            {can(user, 'maintenance:create') ? (
              <Button asChild>
                <Link href="/maintenance/new"><Plus />Create Work Order</Link>
              </Button>
            ) : null}
          </>
        }
      />

      <KpiGrid columns={6}>
        <KpiCard label="Total Work Orders" value={summary.total.toLocaleString()} caption="This period" icon={<ClipboardList />} tone="neutral" />
        <KpiCard label="Open" value={String(summary.open + summary.assigned + summary.inProgress)} caption="In progress" icon={<Clock />} tone="warning" higherIsBetter={false} href="/maintenance?status=open" />
        <KpiCard label="Completed" value={String(summary.completed)} caption="This period" icon={<CheckCircle2 />} tone="success" />
        <KpiCard label="Avg Resolution" value={`${summary.averageResolutionDays} days`} icon={<Timer />} tone="info" higherIsBetter={false} />
        <KpiCard label="SLA Compliance" value={formatPercent(summary.slaCompliance, { locale })} caption="Within target" icon={<CheckCircle2 />} tone={summary.slaCompliance >= 95 ? 'success' : 'warning'} ringValue={summary.slaCompliance} />
        <KpiCard label="Total Costs" value={money(summary.totalCost)} caption="This period" icon={<Banknote />} tone="neutral" higherIsBetter={false} href="/financials/expenses" />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1fr_1.1fr]">
        <Card>
          <CardHeader title="Work Order Trend" description="Created against completed" />
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
          <CardHeader title="Work Order Status" />
          <CardBody className="pt-0">
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <DonutChart data={statusDonut} centerValue={String(summary.total)} centerLabel="Total WOs" height={180} />
              <div className="w-full flex-1">
                <DonutLegend data={statusDonut} total={summary.total} />
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Vendor Performance" />
          {vendors.length === 0 ? (
            <EmptyState title="No vendors" />
          ) : (
            <TableContainer>
              <Table>
                <THead>
                  <TR><TH>Vendor</TH><TH alignment="end">WOs</TH><TH alignment="end">SLA</TH><TH alignment="end">Rating</TH></TR>
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
          <CardHeader title="Upcoming Preventive Maintenance" />
          {preventive.length === 0 ? (
            <EmptyState title="No scheduled maintenance" />
          ) : (
            <TableContainer>
              <Table>
                <THead>
                  <TR><TH>#</TH><TH>Property</TH><TH>Type</TH><TH alignment="end">Scheduled</TH><TH alignment="center">Status</TH>{can(user, 'maintenance:create') ? <TH alignment="end">Action</TH> : null}</TR>
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
          <CardHeader title="Recent Work Orders" />
          <FilterBarWrapper />
          {workOrders.items.length === 0 ? (
            <EmptyState icon={<Wrench />} title="No work orders found" />
          ) : (
            <>
              <TableContainer>
                <Table>
                  <THead>
                    <TR><TH>#</TH><TH>Title</TH><TH>Property</TH><TH alignment="center">Priority</TH><TH alignment="center">Status</TH></TR>
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

function FilterBarWrapper() {
  return (
    <div className="px-5 pb-3">
      <FilterBar
        searchPlaceholder="Search work orders..."
        filters={[
          {
            key: 'status',
            placeholder: 'All Statuses',
            options: [
              { value: 'open', label: 'Open' },
              { value: 'assigned', label: 'Assigned' },
              { value: 'in_progress', label: 'In Progress' },
              { value: 'pending', label: 'Pending' },
              { value: 'completed', label: 'Completed' },
            ],
          },
          {
            key: 'priority',
            placeholder: 'All Priorities',
            options: [
              { value: 'critical', label: 'Critical' },
              { value: 'high', label: 'High' },
              { value: 'medium', label: 'Medium' },
              { value: 'low', label: 'Low' },
            ],
          },
        ]}
      />
    </div>
  );
}
