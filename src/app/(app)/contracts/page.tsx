import type { Metadata } from 'next';
import Link from 'next/link';
import { FileText, Pencil, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FilterBar } from '@/components/app/filter-bar';
import { EmptyState } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/page';
import { StatusBadge } from '@/components/ui/status-badge';
import { Pagination, Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { can, requirePermission } from '@/lib/auth/guard';
import { formatCompactCurrency, formatDate } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { getMessages, interpolate } from '@/i18n';
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
  const m = getMessages(locale);
  const t = m.contracts;
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
        title={t.title}
        subtitle={t.subtitle}
        actions={
          can(user, 'contracts:create') ? (
            <Button asChild>
              <Link href="/contracts/new">
                <Plus />
                {t.createContract}
              </Link>
            </Button>
          ) : undefined
        }
      />

      {expiringFilter ? (
        <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-warning-border)] bg-[var(--color-warning-soft)] px-3.5 py-2 text-[12.5px] text-[#b97a08]">
          {interpolate(t.expiringWithin, { days: expiringFilter })}
          <Link href="/contracts" className="font-medium underline">
            {t.clear}
          </Link>
        </div>
      ) : null}

      <FilterBar
        searchPlaceholder={t.searchPlaceholder}
        filters={[
          {
            key: 'status',
            placeholder: t.allStatuses,
            options: [
              { value: 'active', label: m.common.statuses.active },
              { value: 'signed', label: m.common.statuses.signed },
              { value: 'draft', label: m.common.statuses.draft },
              { value: 'pending_approval', label: m.common.statuses.pending_approval },
              { value: 'expired', label: m.common.statuses.expired },
              { value: 'terminated', label: m.common.statuses.terminated },
              { value: 'renewal_pending', label: m.common.statuses.renewal_pending },
            ],
          },
        ]}
      />

      <Card>
        {items.length === 0 ? (
          <EmptyState
            icon={<FileText />}
            title={t.noContracts}
            description={t.noContractsHint}
            action={
              can(user, 'contracts:create') ? (
                <Button asChild>
                  <Link href="/contracts/new">
                    <Plus />
                    {t.createContract}
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <TableContainer>
              <Table>
                <THead>
                  <TR>
                    <TH>{t.contract}</TH>
                    <TH>{t.tenant}</TH>
                    <TH>{t.propertyUnit}</TH>
                    <TH alignment="end">{t.startDate}</TH>
                    <TH alignment="end">{t.endDate}</TH>
                    <TH alignment="end">{t.annualRent}</TH>
                    <TH>{t.frequency}</TH>
                    <TH alignment="center">{m.common.status}</TH>
                    <TH alignment="end">{m.common.actions}</TH>
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
                      <TD alignment="end" className="whitespace-nowrap">
                        <Link href={`/contracts/${contract.id}`} className="text-[12px] font-medium text-[var(--color-info)] hover:underline">{t.view}</Link>
                        {can(user, 'contracts:edit') && ['draft', 'issued', 'pending_approval'].includes(contract.status) ? (
                          <Link href={`/contracts/${contract.id}/edit`} className="ms-3 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                            <Pencil className="size-3" />{m.common.edit}
                          </Link>
                        ) : null}
                      </TD>
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
