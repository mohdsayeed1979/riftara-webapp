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
        title="Units"
        subtitle="Unit inventory, availability and pricing across the portfolio."
        actions={
          <>
            {can(user, 'units:create') ? (
              <Button asChild>
                <Link href="/units/new">
                  <Plus />
                  Add Unit
                </Link>
              </Button>
            ) : null}
            {can(user, 'units:export') ? (
              <Button variant="secondary" asChild>
                <a href={`/api/v1/units/export?${new URLSearchParams(params as Record<string, string>).toString()}`}>
                  <Download />
                  Export
                </a>
              </Button>
            ) : null}
          </>
        }
      />

      <KpiGrid columns={5}>
        <KpiCard label="Total Units" value={counts.total.toLocaleString()} icon={<LayoutGrid />} tone="neutral" href="/units" />
        <KpiCard
          label="Available"
          value={counts.available.toLocaleString()}
          caption="Ready for lease"
          icon={<KeyRound />}
          tone="success"
          href="/units?availability=available"
        />
        <KpiCard
          label="Reserved"
          value={counts.reserved.toLocaleString()}
          caption="Under negotiation"
          icon={<Clock />}
          tone="warning"
          href="/units?availability=reserved"
        />
        <KpiCard
          label="Leased"
          value={counts.leased.toLocaleString()}
          caption="Contracted / Active"
          icon={<FileText />}
          tone="info"
          href="/units?availability=leased"
        />
        <KpiCard
          label="Not Available"
          value={counts.notAvailable.toLocaleString()}
          caption="Off-market / Services"
          icon={<Ban />}
          tone="neutral"
          href="/units?availability=not_available"
        />
      </KpiGrid>

      <FilterBar
        searchPlaceholder="Search units by number or code..."
        filters={[
          {
            key: 'propertyId',
            placeholder: 'All Properties',
            options: options.properties.map((p) => ({ value: p.id, label: p.name })),
          },
          {
            key: 'typeId',
            placeholder: 'All Types',
            options: options.types.map((t) => ({ value: t.id, label: t.name })),
          },
          {
            key: 'availability',
            placeholder: 'All Availability',
            options: [
              { value: 'available', label: 'Available' },
              { value: 'reserved', label: 'Reserved' },
              { value: 'leased', label: 'Leased' },
              { value: 'not_available', label: 'Not Available' },
            ],
          },
          {
            key: 'status',
            placeholder: 'All Statuses',
            options: options.statuses.map((s) => ({ value: s.key, label: s.name })),
          },
        ]}
      />

      <Card>
        {items.length === 0 ? (
          <EmptyState
            icon={<LayoutGrid />}
            title="No units found"
            description="Try adjusting your filters, or add a unit to the inventory."
            action={
              can(user, 'units:create') ? (
                <Button asChild>
                  <Link href="/units/new">
                    <Plus />
                    Add Unit
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
                    <TH>Unit</TH>
                    <TH>Property</TH>
                    <TH>Type</TH>
                    <TH alignment="end">Area</TH>
                    <TH alignment="end">Annual Rent</TH>
                    <TH alignment="end">Rent / m²</TH>
                    <TH>Tenant</TH>
                    <TH alignment="end">Available From</TH>
                    <TH alignment="center">Status</TH>
                    <TH alignment="end">Actions</TH>
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
                          ? 'Now'
                          : unit.availableFrom
                            ? formatDate(unit.availableFrom, { locale, style: 'short' })
                            : '—'}
                      </TD>
                      <TD alignment="center">
                        <StatusBadge status={unit.statusKey} label={unit.statusLabel} />
                      </TD>
                      <TD alignment="end" className="whitespace-nowrap">
                        <Link href={`/units/${unit.id}`} className="text-[12px] font-medium text-[var(--color-info)] hover:underline">
                          View
                        </Link>
                        {can(user, 'units:edit') ? (
                          <Link href={`/units/${unit.id}/edit`} className="ms-3 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                            <Pencil className="size-3" />
                            Edit
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
