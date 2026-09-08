import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Download, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { KpiGrid, MetaItem, PageHeader } from '@/components/ui/page';
import { EmptyState } from '@/components/ui/misc';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { RecordPaymentButton } from '@/features/collections/record-payment-button';
import { LogCollectionActionButton } from '@/features/collections/log-collection-action';
import { can, requirePermission } from '@/lib/auth/guard';
import { formatCurrency, formatDate } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { isUuid } from '@/lib/utils';
import { getTenantLedger, getTenantReceivables } from '@/services/collection-service';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Tenant Ledger' };

export default async function TenantLedgerPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const user = await requirePermission('collections:view');
  const { tenantId } = await params;
  if (!isUuid(tenantId)) notFound();
  const locale = await getRequestLocale();

  let ledger;
  try {
    ledger = await getTenantLedger(user.organizationId, tenantId);
  } catch {
    notFound();
  }
  const receivables = await getTenantReceivables(user.organizationId, tenantId);
  const money = (value: number) => formatCurrency(value, { locale });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Collections', href: '/collections' }, { label: ledger.tenant.displayName }]}
        title={ledger.tenant.displayName}
        meta={<MetaItem icon={<User />}>Statement of account</MetaItem>}
        actions={
          <>
            {can(user, 'collections:export') ? (
              <Button variant="secondary" asChild>
                <a href={`/api/v1/collections/statements/${tenantId}/export?format=csv`}>
                  <Download />
                  Export Statement
                </a>
              </Button>
            ) : null}
            {can(user, 'collections:edit') && receivables.outstanding > 0 ? (
              <LogCollectionActionButton
                tenantId={tenantId}
                outstandingAmount={receivables.outstanding}
                daysOverdue={0}
              />
            ) : null}
            {can(user, 'collections:create') ? (
              <RecordPaymentButton defaultTenantId={tenantId} />
            ) : null}
          </>
        }
      />

      <KpiGrid columns={4}>
        <KpiCard label="Total Invoiced" value={money(receivables.totalInvoiced)} tone="neutral" />
        <KpiCard label="Total Paid" value={money(receivables.totalPaid)} tone="success" />
        <KpiCard label="Outstanding" value={money(receivables.outstanding)} tone="warning" higherIsBetter={false} caption={`${receivables.openInvoiceCount} open invoices`} />
        <KpiCard label="Overdue" value={money(receivables.overdue)} tone="error" higherIsBetter={false} />
      </KpiGrid>

      <Card>
        <CardHeader
          title="Ledger"
          description={`Current balance: ${money(ledger.currentBalance)}`}
        />
        {ledger.entries.length === 0 ? (
          <EmptyState title="No ledger entries" description="Invoices and payments will appear here." />
        ) : (
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Type</TH>
                  <TH>Description</TH>
                  <TH alignment="end">Charge</TH>
                  <TH alignment="end">Payment</TH>
                  <TH alignment="end">Balance</TH>
                </TR>
              </THead>
              <TBody>
                {ledger.entries.map((entry) => (
                  <TR key={entry.id}>
                    <TD className="whitespace-nowrap">{formatDate(entry.entryDate, { locale, style: 'short' })}</TD>
                    <TD className="capitalize text-[var(--color-text-secondary)]">{entry.entryType.replace(/_/g, ' ')}</TD>
                    <TD>{entry.description}</TD>
                    <TD alignment="end" numeric>{Number(entry.debitAmount) > 0 ? money(Number(entry.debitAmount)) : '—'}</TD>
                    <TD alignment="end" numeric className="text-[var(--color-success)]">{Number(entry.creditAmount) > 0 ? money(Number(entry.creditAmount)) : '—'}</TD>
                    <TD alignment="end" numeric className="font-medium">{money(Number(entry.runningBalance))}</TD>
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
