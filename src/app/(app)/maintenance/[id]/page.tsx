import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Building2, Wrench } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';
import { DetailList, DetailRow, MetaItem, PageHeader } from '@/components/ui/page';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { requirePermission } from '@/lib/auth/guard';
import { isUuid } from '@/lib/utils';
import { formatCurrency, formatDate, formatDateTime, formatDuration } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { getWorkOrderDetail } from '@/services/maintenance-service';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Work Order' };

export default async function WorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('maintenance:view');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const locale = await getRequestLocale();

  const data = await getWorkOrderDetail(user.organizationId, id);
  if (!data) notFound();
  const { workOrder, costs } = data;
  const currency = (value: number | string | null) => formatCurrency(Number(value ?? 0), { locale });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Maintenance', href: '/maintenance' }, { label: workOrder.code }]}
        title={workOrder.title}
        badge={<StatusBadge status={workOrder.status} size="md" />}
        meta={
          <>
            <MetaItem icon={<Wrench />}>{workOrder.code}</MetaItem>
            <MetaItem icon={<Building2 />}>{workOrder.propertyName}</MetaItem>
            {workOrder.unitNumber ? <span>Unit {workOrder.unitNumber}</span> : null}
            <StatusBadge status={workOrder.priority} dot={false} size="sm" />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Work Order Details" />
          <CardBody className="pt-0">
            {workOrder.description ? (
              <p className="mb-4 text-[13px] text-[var(--color-text-secondary)]">{workOrder.description}</p>
            ) : null}
            <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
              <DetailList>
                <DetailRow label="Type" value={<span className="capitalize">{workOrder.maintenanceType.replace(/_/g, ' ')}</span>} />
                <DetailRow label="Category" value={workOrder.categoryName ?? '—'} />
                <DetailRow label="Property" value={workOrder.propertyName} href={`/properties/${workOrder.propertyId}`} />
                <DetailRow label="Unit" value={workOrder.unitNumber ?? 'Common area'} href={workOrder.unitId ? `/units/${workOrder.unitId}` : undefined} />
                <DetailRow label="Vendor" value={workOrder.vendorName ?? '—'} />
              </DetailList>
              <DetailList>
                <DetailRow label="Created" value={formatDateTime(workOrder.createdAt, { locale })} />
                <DetailRow label="Completed" value={workOrder.completedAt ? formatDateTime(workOrder.completedAt, { locale }) : 'In progress'} />
                <DetailRow label="Estimated Cost" value={currency(workOrder.estimatedCost)} />
                <DetailRow label="Actual Cost" value={<span className="font-semibold">{currency(workOrder.actualCost)}</span>} />
              </DetailList>
            </div>
            {workOrder.resolutionNotes ? (
              <div className="mt-4 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)] p-3">
                <p className="text-[11.5px] font-semibold text-[var(--color-text-secondary)]">Resolution Notes</p>
                <p className="mt-1 text-[12.5px]">{workOrder.resolutionNotes}</p>
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="SLA Performance" />
          <CardBody className="pt-0">
            <DetailList>
              <DetailRow label="Response Target" value={`${workOrder.responseSlaHours}h`} />
              <DetailRow
                label="Actual Response"
                value={
                  workOrder.actualResponseHours !== null ? (
                    <span className={workOrder.responseSlaMet ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}>
                      {formatDuration(workOrder.actualResponseHours)}
                    </span>
                  ) : (
                    'Pending'
                  )
                }
              />
              <DetailRow label="Resolution Target" value={`${workOrder.resolutionSlaHours}h`} />
              <DetailRow
                label="Actual Resolution"
                value={
                  workOrder.actualResolutionHours !== null ? (
                    <span className={workOrder.resolutionSlaMet ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}>
                      {formatDuration(workOrder.actualResolutionHours)}
                    </span>
                  ) : (
                    'Pending'
                  )
                }
              />
              <DetailRow
                label="SLA Status"
                value={
                  workOrder.resolutionSlaMet === null ? (
                    <StatusBadge status="in_progress" label="In progress" dot={false} />
                  ) : workOrder.resolutionSlaMet ? (
                    <StatusBadge status="completed" label="Met" dot={false} />
                  ) : (
                    <StatusBadge status="overdue" label="Breached" dot={false} />
                  )
                }
              />
            </DetailList>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Cost Records" description="Feeds into property OPEX and NOI (BR-014)." />
        {costs.length === 0 ? (
          <EmptyState title="No costs recorded" description="Actual maintenance costs will appear here." />
        ) : (
          <TableContainer>
            <Table>
              <THead>
                <TR><TH>Description</TH><TH>Type</TH><TH>Invoice</TH><TH alignment="end">Incurred</TH><TH alignment="end">Amount</TH><TH alignment="end">VAT</TH></TR>
              </THead>
              <TBody>
                {costs.map((cost) => (
                  <TR key={cost.id}>
                    <TD className="font-medium">{cost.description}</TD>
                    <TD className="capitalize text-[var(--color-text-secondary)]">{cost.costType.replace(/_/g, ' ')}</TD>
                    <TD className="text-[var(--color-text-secondary)]">{cost.invoiceNumber ?? '—'}</TD>
                    <TD alignment="end">{formatDate(cost.incurredOn, { locale, style: 'short' })}</TD>
                    <TD alignment="end" numeric className="font-medium">{currency(cost.amount)}</TD>
                    <TD alignment="end" numeric className="text-[var(--color-text-secondary)]">{currency(cost.vatAmount)}</TD>
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
