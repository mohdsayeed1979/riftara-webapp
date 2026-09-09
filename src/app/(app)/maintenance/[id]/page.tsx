import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Building2, Pencil, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';
import { DetailList, DetailRow, MetaItem, PageHeader } from '@/components/ui/page';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { RecordCostButton, WorkOrderStatusActions } from '@/features/maintenance/work-order-actions';
import { can, requirePermission } from '@/lib/auth/guard';
import { isUuid } from '@/lib/utils';
import { formatCurrency, formatDate, formatDateTime, formatDuration } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import {
  getWorkOrderDetail,
  getWorkOrderFormReferenceData,
  getWorkOrderHistory,
  workOrderSlaState,
} from '@/services/maintenance-service';

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
  const canEdit = can(user, 'maintenance:edit');
  const canCreate = can(user, 'maintenance:create');
  const isTerminal = workOrder.status === 'completed' || workOrder.status === 'cancelled';

  const [reference, history] = await Promise.all([
    canEdit && !isTerminal ? getWorkOrderFormReferenceData(user.organizationId) : Promise.resolve(null),
    getWorkOrderHistory(user.organizationId, id),
  ]);

  const sla = workOrderSlaState(
    { createdAt: workOrder.createdAt, resolutionSlaHours: workOrder.resolutionSlaHours, status: workOrder.status, resolutionSlaMet: workOrder.resolutionSlaMet },
  );
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
            {sla.breached && !isTerminal ? <StatusBadge status="overdue" label="SLA breached" dot={false} size="sm" /> : null}
          </>
        }
        actions={
          <>
            {canEdit && !isTerminal ? (
              <Button variant="secondary" asChild>
                <Link href={`/maintenance/${id}/edit`}><Pencil />Edit</Link>
              </Button>
            ) : null}
            {reference ? (
              <WorkOrderStatusActions
                workOrderId={id}
                status={workOrder.status}
                canEdit={canEdit}
                vendors={reference.vendors}
                users={reference.users}
                currentVendorId={workOrder.vendorId}
                currentUserId={workOrder.assignedUserId}
              />
            ) : null}
            {canCreate && !isTerminal ? <RecordCostButton workOrderId={id} /> : null}
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
                <DetailRow label="Tenant" value={workOrder.tenantName ?? '—'} />
              </DetailList>
              <DetailList>
                <DetailRow label="Vendor" value={workOrder.vendorName ?? 'Unassigned'} />
                <DetailRow label="Assigned User" value={workOrder.assignedUserName ?? 'Unassigned'} />
                <DetailRow label="Created" value={formatDateTime(workOrder.createdAt, { locale })} />
                <DetailRow label="Completed" value={workOrder.completedAt ? formatDateTime(workOrder.completedAt, { locale }) : isTerminal ? '—' : 'In progress'} />
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
                    <span className={workOrder.responseSlaMet ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}>{formatDuration(workOrder.actualResponseHours)}</span>
                  ) : ('Pending')
                }
              />
              <DetailRow label="Resolution Target" value={`${workOrder.resolutionSlaHours}h`} />
              <DetailRow label="Due" value={formatDateTime(sla.dueAt, { locale })} />
              {!isTerminal ? (
                <DetailRow
                  label="Remaining"
                  value={
                    sla.breached
                      ? <span className="text-[var(--color-error)]">Overdue by {formatDuration(Math.abs(sla.remainingHours))}</span>
                      : <span>{formatDuration(sla.remainingHours)}</span>
                  }
                />
              ) : (
                <DetailRow
                  label="Actual Resolution"
                  value={
                    workOrder.actualResolutionHours !== null ? (
                      <span className={workOrder.resolutionSlaMet ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}>{formatDuration(workOrder.actualResolutionHours)}</span>
                    ) : ('—')
                  }
                />
              )}
              <DetailRow
                label="SLA Status"
                value={
                  workOrder.status === 'completed' ? (
                    workOrder.resolutionSlaMet === false ? <StatusBadge status="overdue" label="Breached" dot={false} /> : <StatusBadge status="completed" label="Met" dot={false} />
                  ) : workOrder.status === 'cancelled' ? (
                    <span className="text-[var(--color-text-tertiary)]">—</span>
                  ) : sla.breached ? (
                    <StatusBadge status="overdue" label="Breached" dot={false} />
                  ) : (
                    <StatusBadge status="in_progress" label="On track" dot={false} />
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

      <Card>
        <CardHeader title="History" description="Status, assignment and edit history (audit trail)." />
        {history.length === 0 ? (
          <EmptyState title="No history" description="Changes to this work order will appear here." />
        ) : (
          <TableContainer>
            <Table>
              <THead>
                <TR><TH>When</TH><TH>Action</TH><TH>Change</TH><TH>By</TH></TR>
              </THead>
              <TBody>
                {history.map((entry) => {
                  const prev = (entry.previousValue as { status?: string } | null)?.status;
                  const next = (entry.newValue as { status?: string } | null)?.status;
                  const change = prev && next ? `${prev.replace(/_/g, ' ')} → ${next.replace(/_/g, ' ')}` : next ? String(next).replace(/_/g, ' ') : '—';
                  return (
                    <TR key={entry.id}>
                      <TD className="whitespace-nowrap">{formatDateTime(entry.createdAt, { locale })}</TD>
                      <TD className="capitalize">{entry.action.replace(/_/g, ' ')}</TD>
                      <TD className="capitalize text-[var(--color-text-secondary)]">{change}</TD>
                      <TD className="text-[var(--color-text-secondary)]">{entry.actorLabel ?? 'System'}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableContainer>
        )}
      </Card>
    </div>
  );
}
