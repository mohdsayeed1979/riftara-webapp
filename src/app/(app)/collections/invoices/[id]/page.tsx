import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Building2, FileText, MapPin, User } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DetailList, DetailRow, MetaItem, PageHeader } from '@/components/ui/page';
import { StatusBadge } from '@/components/ui/status-badge';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/misc';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { RecordPaymentButton } from '@/features/collections/record-payment-button';
import { LogCollectionActionButton } from '@/features/collections/log-collection-action';
import { can, requirePermission } from '@/lib/auth/guard';
import { formatCurrency, formatDate } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { isUuid } from '@/lib/utils';
import { getInvoiceDetail } from '@/services/collection-service';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Invoice' };

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('collections:view');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const locale = await getRequestLocale();

  const data = await getInvoiceDetail(user.organizationId, id);
  if (!data) notFound();
  const { invoice, allocations, actions } = data;
  const money = (value: number) => formatCurrency(value, { locale });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Collections', href: '/collections' }, { label: invoice.invoiceNumber }]}
        title={invoice.invoiceNumber}
        badge={<StatusBadge status={invoice.status} size="md" />}
        meta={
          <>
            <MetaItem icon={<User />}>{invoice.tenantName}</MetaItem>
            <MetaItem icon={<Building2 />}>{invoice.propertyName}</MetaItem>
            <MetaItem icon={<MapPin />}>Unit {invoice.unitNumber}</MetaItem>
            {invoice.daysOverdue > 0 ? (
              <Badge tone={invoice.daysOverdue > 90 ? 'error' : 'warning'} size="sm">
                {invoice.daysOverdue} days overdue
              </Badge>
            ) : null}
          </>
        }
        actions={
          <>
            {can(user, 'collections:edit') && invoice.balanceAmount > 0 ? (
              <LogCollectionActionButton
                tenantId={invoice.tenantId}
                invoiceId={invoice.id}
                outstandingAmount={invoice.balanceAmount}
                daysOverdue={invoice.daysOverdue}
              />
            ) : null}
            {can(user, 'collections:create') && invoice.balanceAmount > 0 ? (
              <RecordPaymentButton defaultTenantId={invoice.tenantId} invoiceId={invoice.id} invoiceLabel={invoice.invoiceNumber} />
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Invoice" />
          <CardBody className="pt-0">
            <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
              <DetailList>
                <DetailRow label="Tenant" value={invoice.tenantName} href={`/collections/tenants/${invoice.tenantId}/ledger`} />
                <DetailRow label="Customer" value={invoice.customerName} />
                <DetailRow label="Property" value={invoice.propertyName} href={`/properties/${invoice.propertyId}`} />
                <DetailRow label="Unit" value={invoice.unitNumber} href={`/units/${invoice.unitId}`} />
                <DetailRow label="Contract" value={invoice.contractNumber} href={`/contracts/${invoice.contractId}`} />
              </DetailList>
              <DetailList>
                <DetailRow label="Invoice Date" value={formatDate(invoice.invoiceDate, { locale })} />
                <DetailRow label="Due Date" value={formatDate(invoice.dueDate, { locale })} />
                <DetailRow
                  label="Period"
                  value={invoice.periodStart && invoice.periodEnd ? `${formatDate(invoice.periodStart, { locale, style: 'short' })} – ${formatDate(invoice.periodEnd, { locale, style: 'short' })}` : '—'}
                />
                <DetailRow label="Status" value={<StatusBadge status={invoice.status} />} />
              </DetailList>
            </div>

            <div className="mt-4 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)] p-3">
              <DetailList>
                <DetailRow label="Rent" value={money(invoice.rentAmount)} />
                <DetailRow label="Service Charges" value={money(invoice.serviceChargeAmount)} />
                <DetailRow label="VAT" value={money(invoice.vatAmount)} />
                {invoice.otherChargesAmount > 0 ? <DetailRow label="Other Charges" value={money(invoice.otherChargesAmount)} /> : null}
                <DetailRow label="Total" value={<span className="text-[15px] font-semibold">{money(invoice.totalAmount)}</span>} />
              </DetailList>
            </div>
          </CardBody>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Balance" />
            <CardBody className="pt-0">
              <DetailList>
                <DetailRow label="Total" value={money(invoice.totalAmount)} />
                <DetailRow label="Paid" value={<span className="text-[var(--color-success)]">{money(invoice.paidAmount)}</span>} />
                <DetailRow
                  label="Outstanding"
                  value={<span className={invoice.balanceAmount > 0 ? 'text-[15px] font-semibold text-[var(--color-error)]' : 'text-[15px] font-semibold'}>{money(invoice.balanceAmount)}</span>}
                />
              </DetailList>
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader title="Payment Allocations" description="Payments matched to this invoice" />
        {allocations.length === 0 ? (
          <EmptyState title="No payments allocated" description="Recorded payments applied to this invoice will appear here." />
        ) : (
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH>Payment #</TH>
                  <TH>Date</TH>
                  <TH>Method</TH>
                  <TH>Reference</TH>
                  <TH alignment="center">Type</TH>
                  <TH alignment="end">Amount</TH>
                </TR>
              </THead>
              <TBody>
                {allocations.map((allocation) => (
                  <TR key={allocation.id}>
                    <TD className="font-medium">{allocation.paymentNumber}</TD>
                    <TD>{formatDate(allocation.paymentDate, { locale, style: 'short' })}</TD>
                    <TD className="capitalize text-[var(--color-text-secondary)]">{allocation.method.replace(/_/g, ' ')}</TD>
                    <TD className="text-[var(--color-text-secondary)]">{allocation.referenceNumber ?? '—'}</TD>
                    <TD alignment="center">
                      <Badge tone="neutral" size="sm">{allocation.allocationMethod}</Badge>
                    </TD>
                    <TD alignment="end" numeric className="font-medium">{money(allocation.amount)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Collection Activity"
          description="Reminders and escalations for this invoice"
          action={
            <Link href={`/collections/tenants/${invoice.tenantId}/ledger`} className="text-[12px] font-medium text-[var(--color-info)] hover:underline">
              <FileText className="mr-1 inline size-3.5" />
              View ledger
            </Link>
          }
        />
        {actions.length === 0 ? (
          <EmptyState title="No collection actions" description="Logged reminders and escalations will appear here." />
        ) : (
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Action</TH>
                  <TH>Outcome</TH>
                  <TH>By</TH>
                  <TH alignment="end">Days Overdue</TH>
                </TR>
              </THead>
              <TBody>
                {actions.map((action) => (
                  <TR key={action.id}>
                    <TD>{formatDate(action.createdAt.toISOString(), { locale, style: 'short' })}</TD>
                    <TD className="capitalize font-medium">{action.actionType.replace(/_/g, ' ')}</TD>
                    <TD className="text-[var(--color-text-secondary)]">{action.outcome ?? action.notes ?? '—'}</TD>
                    <TD className="text-[var(--color-text-secondary)]">{action.performedBy ?? 'System'}</TD>
                    <TD alignment="end">{action.daysOverdue}</TD>
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
