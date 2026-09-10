import type { Metadata } from 'next';
import Link from 'next/link';
import { Ban, Download, FileText, KeyRound, LayoutGrid, Clock, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FilterBar } from '@/components/app/filter-bar';
import { KpiCard } from '@/components/ui/kpi-card';
import { EmptyState } from '@/components/ui/misc';
import { KpiGrid, PageHeader } from '@/components/ui/page';
import { StatusBadge } from '@/components/ui/status-badge';
import { Pagination, Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { can, requirePermission } from '@/lib/auth/guard';
import { formatArea, formatCompactCurrency, formatCurrency, formatDate } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { getMessages } from '@/i18n';
import {
  getUnitAvailabilityCounts,
  getUnitFilterOptions,
  listUnits,
  type UnitListFilters,
} from '@/services/unit-service';

export const metadata: Metadata = { title: 'Units' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

export default async function UnitsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission('units:view');
  const params = await searchParams;
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  const t = m.units;
  const dd = m.dashboard;
  const page = Math.max(1, Number(params.page) || 1);
  const allowedPropertyIds = user.scopedPropertyIds.length ? user.scopedPropertyIds : null;

  const filters: UnitListFilters = {
    organizationId: user.organizationId,
    allowedPropertyIds,
    search: params.search,
    propertyId: params.propertyId,
    unitTypeId: params.typeId,
    statusKey: params.status,
    availability: params.availability,
    sort: (params.sort as UnitListFilters['sort']) ?? 'code',
    page,
    pageSize: PAGE_SIZE,
  };

  const [{ items, total }, counts, options] = await Promise.all([
    listUnits(filters),
    getUnitAvailabilityCounts(user.organizationId, allowedPropertyIds),
    getUnitFilterOptions(user.organizationId),
  ]);

  const buildHref = (targetPage: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== 'page') query.set(key, value);
    }
    query.set('page', String(targetPage));
    return `/units?${query.toString()}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <>
            {can(user, 'units:create') ? (
              <Button asChild>
                <Link href="/units/new">
                  <Plus />
                  {t.addUnit}
                </Link>
              </Button>
            ) : null}
            {can(user, 'units:export') ? (
              <Button variant="secondary" asChild>
                <a href={`/api/v1/units/export?${new URLSearchParams(params as Record<string, string>).toString()}`}>
                  <Download />
                  {m.common.export}
                </a>
              </Button>
            ) : null}
          </>
        }
      />

      <KpiGrid columns={5}>
        <KpiCard label={dd.totalUnits} value={counts.total.toLocaleString()} icon={<LayoutGrid />} tone="neutral" href="/units" />
        <KpiCard
          label={dd.available}
          value={counts.available.toLocaleString()}
          caption={dd.readyForLease}
          icon={<KeyRound />}
          tone="success"
          href="/units?availability=available"
        />
        <KpiCard
          label={dd.reserved}
          value={counts.reserved.toLocaleString()}
          caption={dd.underNegotiation}
          icon={<Clock />}
          tone="warning"
          href="/units?availability=reserved"
        />
        <KpiCard
          label={dd.leased}
          value={counts.leased.toLocaleString()}
          caption={dd.contractedActive}
          icon={<FileText />}
          tone="info"
          href="/units?availability=leased"
        />
        <KpiCard
          label={dd.notAvailable}
          value={counts.notAvailable.toLocaleString()}
          caption={dd.offMarketServices}
          icon={<Ban />}
          tone="neutral"
          href="/units?availability=not_available"
        />
      </KpiGrid>

      <FilterBar
        searchPlaceholder={t.searchPlaceholder}
        filters={[
          {
            key: 'propertyId',
            placeholder: t.allProperties,
            options: options.properties.map((p) => ({ value: p.id, label: p.name })),
          },
          {
            key: 'typeId',
            placeholder: t.allTypes,
            options: options.types.map((ty) => ({ value: ty.id, label: ty.name })),
          },
          {
            key: 'availability',
            placeholder: t.allAvailability,
            options: [
              { value: 'available', label: m.common.statuses.available },
              { value: 'reserved', label: m.common.statuses.reserved },
              { value: 'leased', label: m.common.statuses.leased },
              { value: 'not_available', label: m.common.statuses.not_available },
            ],
          },
          {
            key: 'status',
            placeholder: t.allStatuses,
            options: options.statuses.map((s) => ({ value: s.key, label: s.name })),
          },
        ]}
      />

      <Card>
        {items.length === 0 ? (
          <EmptyState
            icon={<LayoutGrid />}
            title={t.noResultsTitle}
            description={t.noResultsHint}
            action={
              can(user, 'units:create') ? (
                <Button asChild>
                  <Link href="/units/new">
                    <Plus />
                    {t.addUnit}
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
                    <TH>{t.unit}</TH>
                    <TH>{m.properties.property}</TH>
                    <TH>{t.unitType}</TH>
                    <TH alignment="end">{t.area}</TH>
                    <TH alignment="end">{t.annualRent}</TH>
                    <TH alignment="end">{t.rentPerSqmCol}</TH>
                    <TH>{t.tenant}</TH>
                    <TH alignment="end">{t.availableFrom}</TH>
                    <TH alignment="center">{m.common.status}</TH>
                    <TH alignment="end">{m.common.actions}</TH>
                  </TR>
                </THead>
                <TBody>
                  {items.map((unit) => (
                    <TR key={unit.id} interactive>
                      <TD>
                        <Link
                          href={`/units/${unit.id}`}
                          className="font-medium text-[var(--color-text-primary)] hover:text-[var(--color-info)]"
                        >
                          {unit.unitNumber}
                        </Link>
                        <span className="block text-[11px] text-[var(--color-text-tertiary)]">
                          {unit.floorName ?? unit.code}
                        </span>
                      </TD>
                      <TD className="text-[var(--color-text-secondary)]">{unit.propertyName}</TD>
                      <TD className="text-[var(--color-text-secondary)]">{unit.typeName}</TD>
                      <TD alignment="end" numeric>
                        {formatArea(unit.leasableArea, { locale })}
                      </TD>
                      <TD alignment="end" numeric>
                        {formatCompactCurrency(unit.askingRent, { locale })}
                      </TD>
                      <TD alignment="end" numeric className="text-[var(--color-text-secondary)]">
                        {formatCurrency(unit.rentPerSqm, { locale })}
                      </TD>
                      <TD className="text-[var(--color-text-secondary)]">{unit.tenantName ?? '—'}</TD>
                      <TD alignment="end" className="whitespace-nowrap text-[var(--color-text-secondary)]">
                        {unit.availabilityClass === 'available'
                          ? t.now
                          : unit.availableFrom
                            ? formatDate(unit.availableFrom, { locale, style: 'short' })
                            : '—'}
                      </TD>
                      <TD alignment="center">
                        <StatusBadge status={unit.statusKey} label={locale === 'ar' ? undefined : unit.statusLabel} />
                      </TD>
                      <TD alignment="end" className="whitespace-nowrap">
                        <Link href={`/units/${unit.id}`} className="text-[12px] font-medium text-[var(--color-info)] hover:underline">
                          {t.view}
                        </Link>
                        {can(user, 'units:edit') ? (
                          <Link href={`/units/${unit.id}/edit`} className="ms-3 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                            <Pencil className="size-3" />
                            {m.common.edit}
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
