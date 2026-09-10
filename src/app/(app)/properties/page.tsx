import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Building2, Download, KeyRound, MapPin, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FilterBar } from '@/components/app/filter-bar';
import { KpiCard } from '@/components/ui/kpi-card';
import { EmptyState, ProgressRing } from '@/components/ui/misc';
import { KpiGrid, PageHeader } from '@/components/ui/page';
import { PropertyImage } from '@/components/ui/property-image';
import { StatusBadge } from '@/components/ui/status-badge';
import { Pagination, Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { PropertyActions } from '@/features/properties/property-actions';
import { can, requirePermission } from '@/lib/auth/guard';
import { formatCompactCurrency, formatPercent } from '@/lib/format';
import { getRequestLocale, getRequestLocationId } from '@/lib/locale';
import {
  getPropertyFilterOptions,
  listProperties,
  type PropertyListFilters,
} from '@/services/property-service';
import { getPortfolioSummary, scopeFromSession } from '@/services/metrics-service';

export const metadata: Metadata = { title: 'Properties' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 12;

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission('properties:view');
  const params = await searchParams;
  const locale = await getRequestLocale();
  const scopedCity = await getRequestLocationId();

  const view = params.view === 'list' ? 'list' : 'grid';
  const page = Math.max(1, Number(params.page) || 1);

  const filters: PropertyListFilters = {
    organizationId: user.organizationId,
    allowedPropertyIds: user.scopedPropertyIds.length ? user.scopedPropertyIds : null,
    allowedCityIds: user.scopedCityIds.length ? user.scopedCityIds : null,
    search: params.search,
    cityId: params.cityId ?? scopedCity ?? undefined,
    districtId: params.districtId,
    propertyTypeId: params.typeId,
    status: params.status,
    sort: (params.sort as PropertyListFilters['sort']) ?? 'name',
    page,
    pageSize: PAGE_SIZE,
  };

  const scope = scopeFromSession(user, { cityId: scopedCity });
  const [{ items, total }, summary, options] = await Promise.all([
    listProperties(filters),
    getPortfolioSummary(scope),
    getPropertyFilterOptions(user.organizationId, filters.allowedCityIds ?? null),
  ]);

  const money = (value: number) => formatCompactCurrency(value, { locale });
  const canEditProperty = can(user, 'properties:edit');
  const canDeleteProperty = can(user, 'properties:delete');

  const buildHref = (targetPage: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== 'page') query.set(key, value);
    }
    query.set('page', String(targetPage));
    return `/properties?${query.toString()}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Properties"
        subtitle="Browse and manage all properties across your portfolio."
        actions={
          <>
            {can(user, 'properties:export') ? (
              <Button variant="secondary" asChild>
                <a href={`/api/v1/properties/export?${new URLSearchParams(params as Record<string, string>).toString()}`}>
                  <Download />
                  Export
                </a>
              </Button>
            ) : null}
            <Button variant="secondary" asChild>
              <Link href="/properties/map">
                <MapPin />
                Map View
              </Link>
            </Button>
            {can(user, 'properties:create') ? (
              <Button asChild>
                <Link href="/properties/new">
                  <Plus />
                  Add Property
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <KpiGrid columns={5}>
        <KpiCard
          label="Total Properties"
          value={summary.propertyCount.toLocaleString()}
          caption={`Across ${options.cities.length} cities`}
          icon={<Building2 />}
          tone="neutral"
        />
        <KpiCard
          label="Occupied Units"
          value={summary.occupiedUnits.toLocaleString()}
          caption={`${formatPercent(summary.occupancyRate, { locale })} occupancy`}
          tone="success"
          ringValue={summary.occupancyRate}
          href="/units?availability=leased"
        />
        <KpiCard
          label="Vacant Units"
          value={summary.availableUnits.toLocaleString()}
          caption={`${formatPercent(summary.vacancyRate, { locale })} vacancy`}
          icon={<KeyRound />}
          tone="warning"
          higherIsBetter={false}
          href="/units?availability=available"
        />
        <KpiCard
          label="Annual Rental Value"
          value={money(summary.annualRentalValue)}
          caption="At full occupancy"
          tone="gold"
          href="/units"
        />
        <KpiCard
          label="Total Units"
          value={summary.totalUnits.toLocaleString()}
          caption="Across all properties"
          icon={<Building2 />}
          tone="info"
          href="/units"
        />
      </KpiGrid>

      <FilterBar
        searchPlaceholder="Search properties, locations, or keywords..."
        view={{ current: view }}
        filters={[
          {
            key: 'cityId',
            placeholder: 'All Cities',
            options: options.cities.map((city) => ({ value: city.id, label: city.name })),
          },
          {
            key: 'typeId',
            placeholder: 'All Types',
            options: options.types.map((type) => ({ value: type.id, label: type.name })),
          },
          {
            key: 'status',
            placeholder: 'All Statuses',
            options: [
              { value: 'active', label: 'Active' },
              { value: 'under_construction', label: 'Under Construction' },
              { value: 'under_renovation', label: 'Under Renovation' },
              { value: 'inactive', label: 'Inactive' },
            ],
          },
        ]}
      />

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 />}
            title="No properties found"
            description="Try adjusting your filters or add a new property to your portfolio."
            action={
              can(user, 'properties:create') ? (
                <Button asChild>
                  <Link href="/properties/new">
                    <Plus />
                    Add Property
                  </Link>
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((property) => (
            <Card key={property.id} interactive className="overflow-hidden">
              <PropertyImage
                src={property.coverImageUrl}
                alt={property.name}
                className="h-40 w-full"
              />
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/properties/${property.id}`}
                      className="block truncate text-[15px] font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-info)]"
                    >
                      {property.name}
                    </Link>
                    <p className="mt-0.5 flex items-center gap-1 text-[12px] text-[var(--color-text-secondary)]">
                      <MapPin className="size-3.5 text-[var(--color-text-tertiary)]" aria-hidden />
                      {property.cityName}
                      {property.districtName ? ` · ${property.districtName}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <StatusBadge status={property.status} />
                    {canEditProperty || canDeleteProperty ? (
                      <PropertyActions
                        propertyId={property.id}
                        name={property.name}
                        code={property.code}
                        location={`${property.cityName}${property.districtName ? `, ${property.districtName}` : ''}`}
                        canEdit={canEditProperty}
                        canDelete={canDeleteProperty}
                        variant="card"
                      />
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-[var(--color-border-subtle)] pt-3.5">
                  <Figure label="Total Units" value={String(property.totalUnits)} />
                  <Figure
                    label="Occupied"
                    value={String(property.occupiedUnits)}
                    tone="success"
                  />
                  <div className="flex flex-col items-center">
                    <ProgressRing value={property.occupancyRate} size={40} strokeWidth={4} />
                    <span className="mt-1 text-[10.5px] text-[var(--color-text-tertiary)]">Occupancy</span>
                  </div>
                </div>

                <div className="mt-3.5 flex items-center justify-between border-t border-[var(--color-border-subtle)] pt-3">
                  <span className="text-[12px] text-[var(--color-text-secondary)]">
                    {money(property.annualRentalValue)}
                  </span>
                  <Link
                    href={`/properties/${property.id}`}
                    className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-info)] hover:underline"
                  >
                    View details
                    <ArrowRight className="size-3.5 rtl-flip" aria-hidden />
                  </Link>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH className="w-10">#</TH>
                  <TH>Property Name</TH>
                  <TH>City</TH>
                  <TH>Type</TH>
                  <TH alignment="end">Total Units</TH>
                  <TH alignment="end">Occupied</TH>
                  <TH alignment="end">Available</TH>
                  <TH alignment="end">Occupancy</TH>
                  <TH alignment="end">Annual Rental Value</TH>
                  <TH alignment="center">Status</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((property, index) => (
                  <TR key={property.id} interactive>
                    <TD className="text-[var(--color-text-tertiary)]">
                      {(page - 1) * PAGE_SIZE + index + 1}
                    </TD>
                    <TD>
                      <Link
                        href={`/properties/${property.id}`}
                        className="flex items-center gap-2.5"
                      >
                        <PropertyImage
                          src={property.coverImageUrl}
                          alt={property.name}
                          className="size-9 shrink-0 rounded-[8px]"
                          iconClassName="size-4"
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-[var(--color-text-primary)]">
                            {property.name}
                          </span>
                          <span className="block text-[11px] text-[var(--color-text-tertiary)]">
                            {property.code}
                          </span>
                        </span>
                      </Link>
                    </TD>
                    <TD className="text-[var(--color-text-secondary)]">{property.cityName}</TD>
                    <TD className="text-[var(--color-text-secondary)]">{property.typeName}</TD>
                    <TD alignment="end" numeric>
                      {property.totalUnits}
                    </TD>
                    <TD alignment="end" numeric>
                      {property.occupiedUnits}
                    </TD>
                    <TD alignment="end" numeric className="text-[var(--color-warning)]">
                      {property.availableUnits}
                    </TD>
                    <TD
                      alignment="end"
                      numeric
                      className={
                        property.occupancyRate >= 92
                          ? 'font-medium text-[var(--color-success)]'
                          : 'font-medium text-[#b97a08]'
                      }
                    >
                      {formatPercent(property.occupancyRate, { locale })}
                    </TD>
                    <TD alignment="end" numeric>
                      {money(property.annualRentalValue)}
                    </TD>
                    <TD alignment="center">
                      <StatusBadge status={property.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} buildHref={buildHref} />
        </Card>
      )}

      {view === 'grid' && total > PAGE_SIZE ? (
        <Card>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} buildHref={buildHref} />
        </Card>
      ) : null}
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'default';
}) {
  return (
    <div className="flex flex-col items-center">
      <span
        className={
          tone === 'success'
            ? 'text-[15px] font-semibold text-[var(--color-success)] tabular'
            : 'text-[15px] font-semibold text-[var(--color-text-primary)] tabular'
        }
      >
        {value}
      </span>
      <span className="mt-0.5 text-[10.5px] text-[var(--color-text-tertiary)]">{label}</span>
    </div>
  );
}
