import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  Ban,
  Building2,
  CalendarDays,
  CircleDollarSign,
  ClipboardCheck,
  Clock,
  FileText,
  KeyRound,
  Plus,
  ReceiptText,
  TrendingUp,
  Wrench,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { EmptyState } from '@/components/ui/misc';
import { KpiGrid, PageHeader } from '@/components/ui/page';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { DetailList, DetailRow } from '@/components/ui/page';
import { DashboardCharts } from '@/features/dashboard/dashboard-charts';
import { PeriodSelector } from '@/features/dashboard/period-selector';
import { ExceptionsPanel } from '@/features/dashboard/exceptions-panel';
import { DashboardScopeFilters } from '@/features/dashboard/scope-filters';
import { requirePermission } from '@/lib/auth/guard';
import { formatCompactCurrency, formatDate, formatPercent, formatRelativeTime } from '@/lib/format';
import { getRequestLocale, getRequestLocationId } from '@/lib/locale';
import { getMessages, interpolate, type Messages } from '@/i18n';
import { can } from '@/lib/auth/guard';
import {
  getRecentLeads,
  getRecentWorkOrders,
  getUpcomingRenewals,
} from '@/services/dashboard-service';
import {
  getAvailabilityBreakdown,
  getCityBreakdown,
  getDashboardFilterOptions,
  getExecutiveExceptions,
  getPortfolioSummary,
  getPropertyPerformance,
  getTrendSeries,
  getUnitFocus,
  getUnitStatusBreakdown,
  scopeFromSession,
  type UnitFocus,
} from '@/services/metrics-service';
import { formatCurrency } from '@/lib/format';

export const metadata: Metadata = { title: 'Executive Dashboard' };
export const dynamic = 'force-dynamic';

function greeting(now: Date, d: Messages['dashboard']): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Riyadh' }).format(now),
  );
  if (hour < 12) return d.greetingMorning;
  if (hour < 17) return d.greetingAfternoon;
  return d.greetingEvening;
}

