import type { Metadata } from 'next';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { FilterBar } from '@/components/app/filter-bar';
import { EmptyState } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/page';
import { StatusBadge } from '@/components/ui/status-badge';
import { Pagination, Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { requirePermission } from '@/lib/auth/guard';
import { formatCompactCurrency, formatDate } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { listContracts, type ContractListFilters } from '@/services/contract-service';

export const metadata: Metadata = { title: 'Contracts' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission('contracts:view');
  const params = await searchParams;
  const locale = await getRequestLocale();
  const page = Math.max(1, Number(params.page) || 1);
  const allowedPropertyIds = user.scopedPropertyIds.length ? user.scopedPropertyIds : null;

  const filters: ContractListFilters = {
    organizationId: user.organizationId,
    allowedPropertyIds,
    propertyId: params.propertyId,
    status: params.status,
    search: params.search,
    expiringWithinDays: params.expiringWithinDays ? Number(params.expiringWithinDays) : undefined,
    page,
    pageSize: PAGE_SIZE,
  };

  const { items, total } = await listContracts(filters);

  const buildHref = (targetPage: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== 'page') query.set(key, value);
    }
    query.set('page', String(targetPage));
    return `/contracts?${query.toString()}`;
  };

  const expiringFilter = params.expiringWithinDays;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Contracts"
        subtitle="Lease contracts across the portfolio, from draft to renewal."
      />

      {expiringFilter ? (
        <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-warning-border)] bg-[var(--color-warning-soft)] px-3.5 py-2 text-[12.5px] text-[#b97a08]">
          Showing contracts expiring within {expiringFilter} days.
          <Link href="/contracts" className="font-medium underline">
            Clear
          </Link>
        </div>
      ) : null}

      <FilterBar
        searchPlaceholder="Search by contract number, Ejar reference or tenant..."
        filters={[
          {
            key: 'status',
            placeholder: 'All Statuses',
            options: [
              { value: 'active', label: 'Active' },
              { value: 'signed', label: 'Signed' },
              { value: 'draft', label: 'Draft' },
              { value: 'pending_approval', label: 'Pending Approval' },
              { value: 'expired', label: 'Expired' },
              { value: 'terminated', label: 'Terminated' },
              { value: 'renewal_pending', label: 'Renewal Pending' },
            ],
          },
        ]}
      />

      <Card>
        {items.length === 0 ? (
          <EmptyState icon={<FileText />} title="No contracts found" description="Contracts will appear here as leases are created." />
        ) : (
          <>
            <TableContainer>
              <Table>
                <THead>
                  <TR>
                    <TH>Contract</TH>
                    <TH>Tenant</TH>
                    <TH>Property / Unit</TH>
                    <TH alignment="end">Start</TH>
                    <TH alignment="end">End</TH>
                    <TH alignment="end">Annual Rent</TH>
                    <TH>Frequency</TH>
                    <TH alignment="center">Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {items.map((contract) => (
                    <TR key={contract.id} interactive>
                      <TD>
                        <Link href={`/contracts/${contract.id}`} className="font-medium hover:text-[var(--color-info)]">
                          {contract.contractNumber}
                        </Link>
                        {contract.ejarReference ? (
                          <span className="block text-[11px] text-[var(--color-text-tertiary)]">
                            Ejar: {contract.ejarReference}
                          </span>
                        ) : null}
                      </TD>
                      <TD className="text-[var(--color-text-secondary)]">{contract.tenantName}</TD>
                      <TD className="text-[var(--color-text-secondary)]">
                        {contract.propertyName}
                        <span className="block text-[11px] text-[var(--color-text-tertiary)]">
                          Unit {contract.unitNumber}
                        </span>
                      </TD>
                      <TD alignment="end" className="whitespace-nowrap">{formatDate(contract.startDate, { locale, style: 'short' })}</TD>
                      <TD alignment="end" className="whitespace-nowrap">
                        {formatDate(contract.endDate, { locale, style: 'short' })}
                        {contract.status === 'active' && contract.daysToExpiry <= 90 && contract.daysToExpiry >= 0 ? (
                          <Badge tone={contract.daysToExpiry <= 30 ? 'error' : 'warning'} size="sm" className="ms-1.5">
                            {contract.daysToExpiry}d
                          </Badge>
                        ) : null}
                      </TD>
                      <TD alignment="end" numeric>{formatCompactCurrency(contract.annualRent, { locale })}</TD>
                      <TD className="text-[var(--color-text-secondary)] capitalize">{contract.paymentFrequency.replace(/_/g, '-')}</TD>
                      <TD alignment="center"><StatusBadge status={contract.status} /></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} buildHref={buildHref} />
          </>
        )}
      </Card>
    </div>
  );
}
