import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Building2, FileSignature, MapPin, Pencil, User } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DetailList, DetailRow, MetaItem, PageHeader } from '@/components/ui/page';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/misc';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { SignContractButton } from '@/features/contracts/sign-contract-button';
import { can, requirePermission } from '@/lib/auth/guard';
import { formatArea, formatCurrency, formatDate } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { EntityDocuments } from '@/features/documents/entity-documents';
import { getContractDetail } from '@/services/contract-service';
import { isUuid } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Contract' };

export default async function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('contracts:view');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const locale = await getRequestLocale();

  const data = await getContractDetail(user.organizationId, id);
  if (!data) notFound();
  const { contract, schedule, invoices } = data;
  const currency = (value: number | string | null) => formatCurrency(Number(value ?? 0), { locale });

  const totalBilled = invoices.reduce((sum, i) => sum + Number(i.totalAmount), 0);
  const totalCollected = invoices.reduce((sum, i) => sum + Number(i.paidAmount), 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Contracts', href: '/contracts' }, { label: contract.contractNumber }]}
        title={contract.contractNumber}
        badge={<StatusBadge status={contract.status} size="md" />}
        meta={
          <>
            <MetaItem icon={<User />}>{contract.tenantName}</MetaItem>
            <MetaItem icon={<Building2 />}>{contract.propertyName}</MetaItem>
            <MetaItem icon={<MapPin />}>Unit {contract.unitNumber}</MetaItem>
            {contract.ejarReference ? <span className="text-[var(--color-text-tertiary)]">Ejar: {contract.ejarReference}</span> : null}
          </>
        }
        actions={
          can(user, 'contracts:edit') && (contract.status === 'draft' || contract.status === 'issued' || contract.status === 'pending_approval') ? (
            <>
              <Button variant="secondary" asChild>
                <Link href={`/contracts/${id}/edit`}>
                  <Pencil />
                  Edit Contract
                </Link>
              </Button>
              <SignContractButton contractId={id} />
            </>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Contract Terms" />
          <CardBody className="pt-0">
            <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
              <DetailList>
                <DetailRow label="Tenant" value={contract.tenantName} href={`/tenants?search=${encodeURIComponent(contract.tenantName)}`} />
                <DetailRow label="Lessor" value={contract.lessorName} />
                <DetailRow label="Property" value={contract.propertyName} href={`/properties/${contract.propertyId}`} />
                <DetailRow label="Unit" value={contract.unitNumber} href={`/units/${contract.unitId}`} />
                <DetailRow label="Leasable Area" value={contract.leasableArea ? formatArea(Number(contract.leasableArea), { locale }) : '—'} />
                <DetailRow label="Start Date" value={formatDate(contract.startDate, { locale })} />
                <DetailRow label="End Date" value={formatDate(contract.endDate, { locale })} />
                <DetailRow label="Duration" value={`${contract.durationMonths} months`} />
              </DetailList>
              <DetailList>
                <DetailRow label="Annual Rent" value={<span className="text-[15px] font-semibold">{currency(contract.annualRent)}</span>} />
                <DetailRow label="Rent / m²" value={contract.rentPerSqm ? currency(contract.rentPerSqm) : '—'} />
                <DetailRow label="Payment Frequency" value={<span className="capitalize">{contract.paymentFrequency.replace(/_/g, '-')}</span>} />
                <DetailRow label="Deposit" value={currency(contract.depositAmount)} />
                <DetailRow label="Service Charges" value={currency(contract.serviceCharges)} />
                <DetailRow label="VAT" value={`${(contract.vatRateBps / 100).toFixed(0)}%`} />
                <DetailRow label="Escalation" value={`${Number(contract.escalationPercent)}%`} />
                <DetailRow label="Grace Period" value={`${contract.gracePeriodDays} days`} />
              </DetailList>
            </div>
            {contract.specialConditions ? (
              <div className="mt-4 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)] p-3">
                <p className="text-[11.5px] font-semibold text-[var(--color-text-secondary)]">Special Conditions</p>
                <p className="mt-1 text-[12.5px] text-[var(--color-text-primary)]">{contract.specialConditions}</p>
              </div>
            ) : null}
          </CardBody>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Collection Summary" />
            <CardBody className="pt-0">
              <DetailList>
                <DetailRow label="Total Billed" value={currency(totalBilled)} />
                <DetailRow label="Total Collected" value={<span className="text-[var(--color-success)]">{currency(totalCollected)}</span>} />
                <DetailRow
                  label="Outstanding"
                  value={<span className={totalBilled - totalCollected > 0 ? 'text-[var(--color-error)]' : ''}>{currency(totalBilled - totalCollected)}</span>}
                />
                <DetailRow label="Collection Rate" value={`${totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 100) : 0}%`} />
                <DetailRow label="Instalments" value={schedule.length} />
              </DetailList>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Ejar Registration" />
            <CardBody className="pt-0">
              <DetailList>
                <DetailRow label="Ejar Reference" value={contract.ejarReference ?? 'Not submitted'} />
                <DetailRow label="Ejar Status" value={<StatusBadge status={contract.ejarStatus === 'registered' ? 'active' : 'draft'} label={contract.ejarStatus.replace(/_/g, ' ')} dot={false} />} />
              </DetailList>
              <p className="mt-2 text-[11px] text-[var(--color-text-tertiary)]">
                Ejar integration activates once government API credentials are configured.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader title="Payment Schedule & Invoices" description={`${schedule.length} scheduled instalments`} />
        {schedule.length === 0 ? (
          <EmptyState
            icon={<FileSignature />}
            title="No payment schedule"
            description="Sign the contract to generate the payment schedule and invoices."
          />
        ) : (
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH className="w-10">#</TH>
                  <TH>Period</TH>
                  <TH alignment="end">Invoice Date</TH>
                  <TH alignment="end">Due Date</TH>
                  <TH alignment="end">Rent</TH>
                  <TH alignment="end">VAT</TH>
                  <TH alignment="end">Total</TH>
                  <TH alignment="center">Invoice</TH>
                </TR>
              </THead>
              <TBody>
                {schedule.map((installment) => {
                  const invoice = invoices.find(
                    (i) => i.dueDate === installment.dueDate,
                  );
                  return (
                    <TR key={installment.id}>
                      <TD className="text-[var(--color-text-tertiary)]">{installment.installmentNumber}</TD>
                      <TD className="whitespace-nowrap text-[var(--color-text-secondary)]">
                        {formatDate(installment.periodStart, { locale, style: 'short' })} – {formatDate(installment.periodEnd, { locale, style: 'short' })}
                      </TD>
                      <TD alignment="end" className="whitespace-nowrap">{formatDate(installment.invoiceDate, { locale, style: 'short' })}</TD>
                      <TD alignment="end" className="whitespace-nowrap">{formatDate(installment.dueDate, { locale, style: 'short' })}</TD>
                      <TD alignment="end" numeric>{currency(installment.rentAmount)}</TD>
                      <TD alignment="end" numeric className="text-[var(--color-text-secondary)]">{currency(installment.vatAmount)}</TD>
                      <TD alignment="end" numeric className="font-medium">{currency(installment.totalAmount)}</TD>
                      <TD alignment="center">
                        {invoice ? (
                          <Link href={`/collections/invoices/${invoice.id}`}>
                            <StatusBadge status={invoice.status} />
                          </Link>
                        ) : (
                          <span className="text-[11px] text-[var(--color-text-tertiary)]">Upcoming</span>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableContainer>
        )}
      </Card>
      <EntityDocuments user={user} entityType="contract" entityId={id} locale={locale} />
    </div>
  );
}
