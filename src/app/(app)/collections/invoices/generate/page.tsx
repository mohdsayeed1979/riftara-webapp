import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermission } from '@/lib/auth/guard';
import { Card, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page';
import { EmptyState } from '@/components/ui/misc';
import { Badge } from '@/components/ui/badge';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { GenerateDueButton, GenerateInvoiceButton } from '@/features/collections/generate-invoices';
import { formatCurrency, formatDate } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { daysOverdue } from '@/lib/calculations/finance';
import { listPendingSchedules } from '@/services/collection-service';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Generate Invoices' };

export default async function GenerateInvoicesPage() {
  const user = await requirePermission('collections:create');
  const locale = await getRequestLocale();
  const allowedPropertyIds = user.scopedPropertyIds.length ? user.scopedPropertyIds : null;

  const pending = await listPendingSchedules(user.organizationId, { allowedPropertyIds, limit: 200 });
  const now = new Date();
  const dueCount = pending.filter((row) => daysOverdue(new Date(row.invoiceDate), now) >= 0).length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Collections', href: '/collections' }, { label: 'Generate Invoices' }]}
        title="Generate Invoices"
        subtitle="Create invoices from authoritative contract payment schedules. Amounts come from the schedule — never entered manually."
        actions={<GenerateDueButton />}
      />

      <Card>
        <CardHeader
          title="Pending Installments"
          description={`${pending.length} un-invoiced installment(s) · ${dueCount} due now`}
        />
        {pending.length === 0 ? (
          <EmptyState title="Nothing to invoice" description="Every installment on signed and active contracts has an invoice." />
        ) : (
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH>Contract</TH>
                  <TH>Tenant</TH>
                  <TH>Property</TH>
                  <TH>Unit</TH>
                  <TH alignment="center">Installment</TH>
                  <TH alignment="end">Invoice Date</TH>
                  <TH alignment="end">Due Date</TH>
                  <TH alignment="end">Amount</TH>
                  <TH alignment="center">Status</TH>
                  <TH alignment="end">Action</TH>
                </TR>
              </THead>
              <TBody>
                {pending.map((row) => {
                  const isDue = daysOverdue(new Date(row.invoiceDate), now) >= 0;
                  return (
                    <TR key={row.scheduleId}>
                      <TD>
                        <Link href={`/contracts/${row.contractId}`} className="font-medium hover:text-[var(--color-info)]">
                          {row.contractNumber}
                        </Link>
                      </TD>
                      <TD className="text-[var(--color-text-secondary)]">{row.tenantName}</TD>
                      <TD className="text-[var(--color-text-secondary)]">{row.propertyName}</TD>
                      <TD className="text-[var(--color-text-secondary)]">{row.unitNumber}</TD>
                      <TD alignment="center">{row.installmentNumber}</TD>
                      <TD alignment="end" className="whitespace-nowrap">{formatDate(row.invoiceDate, { locale, style: 'short' })}</TD>
                      <TD alignment="end" className="whitespace-nowrap">{formatDate(row.dueDate, { locale, style: 'short' })}</TD>
                      <TD alignment="end" numeric className="font-medium">{formatCurrency(row.totalAmount, { locale })}</TD>
                      <TD alignment="center">
                        <Badge tone={isDue ? 'warning' : 'neutral'} size="sm">{isDue ? 'Due' : 'Scheduled'}</Badge>
                      </TD>
                      <TD alignment="end">
                        <GenerateInvoiceButton scheduleId={row.scheduleId} />
                      </TD>
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