function resolvePeriod(value: string | undefined): { months: number; label: string } {
  switch (value) {
    case '3m':
      return { months: 3, label: 'Last 3 months' };
    case '6m':
      return { months: 6, label: 'Last 6 months' };
    case '24m':
      return { months: 24, label: 'Last 24 months' };
    default:
      return { months: 12, label: 'Last 12 months' };
  }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; city?: string; building?: string; unit?: string }>;
}) {
  const user = await requirePermission('dashboard:view');
  const params = await searchParams;
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  const d = m.dashboard;
  const cookieCityId = await getRequestLocationId();
  const period = resolvePeriod(params.period);

  const periodEnd = new Date();
  const periodStart = new Date(
    Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth() - period.months + 1, 1),
  );

  // Resolve the City → Building → Unit selection against the scoped hierarchy.
  // Any id outside the user's scope is ignored (IDOR-safe allow-list), and a
  // selection cascades: a unit implies its building/property/city, a building
  // implies its property/city.
  const filterOptions = await getDashboardFilterOptions(user);
  const selectedUnit = params.unit ? filterOptions.units.find((u) => u.id === params.unit) ?? null : null;
  const selectedBuilding = selectedUnit
    ? filterOptions.buildings.find((b) => b.id === selectedUnit.buildingId) ?? null
    : params.building
      ? filterOptions.buildings.find((b) => b.id === params.building) ?? null
      : null;
  const resolvedCityId =
    selectedUnit?.cityId ??
    selectedBuilding?.cityId ??
    (params.city ? filterOptions.cities.find((c) => c.id === params.city)?.id ?? null : null) ??
    cookieCityId;
  const resolvedPropertyId = selectedUnit?.propertyId ?? selectedBuilding?.propertyId ?? null;
  const buildingId = selectedBuilding?.id ?? null;
  const unitId = selectedUnit?.id ?? null;

  const scope = scopeFromSession(user, {
    cityId: resolvedCityId,
    propertyId: resolvedPropertyId,
    buildingId,
    unitId,
    periodStart,
    periodEnd,
  });

  const cityName = filterOptions.cities.find((c) => c.id === resolvedCityId)?.name ?? d.allCities;
  const buildingName = selectedBuilding?.name ?? d.allBuildings;
  const unitName = selectedUnit?.name ?? d.allUnits;
  const unitFocus = unitId ? await getUnitFocus(user.organizationId, unitId) : null;

  const [
    summary,
    availability,
    statusBreakdown,
    trend,
    performance,
    cityBreakdown,
    exceptions,
    recentLeads,
    renewals,
    workOrderRows,
  ] = await Promise.all([
    getPortfolioSummary(scope),
    getAvailabilityBreakdown(scope),
    getUnitStatusBreakdown(scope),
    getTrendSeries(scope, period.months),
    getPropertyPerformance(scope),
    getCityBreakdown(scope),
    getExecutiveExceptions(scope),
    getRecentLeads(scope),
    getUpcomingRenewals(scope),
    getRecentWorkOrders(scope),
  ]);

  const firstName = user.fullName.split(' ')[0];
  const money = (value: number) => formatCompactCurrency(value, { locale });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={`${greeting(new Date(), d)}, ${firstName}`}
        subtitle={`${cityName} → ${buildingName} → ${unitName}`}
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <DashboardScopeFilters
              cities={filterOptions.cities}
              buildings={filterOptions.buildings}
              units={filterOptions.units}
              cityId={resolvedCityId}
              buildingId={buildingId}
              unitId={unitId}
            />
            <PeriodSelector value={params.period ?? '12m'} />
            {can(user, 'properties:create') ? (
              <Button asChild>
                <Link href="/properties/new">
                  <Plus />
                  {d.addProperty}
                </Link>
              </Button>
            ) : null}
          </div>
        }
      />

      {unitFocus ? <UnitFocusPanel focus={unitFocus} locale={locale} /> : null}

      {availability.total === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 />}
            title={d.noUnitsTitle}
            description={d.noUnitsHint}
          />
        </Card>
      ) : null}

      {availability.total > 0 ? (
      <>
      {/* Unit status KPIs — each drills into the filtered unit inventory. */}
      <KpiGrid columns={5}>
        <KpiCard
          label={d.totalUnits}
          value={availability.total.toLocaleString()}
          caption={interpolate(d.acrossProjects, { count: summary.propertyCount })}
          icon={<Building2 />}
          tone="neutral"
          href="/units"
        />
        <KpiCard
          label={d.available}
          value={availability.available.toLocaleString()}
          caption={d.readyForLease}
          icon={<KeyRound />}
          tone="success"
          ringValue={availability.availableShare}
          href="/units?availability=available"
        />
        <KpiCard
          label={d.reserved}
          value={availability.reserved.toLocaleString()}
          caption={d.underNegotiation}
          icon={<Clock />}
          tone="warning"
          ringValue={availability.reservedShare}
          href="/units?availability=reserved"
        />
        <KpiCard
          label={d.leased}
          value={availability.leased.toLocaleString()}
          caption={d.contractedActive}
          icon={<FileText />}
          tone="info"
          ringValue={availability.leasedShare}
          href="/units?availability=leased"
        />
        <KpiCard
          label={d.notAvailable}
          value={availability.notAvailable.toLocaleString()}
          caption={d.offMarketServices}
          icon={<Ban />}
          tone="neutral"
          ringValue={availability.notAvailableShare}
          href="/units?availability=not_available"
        />
      </KpiGrid>

      {/* Financial KPIs */}
      <KpiGrid columns={6}>
        <KpiCard
          label={d.portfolioValue}
          value={money(summary.marketValue)}
          caption={d.marketValuation}
          icon={<Building2 />}
          tone="gold"
          href="/financials/valuations"
        />
        <KpiCard
          label={d.annualRentalValue}
          value={money(summary.annualRentalValue)}
          caption={d.atFullOccupancy}
          icon={<CircleDollarSign />}
          tone="neutral"
          href="/units"
        />
        <KpiCard
          label={d.contractedRevenue}
          value={money(summary.contractedRevenue)}
          caption={d.activeLeases}
          icon={<FileText />}
          tone="info"
          href="/contracts"
        />
        <KpiCard
          label={d.collectedRevenue}
          value={money(summary.collectedRevenue)}
          caption={period.label}
          icon={<ReceiptText />}
          tone="success"
          href="/collections"
        />
        <KpiCard
          label={d.outstanding}
          value={money(summary.outstanding)}
          caption={`${money(summary.overdue)} ${m.common.statuses.overdue}`}
          icon={<Clock />}
          tone={summary.overdue > 0 ? 'warning' : 'neutral'}
          href="/collections?status=overdue"
        />
        <KpiCard
          label={d.collectionRate}
          value={formatPercent(summary.collectionRate, { locale })}
          caption={d.collectedOfBilled}
          icon={<ClipboardCheck />}
          tone={summary.collectionRate >= 95 ? 'success' : summary.collectionRate >= 88 ? 'warning' : 'error'}
          ringValue={summary.collectionRate}
          href="/collections"
        />
      </KpiGrid>

      <KpiGrid columns={6}>
        <KpiCard
          label={d.occupancyRate}
          value={formatPercent(summary.occupancyRate, { locale })}
          caption={`${summary.occupiedUnits} / ${summary.totalUnits}`}
          icon={<ClipboardCheck />}
          tone="success"
          ringValue={summary.occupancyRate}
          href="/units?availability=leased"
        />
        <KpiCard
          label={d.vacancyRate}
          value={formatPercent(summary.vacancyRate, { locale })}
          caption={`${summary.availableUnits} ${d.available}`}
          icon={<Clock />}
          tone="warning"
          higherIsBetter={false}
          href="/units?availability=available"
        />
        <KpiCard
          label={d.noi}
          value={money(summary.netOperatingIncome)}
          caption={formatPercent(summary.noiMargin, { locale })}
          icon={<TrendingUp />}
          tone="info"
          href="/financials"
        />
        <KpiCard
          label={d.opex}
          value={money(summary.operatingExpenses)}
          caption={`${money(summary.maintenanceCost)} · ${m.nav.maintenance}`}
          icon={<Wrench />}
          tone="neutral"
          higherIsBetter={false}
          href="/financials/expenses"
        />
        <KpiCard
          label={d.expiringContracts}
          value={String(summary.expiringContracts)}
          caption={money(summary.expiringContractValue)}
          icon={<CalendarDays />}
          tone={summary.expiringContracts > 0 ? 'warning' : 'neutral'}
          higherIsBetter={false}
          href="/contracts?expiringWithinDays=90"
        />
        <KpiCard
          label={d.grossYield}
          value={formatPercent(summary.grossYield, { locale, decimals: 1 })}
          caption={`WALE ${summary.wale}`}
          icon={<TrendingUp />}
          tone="gold"
          href="/reports"
        />
      </KpiGrid>

      {exceptions.length > 0 ? <ExceptionsPanel exceptions={exceptions} title={d.exceptions} description={d.exceptionsDesc} /> : null}

      {/* Charts */}
      <DashboardCharts
        trend={trend}
        statusBreakdown={statusBreakdown}
        totalUnits={availability.total}
        cityBreakdown={cityBreakdown}
        summary={{
          marketValue: summary.marketValue,
          bookValue: summary.bookValue,
          annualRentalValue: summary.annualRentalValue,
          contractedRevenue: summary.contractedRevenue,
          collectedRevenue: summary.collectedRevenue,
          outstanding: summary.outstanding,
          collectionRate: summary.collectionRate,
        }}
        periodLabel={period.label}
        locale={locale}
      />

      {/* Properties performance */}
      <Card>
        <CardHeader
          title={d.propertiesPerformance}
          action={
            <Button variant="link" size="sm" asChild>
              <Link href="/properties">
                {m.common.viewAll}
                <ArrowRight className="size-3.5 rtl-flip" />
              </Link>
            </Button>
          }
        />
        {performance.length === 0 ? (
          <EmptyState
            icon={<Building2 />}
            title={d.noPropertiesInScope}
            description={d.noPropertiesInScopeHint}
          />
        ) : (
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH className="w-10">#</TH>
                  <TH>{d.colProperty}</TH>
                  <TH>{m.properties.city}</TH>
                  <TH alignment="end">{d.totalUnits}</TH>
                  <TH alignment="end">{d.available}</TH>
                  <TH alignment="end">{d.leased}</TH>
                  <TH alignment="end">{m.properties.occupancy}</TH>
                  <TH alignment="end">{m.properties.collection}</TH>
                  <TH alignment="end">{m.properties.annualRentalValueCol}</TH>
                  <TH alignment="center">{m.common.status}</TH>
                </TR>
              </THead>
              <TBody>
                {performance.map((row, index) => (
                  <TR key={row.propertyId} interactive>
                    <TD className="text-[var(--color-text-tertiary)]">{index + 1}</TD>
                    <TD>
                      <Link
                        href={`/properties/${row.propertyId}`}
                        className="font-medium text-[var(--color-text-primary)] hover:text-[var(--color-info)]"
                      >
                        {row.name}
                      </Link>
                      <span className="block text-[11px] text-[var(--color-text-tertiary)]">
                        {row.code} · {row.typeName}
                      </span>
                    </TD>
                    <TD className="text-[var(--color-text-secondary)]">{row.cityName}</TD>
                    <TD alignment="end" numeric>
                      {row.totalUnits}
                    </TD>
                    <TD alignment="end" numeric className="text-[var(--color-success)]">
                      {row.availableUnits}
                    </TD>
                    <TD alignment="end" numeric>
                      {row.occupiedUnits}
                    </TD>
                    <TD
                      alignment="end"
                      numeric
                      className={
                        row.occupancyRate >= 92
                          ? 'font-medium text-[var(--color-success)]'
                          : 'font-medium text-[#b97a08]'
                      }
                    >
                      {formatPercent(row.occupancyRate, { locale })}
                    </TD>
                    <TD
                      alignment="end"
                      numeric
                      className={
                        row.collectionRate >= 95
                          ? 'font-medium text-[var(--color-success)]'
                          : 'font-medium text-[#b97a08]'
                      }
                    >
                      {formatPercent(row.collectionRate, { locale })}
                    </TD>
                    <TD alignment="end" numeric>
                      {money(row.annualRentalValue)}
                    </TD>
                    <TD alignment="center">
                      <StatusBadge status={row.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        )}
      </Card>

      {/* Operational panels */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader
            title={d.recentLeads}
            action={
              <Button variant="link" size="sm" asChild>
                <Link href="/leasing">
                  {m.common.viewAll}
                  <ArrowRight className="size-3.5 rtl-flip" />
                </Link>
              </Button>
            }
          />
          {recentLeads.length === 0 ? (
            <EmptyState title={d.noLeads} description={d.noLeadsHint} />
          ) : (
            <TableContainer>
              <Table>
                <THead>
                  <TR>
                    <TH>{d.colName}</TH>
                    <TH>{d.colSource}</TH>
                    <TH>{d.colStage}</TH>
                    <TH alignment="end">{m.common.date}</TH>
                  </TR>
                </THead>
                <TBody>
                  {recentLeads.map((lead) => (
                    <TR key={lead.id} interactive>
                      <TD>
                        <Link
                          href={`/leasing/leads/${lead.id}`}
                          className="font-medium hover:text-[var(--color-info)]"
                        >
                          {lead.customerName}
                        </Link>
                        <span className="block text-[11px] text-[var(--color-text-tertiary)]">
                          {lead.propertyName ?? '—'}
                        </span>
                      </TD>
                      <TD className="text-[var(--color-text-secondary)]">{lead.sourceName ?? '—'}</TD>
                      <TD>
                        <Badge tone={mapStageTone(lead.stageColor)}>{lead.stageName}</Badge>
                      </TD>
                      <TD alignment="end" className="whitespace-nowrap text-[var(--color-text-secondary)]">
                        {formatRelativeTime(lead.createdAt, { locale })}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
          )}
        </Card>

        <Card>
          <CardHeader
            title={d.upcomingRenewals}
            action={
              <Button variant="link" size="sm" asChild>
                <Link href="/contracts?expiringWithinDays=180">
                  {m.common.viewAll}
                  <ArrowRight className="size-3.5 rtl-flip" />
                </Link>
              </Button>
            }
          />
          {renewals.length === 0 ? (
            <EmptyState title={d.noRenewals} description={d.noRenewalsHint} />
          ) : (
            <TableContainer>
              <Table>
                <THead>
                  <TR>
                    <TH>{d.colTenant}</TH>
                    <TH>{d.colProperty}</TH>
                    <TH alignment="end">{d.colExpiry}</TH>
                    <TH alignment="end">{d.daysLeft}</TH>
                  </TR>
                </THead>
                <TBody>
                  {renewals.map((row) => (
                    <TR key={row.contractId} interactive>
                      <TD>
                        <Link
                          href={`/contracts/${row.contractId}`}
                          className="font-medium hover:text-[var(--color-info)]"
                        >
                          {row.tenantName}
                        </Link>
                        <span className="block text-[11px] text-[var(--color-text-tertiary)]">
                          Unit {row.unitCode}
                        </span>
                      </TD>
                      <TD className="text-[var(--color-text-secondary)]">{row.propertyName}</TD>
                      <TD alignment="end" className="whitespace-nowrap">
                        {formatDate(row.endDate, { locale })}
                      </TD>
                      <TD alignment="end">
                        <Badge tone={row.daysLeft <= 60 ? 'error' : row.daysLeft <= 120 ? 'warning' : 'success'}>
                          {row.daysLeft}
                        </Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
          )}
        </Card>

        <Card>
          <CardHeader
            title={d.maintenanceRequests}
            action={
              <Button variant="link" size="sm" asChild>
                <Link href="/maintenance">
                  {m.common.viewAll}
                  <ArrowRight className="size-3.5 rtl-flip" />
                </Link>
              </Button>
            }
          />
          {workOrderRows.length === 0 ? (
            <EmptyState title={d.noWorkOrders} description={d.noWorkOrdersHint} />
          ) : (
            <TableContainer>
              <Table>
                <THead>
                  <TR>
                    <TH>#</TH>
                    <TH>{d.colUnit}</TH>
                    <TH>{d.colType}</TH>
                    <TH alignment="center">{m.common.status}</TH>
                    <TH alignment="center">{d.colPriority}</TH>
                  </TR>
                </THead>
                <TBody>
                  {workOrderRows.map((row) => (
                    <TR key={row.id} interactive>
                      <TD>
                        <Link
                          href={`/maintenance/${row.id}`}
                          className="font-medium hover:text-[var(--color-info)]"
                        >
                          {row.code}
                        </Link>
                      </TD>
                      <TD className="text-[var(--color-text-secondary)]">{row.unitCode ?? 'Common'}</TD>
                      <TD className="text-[var(--color-text-secondary)]">{row.categoryName ?? '—'}</TD>
                      <TD alignment="center">
                        <StatusBadge status={row.status} />
                      </TD>
                      <TD alignment="center">
                        <StatusBadge status={row.priority} dot={false} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
          )}
        </Card>
      </div>
      </>
      ) : null}
    </div>
  );
}

function UnitFocusPanel({ focus, locale }: { focus: UnitFocus; locale: 'en' | 'ar' }) {
  const { unit, contract, financial, maintenance } = focus;
  const md = getMessages(locale);
  const currency = (v: number) => formatCurrency(v, { locale });
  const day = (v: string | null) => (v ? formatDate(v, { locale, style: 'medium' }) : 'N/A');
  const na = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? 'N/A' : String(v));

  return (
    <Card>
      <CardHeader
        title={`${md.units.unit} ${unit.unitNumber} — ${md.dashboard.common360}`}
        description={`${unit.propertyName}${unit.buildingName ? ` · ${unit.buildingName}` : ''} · ${unit.cityName}`}
        action={<StatusBadge status={unit.availabilityClass} label={unit.statusLabel} />}
      />
      <CardBody>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
          <DetailList>
            <DetailRow label="Unit Number" value={unit.unitNumber} />
            <DetailRow label="Code" value={unit.code} />
            <DetailRow label="Type" value={unit.unitType} />
            <DetailRow label="Floor" value={na(unit.floorName)} />
            <DetailRow label="Area (m²)" value={unit.leasableArea != null ? unit.leasableArea.toLocaleString() : 'N/A'} />
            <DetailRow label="Bedrooms" value={na(unit.bedroomCount)} />
            <DetailRow label="Bathrooms" value={na(unit.bathroomCount)} />
          </DetailList>

          <DetailList>
            <DetailRow label="Tenant" value={contract ? contract.tenantName : 'N/A'} />
            <DetailRow label="Contract" value={contract ? contract.contractNumber : 'N/A'} />
            <DetailRow label="Start" value={contract ? day(contract.startDate) : 'N/A'} />
            <DetailRow label="End" value={contract ? day(contract.endDate) : 'N/A'} />
            <DetailRow label="Annual Rent" value={contract ? currency(contract.annualRent) : 'N/A'} />
            <DetailRow label="Lease Status" value={contract ? <StatusBadge status={contract.status} dot={false} /> : 'N/A'} />
          </DetailList>

          <DetailList>
            <DetailRow label="Billed" value={currency(financial.billed)} />
            <DetailRow label="Collected" value={currency(financial.collected)} />
            <DetailRow label="Outstanding" value={currency(financial.outstanding)} />
            <DetailRow label="Collection Rate" value={formatPercent(financial.collectionRate, { locale })} />
          </DetailList>

          <DetailList>
            <DetailRow label="Open Work Orders" value={String(maintenance.openWorkOrders)} />
            <DetailRow label="Completed" value={String(maintenance.completedWorkOrders)} />
            <DetailRow label="Total Maintenance Cost" value={currency(maintenance.totalMaintenanceCost)} />
            <DetailRow label="Last Maintenance" value={day(maintenance.lastCompletedAt)} />
          </DetailList>
        </div>
      </CardBody>
    </Card>
  );
}

function mapStageTone(colorToken: string) {
  const map: Record<string, 'info' | 'warning' | 'success' | 'error' | 'gold' | 'neutral'> = {
    info: 'info',
    warning: 'warning',
    success: 'success',
    error: 'error',
    gold: 'gold',
  };
  return map[colorToken] ?? 'neutral';
}
