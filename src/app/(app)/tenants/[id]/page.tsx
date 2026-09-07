import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { Briefcase, Pencil, User } from 'lucide-react';
import { getDb } from '@/db/client';
import { collectionActions, contracts, customers, properties, tenants, units, users } from '@/db/schema';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';
import { DetailList, DetailRow, MetaItem, PageHeader } from '@/components/ui/page';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { RecordPaymentButton } from '@/features/collections/record-payment-button';
import { can, requirePermission } from '@/lib/auth/guard';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { getTenantLedger } from '@/services/collection-service';
import { isUuid } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Tenant' };

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('tenants:view');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const locale = await getRequestLocale();
  const db = await getDb();

  const [tenant] = await db
    .select({
      id: tenants.id,
      code: tenants.code,
      displayName: tenants.displayName,
      industry: tenants.industry,
      status: tenants.status,
      creditRating: tenants.creditRating,
      customerId: tenants.customerId,
      customerName: customers.fullNameEn,
      mobile: customers.mobile,
      email: customers.email,
      accountManager: users.fullName,
    })
    .from(tenants)
    .innerJoin(customers, eq(customers.id, tenants.customerId))
    .leftJoin(users, eq(users.id, tenants.accountManagerId))
    .where(and(eq(tenants.id, id), eq(tenants.organizationId, user.organizationId)))
    .limit(1);
  if (!tenant) notFound();

  const [tenantContracts, ledger, actions] = await Promise.all([
    db
      .select({
        id: contracts.id,
        contractNumber: contracts.contractNumber,
        propertyName: properties.nameEn,
        unitNumber: units.unitNumber,
        startDate: contracts.startDate,
        endDate: contracts.endDate,
        annualRent: contracts.annualRent,
        status: contracts.status,
      })
      .from(contracts)
      .innerJoin(properties, eq(properties.id, contracts.propertyId))
      .innerJoin(units, eq(units.id, contracts.unitId))
      .where(eq(contracts.tenantId, id))
      .orderBy(desc(contracts.startDate)),
    getTenantLedger(user.organizationId, id),
    db
      .select()
      .from(collectionActions)
      .where(eq(collectionActions.tenantId, id))
      .orderBy(desc(collectionActions.createdAt))
      .limit(15),
  ]);

  const currency = (value: number | string | null) => formatCurrency(Number(value ?? 0), { locale });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Tenants', href: '/tenants' }, { label: tenant.displayName }]}
        title={tenant.displayName}
        badge={<StatusBadge status={tenant.status} size="md" />}
        meta={
          <>
            <MetaItem icon={<User />}>{tenant.code}</MetaItem>
            {tenant.industry ? <MetaItem icon={<Briefcase />}>{tenant.industry}</MetaItem> : null}
            {tenant.creditRating ? <span>Credit rating: {tenant.creditRating}</span> : null}
          </>
        }
        actions={
          <>
            {can(user, 'tenants:edit') ? (
              <Button variant="secondary" asChild>
                <Link href={`/tenants/${id}/edit`}>
                  <Pencil />
                  Edit Tenant
                </Link>
              </Button>
            ) : null}
            <Button variant="secondary" asChild>
              <Link href={`/leasing/customers/${tenant.customerId}`}>
                <User />
                Customer 360
              </Link>
            </Button>
            {can(user, 'collections:create') ? <RecordPaymentButton defaultTenantId={id} /> : null}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Tenant Information" />
            <CardBody className="pt-0">
              <DetailList>
                <DetailRow label="Legal Name" value={tenant.customerName} />
                <DetailRow label="Mobile" value={tenant.mobile ?? '—'} />
                <DetailRow label="Email" value={tenant.email ?? '—'} />
                <DetailRow label="Account Manager" value={tenant.accountManager ?? '—'} />
              </DetailList>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Account Balance" />
            <CardBody className="pt-0">
              <p className="text-[26px] font-semibold text-[var(--color-text-primary)] tabular">
                {currency(ledger.currentBalance)}
              </p>
              <p className="text-[12px] text-[var(--color-text-secondary)]">
                {ledger.currentBalance > 0 ? 'Outstanding balance' : 'Account in good standing'}
              </p>
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Contracts" />
            {tenantContracts.length === 0 ? (
              <EmptyState title="No contracts" />
            ) : (
              <TableContainer>
                <Table>
                  <THead>
                    <TR>
                      <TH>Contract</TH>
                      <TH>Property / Unit</TH>
                      <TH alignment="end">Annual Rent</TH>
                      <TH alignment="end">End Date</TH>
                      <TH alignment="center">Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {tenantContracts.map((contract) => (
                      <TR key={contract.id} interactive>
                        <TD>
                          <Link href={`/contracts/${contract.id}`} className="font-medium hover:text-[var(--color-info)]">
                            {contract.contractNumber}
                          </Link>
                        </TD>
                        <TD className="text-[var(--color-text-secondary)]">
                          {contract.propertyName} · {contract.unitNumber}
                        </TD>
                        <TD alignment="end" numeric>{currency(contract.annualRent)}</TD>
                        <TD alignment="end">{formatDate(contract.endDate, { locale, style: 'short' })}</TD>
                        <TD alignment="center"><StatusBadge status={contract.status} /></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableContainer>
            )}
          </Card>

          <Card>
            <CardHeader title="Tenant Ledger" description="Statement of account (append-only)" />
            {ledger.entries.length === 0 ? (
              <EmptyState title="No ledger entries" />
            ) : (
              <TableContainer>
                <Table>
                  <THead>
                    <TR>
                      <TH>Date</TH>
                      <TH>Description</TH>
                      <TH alignment="end">Debit</TH>
                      <TH alignment="end">Credit</TH>
                      <TH alignment="end">Balance</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {ledger.entries.map((entry) => (
                      <TR key={entry.id}>
                        <TD className="whitespace-nowrap text-[var(--color-text-secondary)]">{formatDate(entry.entryDate, { locale, style: 'short' })}</TD>
                        <TD>{entry.description}</TD>
                        <TD alignment="end" numeric className={Number(entry.debitAmount) > 0 ? '' : 'text-[var(--color-text-tertiary)]'}>
                          {Number(entry.debitAmount) > 0 ? currency(entry.debitAmount) : '—'}
                        </TD>
                        <TD alignment="end" numeric className={Number(entry.creditAmount) > 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-text-tertiary)]'}>
                          {Number(entry.creditAmount) > 0 ? currency(entry.creditAmount) : '—'}
                        </TD>
                        <TD alignment="end" numeric className="font-medium">{currency(entry.runningBalance)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableContainer>
            )}
          </Card>

          {actions.length > 0 ? (
            <Card>
              <CardHeader title="Collection Actions" />
              <TableContainer>
                <Table>
                  <THead>
                    <TR><TH>Date</TH><TH>Action</TH><TH alignment="end">Outstanding</TH><TH>Outcome</TH></TR>
                  </THead>
                  <TBody>
                    {actions.map((action) => (
                      <TR key={action.id}>
                        <TD className="whitespace-nowrap text-[var(--color-text-secondary)]">{formatDateTime(action.createdAt, { locale })}</TD>
                        <TD><StatusBadge status={action.actionType} dot={false} /></TD>
                        <TD alignment="end" numeric>{currency(action.outstandingAmount)}</TD>
                        <TD className="text-[var(--color-text-secondary)]">{action.outcome ?? '—'}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableContainer>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
