import 'server-only';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  buildings,
  cities,
  contracts,
  districts,
  expenseCategories,
  floors,
  invoices,
  maintenanceCosts,
  operatingExpenses,
  performanceSnapshots,
  properties,
  propertyTypes,
  tenants,
  unitPricing,
  units,
  unitStatuses,
  unitTypes,
  valuations,
  vacancyPeriods,
  workOrders,
} from '@/db/schema';
import {
  ageReceivables,
  averageDaysOutstanding,
  collectionRate,
  concentration,
  grossYield,
  netOperatingIncome,
  noiMargin,
  occupancyRate,
  perSquareMetre,
  slaCompliance,
  wale,
} from '@/lib/calculations/metrics';
import { getPolicy } from '@/lib/settings';
import { round2, safeDivide } from '@/lib/utils';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Metrics service — the single computation path behind every dashboard,
 * report and export (BR-016). No screen recomputes a KPI locally.
 *
 * Every query is scoped by organization and, where the user has data-level
 * restrictions, by the properties or cities they may see (BRD 126).
 */

export interface MetricScope {
  organizationId: string;
  /** Data-level restriction derived from the session. */
  allowedPropertyIds?: string[] | null;
  allowedCityIds?: string[] | null;
  /** Drill-down filters chosen by the user. */
  portfolioId?: string | null;
  regionId?: string | null;
  cityId?: string | null;
  districtId?: string | null;
  propertyId?: string | null;
  buildingId?: string | null;
  unitId?: string | null;
  /** Reporting period; defaults to the trailing twelve months. */
  periodStart?: Date;
  periodEnd?: Date;
}

export function scopeFromSession(user: SessionUser, overrides: Partial<MetricScope> = {}): MetricScope {
  return {
    organizationId: user.organizationId,
    allowedPropertyIds: user.scopedPropertyIds.length > 0 ? user.scopedPropertyIds : null,
    allowedCityIds: user.scopedCityIds.length > 0 ? user.scopedCityIds : null,
    ...overrides,
  };
}

/** Property-level predicate shared by every aggregate query. */
function propertyPredicate(scope: MetricScope): SQL {
  const conditions: SQL[] = [
    eq(properties.organizationId, scope.organizationId),
    isNull(properties.deletedAt),
  ];
  if (scope.allowedPropertyIds?.length) {
    conditions.push(inArray(properties.id, scope.allowedPropertyIds));
  }
  if (scope.allowedCityIds?.length) {
    conditions.push(inArray(properties.cityId, scope.allowedCityIds));
  }
  if (scope.portfolioId) conditions.push(eq(properties.portfolioId, scope.portfolioId));
  if (scope.regionId) conditions.push(eq(properties.regionId, scope.regionId));
  if (scope.cityId) conditions.push(eq(properties.cityId, scope.cityId));
  if (scope.districtId) conditions.push(eq(properties.districtId, scope.districtId));
  if (scope.propertyId) conditions.push(eq(properties.id, scope.propertyId));
  return and(...conditions) as SQL;
}

/** Resolves the concrete property ids in scope — reused by every aggregate. */
export async function resolveScopedPropertyIds(scope: MetricScope): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: properties.id })
    .from(properties)
    .where(propertyPredicate(scope));
  return rows.map((row) => row.id);
}

/** True when the scope narrows below property level (a building or a unit). */
function isUnitScoped(scope: MetricScope): boolean {
  return Boolean(scope.buildingId || scope.unitId);
}

/** Unit-table predicate: property scope, plus building/unit narrowing. */
function unitScopePredicate(scope: MetricScope, propertyIds: string[]): SQL {
  const conditions: SQL[] = [inArray(units.propertyId, propertyIds), isNull(units.deletedAt)];
  if (scope.buildingId) conditions.push(eq(units.buildingId, scope.buildingId));
  if (scope.unitId) conditions.push(eq(units.id, scope.unitId));
  return and(...conditions) as SQL;
}

/** Resolves the concrete unit ids in scope. Returns [] when not unit-scoped. */
export async function resolveScopedUnitIds(scope: MetricScope, propertyIds: string[]): Promise<string[]> {
  if (!isUnitScoped(scope) || propertyIds.length === 0) return [];
  const db = await getDb();
  const rows = await db.select({ id: units.id }).from(units).where(unitScopePredicate(scope, propertyIds));
  return rows.map((row) => row.id);
}

/**
 * Scope predicate for a unit-linked financial table. Below property level it
 * filters by the concrete scoped unit ids (rows without a matching unit fall
 * out of the unit-specific view); otherwise it filters by property. An empty
 * unit set resolves to a match-nothing predicate so the KPI reads zero.
 */
function financialScope(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unitCol: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  propertyCol: any,
  scope: MetricScope,
  propertyIds: string[],
  unitIds: string[],
): SQL {
  if (isUnitScoped(scope)) {
    return (unitIds.length ? inArray(unitCol, unitIds) : sql`false`) as SQL;
  }
  return inArray(propertyCol, propertyIds) as SQL;
}

function periodBounds(scope: MetricScope): { start: Date; end: Date } {
  const end = scope.periodEnd ?? new Date();
  const start =
    scope.periodStart ??
    new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth(), 1));
  return { start, end };
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* Portfolio summary                                                           */
/* -------------------------------------------------------------------------- */

export interface PortfolioSummary {
  propertyCount: number;
  buildingCount: number;
  totalUnits: number;
  availableUnits: number;
  reservedUnits: number;
  leasedUnits: number;
  notAvailableUnits: number;
  occupiedUnits: number;
  occupancyRate: number;
  vacancyRate: number;
  totalLeasableArea: number;
  vacantLeasableArea: number;
  marketValue: number;
  bookValue: number;
  acquisitionCost: number;
  annualRentalValue: number;
  contractedRevenue: number;
  billedRevenue: number;
  collectedRevenue: number;
  outstanding: number;
  overdue: number;
  collectionRate: number;
  operatingExpenses: number;
  maintenanceCost: number;
  netOperatingIncome: number;
  noiMargin: number;
  grossYield: number;
  vacancyLoss: number;
  expiringContracts: number;
  expiringContractValue: number;
  wale: number;
  revenuePerSqm: number;
  opexPerSqm: number;
  maintenancePerSqm: number;
}

export async function getPortfolioSummary(scope: MetricScope): Promise<PortfolioSummary> {
  const db = await getDb();
  const propertyIds = await resolveScopedPropertyIds(scope);
  const { start, end } = periodBounds(scope);
  const policy = await getPolicy(scope.organizationId);

  if (propertyIds.length === 0) return emptySummary();

  const unitIds = await resolveScopedUnitIds(scope, propertyIds);
  if (isUnitScoped(scope) && unitIds.length === 0) return emptySummary();
  const unitScope = unitScopePredicate(scope, propertyIds);

  // --- Units, occupancy, area, annual rental value -------------------------
  const [unitRow] = await db
    .select({
      totalUnits: sql<number>`count(*)::int`,
      availableUnits: sql<number>`count(*) filter (where ${units.computedAvailabilityClass} = 'available')::int`,
      reservedUnits: sql<number>`count(*) filter (where ${units.computedAvailabilityClass} = 'reserved')::int`,
      leasedUnits: sql<number>`count(*) filter (where ${units.computedAvailabilityClass} = 'leased')::int`,
      notAvailableUnits: sql<number>`count(*) filter (where ${units.computedAvailabilityClass} = 'not_available')::int`,
      occupiedUnits: sql<number>`count(*) filter (where ${unitStatuses.countsAsOccupied})::int`,
      totalArea: sql<number>`coalesce(sum(${units.leasableArea}), 0)::float8`,
      vacantArea: sql<number>`coalesce(sum(${units.leasableArea}) filter (where ${units.computedAvailabilityClass} = 'available'), 0)::float8`,
      annualRentalValue: sql<number>`coalesce(sum(${unitPricing.askingRent}), 0)::float8`,
      vacantAnnualRent: sql<number>`coalesce(sum(${unitPricing.askingRent}) filter (where ${units.computedAvailabilityClass} = 'available'), 0)::float8`,
    })
    .from(units)
    .innerJoin(unitStatuses, eq(unitStatuses.id, units.statusId))
    .leftJoin(unitPricing, eq(unitPricing.unitId, units.id))
    .where(unitScope);

  const [propertyRow] = await db
    .select({
      propertyCount: sql<number>`count(*)::int`,
      buildingCount: sql<number>`coalesce(sum(${properties.buildingCount}), 0)::int`,
    })
    .from(properties)
    .where(propertyPredicate(scope));

  // --- Valuation -----------------------------------------------------------
  const [valuationRow] = await db
    .select({
      marketValue: sql<number>`coalesce(sum(${valuations.marketValue}), 0)::float8`,
      bookValue: sql<number>`coalesce(sum(${valuations.bookValue}), 0)::float8`,
      acquisitionCost: sql<number>`coalesce(sum(${valuations.acquisitionCost}), 0)::float8`,
    })
    .from(valuations)
    .where(and(inArray(valuations.propertyId, propertyIds), eq(valuations.isCurrent, true)));

  // --- Contracts -----------------------------------------------------------
  const expiryHorizon = new Date(end);
  expiryHorizon.setUTCDate(expiryHorizon.getUTCDate() + policy.contractExpiryWindowDays);

  const [contractRow] = await db
    .select({
      contractedRevenue: sql<number>`coalesce(sum(${contracts.annualRent}), 0)::float8`,
      expiringCount: sql<number>`count(*) filter (where ${contracts.endDate} <= ${iso(expiryHorizon)})::int`,
      expiringValue: sql<number>`coalesce(sum(${contracts.annualRent}) filter (where ${contracts.endDate} <= ${iso(expiryHorizon)}), 0)::float8`,
    })
    .from(contracts)
    .where(
      and(
        financialScope(contracts.unitId, contracts.propertyId, scope, propertyIds, unitIds),
        eq(contracts.isActive, true),
        isNull(contracts.deletedAt),
      ),
    );

  // --- Collections ---------------------------------------------------------
  const [invoiceRow] = await db
    .select({
      billed: sql<number>`coalesce(sum(${invoices.totalAmount}), 0)::float8`,
      collected: sql<number>`coalesce(sum(${invoices.paidAmount}), 0)::float8`,
      outstanding: sql<number>`coalesce(sum(${invoices.balanceAmount}), 0)::float8`,
      overdue: sql<number>`coalesce(sum(${invoices.balanceAmount}) filter (where ${invoices.status} = 'overdue'), 0)::float8`,
    })
    .from(invoices)
    .where(
      and(
        financialScope(invoices.unitId, invoices.propertyId, scope, propertyIds, unitIds),
        gte(invoices.invoiceDate, iso(start)),
        lte(invoices.invoiceDate, iso(end)),
        isNull(invoices.deletedAt),
      ),
    );

  // Overdue is measured across all time, not only the reporting period.
  const [overdueRow] = await db
    .select({ overdue: sql<number>`coalesce(sum(${invoices.balanceAmount}), 0)::float8` })
    .from(invoices)
    .where(and(financialScope(invoices.unitId, invoices.propertyId, scope, propertyIds, unitIds), eq(invoices.status, 'overdue')));

  // --- OPEX and maintenance ------------------------------------------------
  // Only expense categories flagged includedInOpex feed OPEX/NOI, so CAPEX and
  // other non-operating categories never inflate NOI (BR-016).
  const [opexRow] = await db
    .select({ total: sql<number>`coalesce(sum(${operatingExpenses.amount}), 0)::float8` })
    .from(operatingExpenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, operatingExpenses.categoryId))
    .where(
      and(
        financialScope(operatingExpenses.unitId, operatingExpenses.propertyId, scope, propertyIds, unitIds),
        gte(operatingExpenses.incurredOn, iso(start)),
        lte(operatingExpenses.incurredOn, iso(end)),
        isNull(operatingExpenses.deletedAt),
        eq(expenseCategories.includedInOpex, true),
      ),
    );

  const [maintenanceRow] = await db
    .select({ total: sql<number>`coalesce(sum(${maintenanceCosts.amount}), 0)::float8` })
    .from(maintenanceCosts)
    .where(
      and(
        financialScope(maintenanceCosts.unitId, maintenanceCosts.propertyId, scope, propertyIds, unitIds),
        gte(maintenanceCosts.incurredOn, iso(start)),
        lte(maintenanceCosts.incurredOn, iso(end)),
      ),
    );

  // --- Vacancy loss --------------------------------------------------------
  const [vacancyRow] = await db
    .select({ total: sql<number>`coalesce(sum(${vacancyPeriods.estimatedTotalLoss}), 0)::float8` })
    .from(vacancyPeriods)
    .where(
      and(
        financialScope(vacancyPeriods.unitId, vacancyPeriods.propertyId, scope, propertyIds, unitIds),
        isNull(vacancyPeriods.vacancyEndDate),
      ),
    );

  // --- WALE ----------------------------------------------------------------
  const waleRows = await db
    .select({ annualRent: contracts.annualRent, endDate: contracts.endDate })
    .from(contracts)
    .where(and(financialScope(contracts.unitId, contracts.propertyId, scope, propertyIds, unitIds), eq(contracts.isActive, true)));

  const waleValue = wale(
    waleRows.map((row) => ({
      annualRent: Number(row.annualRent),
      yearsToExpiry: (new Date(row.endDate).getTime() - end.getTime()) / (365 * 86_400_000),
    })),
  );

  const totalUnits = Number(unitRow?.totalUnits ?? 0);
  const occupiedUnits = Number(unitRow?.occupiedUnits ?? 0);
  const totalArea = round2(Number(unitRow?.totalArea ?? 0));
  const billed = round2(Number(invoiceRow?.billed ?? 0));
  const collected = round2(Number(invoiceRow?.collected ?? 0));
  const opex = round2(Number(opexRow?.total ?? 0));
  const maintenance = round2(Number(maintenanceRow?.total ?? 0));
  const vacancyLossValue = round2(Number(vacancyRow?.total ?? 0));
  const marketValue = round2(Number(valuationRow?.marketValue ?? 0));
  const annualRentalValue = round2(Number(unitRow?.annualRentalValue ?? 0));

  // NOI includes maintenance spend as part of operating cost (BRD 57, 156).
  const noiInput = {
    grossRentalIncome: billed,
    vacancyLoss: vacancyLossValue,
    operatingExpenses: opex + maintenance,
  };

  return {
    propertyCount: Number(propertyRow?.propertyCount ?? 0),
    buildingCount: Number(propertyRow?.buildingCount ?? 0),
    totalUnits,
    availableUnits: Number(unitRow?.availableUnits ?? 0),
    reservedUnits: Number(unitRow?.reservedUnits ?? 0),
    leasedUnits: Number(unitRow?.leasedUnits ?? 0),
    notAvailableUnits: Number(unitRow?.notAvailableUnits ?? 0),
    occupiedUnits,
    occupancyRate: occupancyRate({ totalUnits, occupiedUnits }),
    vacancyRate: round2(100 - occupancyRate({ totalUnits, occupiedUnits })),
    totalLeasableArea: totalArea,
    vacantLeasableArea: round2(Number(unitRow?.vacantArea ?? 0)),
    marketValue,
    bookValue: round2(Number(valuationRow?.bookValue ?? 0)),
    acquisitionCost: round2(Number(valuationRow?.acquisitionCost ?? 0)),
    annualRentalValue,
    contractedRevenue: round2(Number(contractRow?.contractedRevenue ?? 0)),
    billedRevenue: billed,
    collectedRevenue: collected,
    outstanding: round2(Number(invoiceRow?.outstanding ?? 0)),
    overdue: round2(Number(overdueRow?.overdue ?? 0)),
    collectionRate: collectionRate({ billed, collected }),
    operatingExpenses: opex,
    maintenanceCost: maintenance,
    netOperatingIncome: netOperatingIncome(noiInput),
    noiMargin: noiMargin(noiInput),
    grossYield: grossYield(annualRentalValue, marketValue),
    vacancyLoss: vacancyLossValue,
    expiringContracts: Number(contractRow?.expiringCount ?? 0),
    expiringContractValue: round2(Number(contractRow?.expiringValue ?? 0)),
    wale: waleValue,
    revenuePerSqm: perSquareMetre(billed, totalArea),
    opexPerSqm: perSquareMetre(opex, totalArea),
    maintenancePerSqm: perSquareMetre(maintenance, totalArea),
  };
}

function emptySummary(): PortfolioSummary {
  return {
    propertyCount: 0,
    buildingCount: 0,
    totalUnits: 0,
    availableUnits: 0,
    reservedUnits: 0,
    leasedUnits: 0,
    notAvailableUnits: 0,
    occupiedUnits: 0,
    occupancyRate: 0,
    vacancyRate: 0,
    totalLeasableArea: 0,
    vacantLeasableArea: 0,
    marketValue: 0,
    bookValue: 0,
    acquisitionCost: 0,
    annualRentalValue: 0,
    contractedRevenue: 0,
    billedRevenue: 0,
    collectedRevenue: 0,
    outstanding: 0,
    overdue: 0,
    collectionRate: 0,
    operatingExpenses: 0,
    maintenanceCost: 0,
    netOperatingIncome: 0,
    noiMargin: 0,
    grossYield: 0,
    vacancyLoss: 0,
    expiringContracts: 0,
    expiringContractValue: 0,
    wale: 0,
    revenuePerSqm: 0,
    opexPerSqm: 0,
    maintenancePerSqm: 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Property performance                                                        */
/* -------------------------------------------------------------------------- */

export interface PropertyPerformanceRow {
  propertyId: string;
  code: string;
  name: string;
  cityName: string;
  districtName: string | null;
  typeName: string;
  status: string;
  coverImageUrl: string | null;
  totalUnits: number;
  occupiedUnits: number;
  availableUnits: number;
  occupancyRate: number;
  leasableArea: number;
  annualRentalValue: number;
  contractedRevenue: number;
  billed: number;
  collected: number;
  outstanding: number;
  collectionRate: number;
  marketValue: number;
  operatingExpenses: number;
  maintenanceCost: number;
  netOperatingIncome: number;
  noiMargin: number;
  grossYield: number;
  rentPerSqm: number;
}

export async function getPropertyPerformance(scope: MetricScope): Promise<PropertyPerformanceRow[]> {
  const db = await getDb();
  const { start, end } = periodBounds(scope);
  const propertyIds = await resolveScopedPropertyIds(scope);
  if (propertyIds.length === 0) return [];

  const base = await db
    .select({
      propertyId: properties.id,
      code: properties.code,
      name: properties.nameEn,
      status: properties.status,
      coverImageUrl: properties.coverImageUrl,
      cityName: cities.nameEn,
      districtName: districts.nameEn,
      typeName: propertyTypes.nameEn,
    })
    .from(properties)
    .innerJoin(cities, eq(cities.id, properties.cityId))
    .leftJoin(districts, eq(districts.id, properties.districtId))
    .innerJoin(propertyTypes, eq(propertyTypes.id, properties.propertyTypeId))
    .where(propertyPredicate(scope))
    .orderBy(asc(properties.nameEn));

  const unitAgg = await db
    .select({
      propertyId: units.propertyId,
      totalUnits: sql<number>`count(*)::int`,
      occupiedUnits: sql<number>`count(*) filter (where ${unitStatuses.countsAsOccupied})::int`,
      availableUnits: sql<number>`count(*) filter (where ${units.computedAvailabilityClass} = 'available')::int`,
      leasableArea: sql<number>`coalesce(sum(${units.leasableArea}), 0)::float8`,
      annualRentalValue: sql<number>`coalesce(sum(${unitPricing.askingRent}), 0)::float8`,
    })
    .from(units)
    .innerJoin(unitStatuses, eq(unitStatuses.id, units.statusId))
    .leftJoin(unitPricing, eq(unitPricing.unitId, units.id))
    .where(and(inArray(units.propertyId, propertyIds), isNull(units.deletedAt)))
    .groupBy(units.propertyId);

  const invoiceAgg = await db
    .select({
      propertyId: invoices.propertyId,
      billed: sql<number>`coalesce(sum(${invoices.totalAmount}), 0)::float8`,
      collected: sql<number>`coalesce(sum(${invoices.paidAmount}), 0)::float8`,
      outstanding: sql<number>`coalesce(sum(${invoices.balanceAmount}), 0)::float8`,
    })
    .from(invoices)
    .where(
      and(
        inArray(invoices.propertyId, propertyIds),
        gte(invoices.invoiceDate, iso(start)),
        lte(invoices.invoiceDate, iso(end)),
      ),
    )
    .groupBy(invoices.propertyId);

  const contractAgg = await db
    .select({
      propertyId: contracts.propertyId,
      contractedRevenue: sql<number>`coalesce(sum(${contracts.annualRent}), 0)::float8`,
    })
    .from(contracts)
    .where(and(inArray(contracts.propertyId, propertyIds), eq(contracts.isActive, true)))
    .groupBy(contracts.propertyId);

  const opexAgg = await db
    .select({
      propertyId: operatingExpenses.propertyId,
      total: sql<number>`coalesce(sum(${operatingExpenses.amount}), 0)::float8`,
    })
    .from(operatingExpenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, operatingExpenses.categoryId))
    .where(
      and(
        inArray(operatingExpenses.propertyId, propertyIds),
        gte(operatingExpenses.incurredOn, iso(start)),
        lte(operatingExpenses.incurredOn, iso(end)),
        eq(expenseCategories.includedInOpex, true),
      ),
    )
    .groupBy(operatingExpenses.propertyId);

  const maintenanceAgg = await db
    .select({
      propertyId: maintenanceCosts.propertyId,
      total: sql<number>`coalesce(sum(${maintenanceCosts.amount}), 0)::float8`,
    })
    .from(maintenanceCosts)
    .where(
      and(
        inArray(maintenanceCosts.propertyId, propertyIds),
        gte(maintenanceCosts.incurredOn, iso(start)),
        lte(maintenanceCosts.incurredOn, iso(end)),
      ),
    )
    .groupBy(maintenanceCosts.propertyId);

  const valuationAgg = await db
    .select({
      propertyId: valuations.propertyId,
      marketValue: sql<number>`coalesce(sum(${valuations.marketValue}), 0)::float8`,
    })
    .from(valuations)
    .where(and(inArray(valuations.propertyId, propertyIds), eq(valuations.isCurrent, true)))
    .groupBy(valuations.propertyId);

  const vacancyAgg = await db
    .select({
      propertyId: vacancyPeriods.propertyId,
      loss: sql<number>`coalesce(sum(${vacancyPeriods.estimatedTotalLoss}), 0)::float8`,
    })
    .from(vacancyPeriods)
    .where(and(inArray(vacancyPeriods.propertyId, propertyIds), isNull(vacancyPeriods.vacancyEndDate)))
    .groupBy(vacancyPeriods.propertyId);

  const byId = <T extends { propertyId: string }>(rows: T[]) =>
    new Map(rows.map((row) => [row.propertyId, row]));

  const unitMap = byId(unitAgg);
  const invoiceMap = byId(invoiceAgg);
  const contractMap = byId(contractAgg);
  const opexMap = byId(opexAgg);
  const maintenanceMap = byId(maintenanceAgg);
  const valuationMap = byId(valuationAgg);
  const vacancyMap = byId(vacancyAgg);

  return base.map((property) => {
    const unitData = unitMap.get(property.propertyId);
    const invoiceData = invoiceMap.get(property.propertyId);
    const opex = round2(Number(opexMap.get(property.propertyId)?.total ?? 0));
    const maintenance = round2(Number(maintenanceMap.get(property.propertyId)?.total ?? 0));
    const vacancyLossValue = round2(Number(vacancyMap.get(property.propertyId)?.loss ?? 0));

    const totalUnits = Number(unitData?.totalUnits ?? 0);
    const occupiedUnits = Number(unitData?.occupiedUnits ?? 0);
    const leasableArea = round2(Number(unitData?.leasableArea ?? 0));
    const billed = round2(Number(invoiceData?.billed ?? 0));
    const collected = round2(Number(invoiceData?.collected ?? 0));
    const marketValue = round2(Number(valuationMap.get(property.propertyId)?.marketValue ?? 0));
    const annualRentalValue = round2(Number(unitData?.annualRentalValue ?? 0));
    const contractedRevenue = round2(Number(contractMap.get(property.propertyId)?.contractedRevenue ?? 0));

    const noiInput = {
      grossRentalIncome: billed,
      vacancyLoss: vacancyLossValue,
      operatingExpenses: opex + maintenance,
    };

    return {
      propertyId: property.propertyId,
      code: property.code,
      name: property.name,
      cityName: property.cityName,
      districtName: property.districtName,
      typeName: property.typeName,
      status: property.status,
      coverImageUrl: property.coverImageUrl,
      totalUnits,
      occupiedUnits,
      availableUnits: Number(unitData?.availableUnits ?? 0),
      occupancyRate: occupancyRate({ totalUnits, occupiedUnits }),
      leasableArea,
      annualRentalValue,
      contractedRevenue,
      billed,
      collected,
      outstanding: round2(Number(invoiceData?.outstanding ?? 0)),
      collectionRate: collectionRate({ billed, collected }),
      marketValue,
      operatingExpenses: opex,
      maintenanceCost: maintenance,
      netOperatingIncome: netOperatingIncome(noiInput),
      noiMargin: noiMargin(noiInput),
      grossYield: grossYield(annualRentalValue, marketValue),
      rentPerSqm: perSquareMetre(contractedRevenue, leasableArea),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Trends from historical snapshots                                            */
/* -------------------------------------------------------------------------- */

export interface TrendPoint {
  label: string;
  periodYear: number;
  periodMonth: number;
  occupancyRate: number;
  vacancyRate: number;
  billed: number;
  collected: number;
  collectionRate: number;
  opex: number;
  maintenanceCost: number;
  noi: number;
  marketValue: number;
  annualRentalValue: number;
  workOrdersCreated: number;
  workOrdersCompleted: number;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Historical trend series. Reads the pre-computed monthly snapshots so a
 * twelve-month chart is one indexed query rather than twelve aggregations.
 */
export async function getTrendSeries(scope: MetricScope, months = 12): Promise<TrendPoint[]> {
  const db = await getDb();

  const scopeType = scope.propertyId ? 'property' : 'portfolio';
  const scopeId = scope.propertyId ?? null;

  const rows = await db
    .select({
      periodYear: performanceSnapshots.periodYear,
      periodMonth: performanceSnapshots.periodMonth,
      metrics: performanceSnapshots.metrics,
    })
    .from(performanceSnapshots)
    .where(
      and(
        eq(performanceSnapshots.organizationId, scope.organizationId),
        eq(performanceSnapshots.scopeType, scopeType),
        scopeId
          ? eq(performanceSnapshots.scopeId, scopeId)
          : isNull(performanceSnapshots.scopeId),
      ),
    )
    .orderBy(desc(performanceSnapshots.periodYear), desc(performanceSnapshots.periodMonth))
    .limit(months);

  return rows
    .reverse()
    .map((row) => {
      const metrics = (row.metrics ?? {}) as Record<string, number>;
      return {
        label: `${MONTH_LABELS[row.periodMonth - 1]}`,
        periodYear: row.periodYear,
        periodMonth: row.periodMonth,
        occupancyRate: Number(metrics.occupancyRate ?? 0),
        vacancyRate: Number(metrics.vacancyRate ?? 0),
        billed: Number(metrics.billed ?? 0),
        collected: Number(metrics.collected ?? 0),
        collectionRate: Number(metrics.collectionRate ?? 0),
        opex: Number(metrics.opex ?? 0),
        maintenanceCost: Number(metrics.maintenanceCost ?? 0),
        noi: Number(metrics.noi ?? 0),
        marketValue: Number(metrics.marketValue ?? 0),
        annualRentalValue: Number(metrics.annualRentalValue ?? 0),
        workOrdersCreated: Number(metrics.workOrdersCreated ?? 0),
        workOrdersCompleted: Number(metrics.workOrdersCompleted ?? 0),
      };
    });
}

/* -------------------------------------------------------------------------- */
/* Geography                                                                   */
/* -------------------------------------------------------------------------- */

export interface CityBreakdownRow {
  cityId: string;
  cityName: string;
  latitude: number | null;
  longitude: number | null;
  propertyCount: number;
  totalUnits: number;
  occupiedUnits: number;
  occupancyRate: number;
  marketValue: number;
  annualRentalValue: number;
}

export async function getCityBreakdown(scope: MetricScope): Promise<CityBreakdownRow[]> {
  const db = await getDb();
  const propertyIds = await resolveScopedPropertyIds(scope);
  if (propertyIds.length === 0) return [];

  const rows = await db
    .select({
      cityId: cities.id,
      cityName: cities.nameEn,
      latitude: cities.latitude,
      longitude: cities.longitude,
      propertyCount: sql<number>`count(distinct ${properties.id})::int`,
      totalUnits: sql<number>`count(${units.id})::int`,
      occupiedUnits: sql<number>`count(${units.id}) filter (where ${unitStatuses.countsAsOccupied})::int`,
      annualRentalValue: sql<number>`coalesce(sum(${unitPricing.askingRent}), 0)::float8`,
    })
    .from(properties)
    .innerJoin(cities, eq(cities.id, properties.cityId))
    .leftJoin(units, and(eq(units.propertyId, properties.id), isNull(units.deletedAt)))
    .leftJoin(unitStatuses, eq(unitStatuses.id, units.statusId))
    .leftJoin(unitPricing, eq(unitPricing.unitId, units.id))
    .where(propertyPredicate(scope))
    .groupBy(cities.id, cities.nameEn, cities.latitude, cities.longitude)
    .orderBy(desc(sql`count(${units.id})`));

  const valuationRows = await db
    .select({
      cityId: properties.cityId,
      marketValue: sql<number>`coalesce(sum(${valuations.marketValue}), 0)::float8`,
    })
    .from(valuations)
    .innerJoin(properties, eq(properties.id, valuations.propertyId))
    .where(and(inArray(valuations.propertyId, propertyIds), eq(valuations.isCurrent, true)))
    .groupBy(properties.cityId);

  const valuationByCity = new Map(valuationRows.map((row) => [row.cityId, Number(row.marketValue)]));

  return rows.map((row) => ({
    cityId: row.cityId,
    cityName: row.cityName,
    latitude: row.latitude,
    longitude: row.longitude,
    propertyCount: Number(row.propertyCount),
    totalUnits: Number(row.totalUnits),
    occupiedUnits: Number(row.occupiedUnits),
    occupancyRate: occupancyRate({
      totalUnits: Number(row.totalUnits),
      occupiedUnits: Number(row.occupiedUnits),
    }),
    marketValue: round2(valuationByCity.get(row.cityId) ?? 0),
    annualRentalValue: round2(Number(row.annualRentalValue)),
  }));
}

/* -------------------------------------------------------------------------- */
/* Collections                                                                 */
/* -------------------------------------------------------------------------- */

export interface CollectionSummary {
  billed: number;
  collected: number;
  outstanding: number;
  overdue: number;
  collectionRate: number;
  averageDaysOutstanding: number;
  aging: Array<{ key: string; label: string; amount: number; count: number; share: number }>;
}

export async function getCollectionSummary(scope: MetricScope): Promise<CollectionSummary> {
  const db = await getDb();
  const propertyIds = await resolveScopedPropertyIds(scope);
  const policy = await getPolicy(scope.organizationId);
  const { start, end } = periodBounds(scope);

  if (propertyIds.length === 0) {
    return {
      billed: 0,
      collected: 0,
      outstanding: 0,
      overdue: 0,
      collectionRate: 0,
      averageDaysOutstanding: 0,
      aging: policy.agingBuckets.map((bucket) => ({ ...bucket, amount: 0, count: 0, share: 0 })),
    };
  }

  const [totals] = await db
    .select({
      billed: sql<number>`coalesce(sum(${invoices.totalAmount}), 0)::float8`,
      collected: sql<number>`coalesce(sum(${invoices.paidAmount}), 0)::float8`,
    })
    .from(invoices)
    .where(
      and(
        inArray(invoices.propertyId, propertyIds),
        gte(invoices.invoiceDate, iso(start)),
        lte(invoices.invoiceDate, iso(end)),
      ),
    );

  const openRows = await db
    .select({ balance: invoices.balanceAmount, dueDate: invoices.dueDate, status: invoices.status })
    .from(invoices)
    .where(
      and(
        inArray(invoices.propertyId, propertyIds),
        inArray(invoices.status, ['due', 'overdue', 'partially_paid', 'upcoming']),
      ),
    );

  const now = new Date();
  const agingRows = openRows.map((row) => ({
    balance: Number(row.balance),
    daysOverdue: Math.floor((now.getTime() - new Date(row.dueDate).getTime()) / 86_400_000),
  }));

  const outstanding = round2(agingRows.reduce((sum, row) => sum + row.balance, 0));
  const overdue = round2(
    agingRows.filter((row) => row.daysOverdue > 0).reduce((sum, row) => sum + row.balance, 0),
  );

  const billed = round2(Number(totals?.billed ?? 0));
  const collected = round2(Number(totals?.collected ?? 0));

  return {
    billed,
    collected,
    outstanding,
    overdue,
    collectionRate: collectionRate({ billed, collected }),
    averageDaysOutstanding: averageDaysOutstanding(agingRows.filter((r) => r.daysOverdue > 0)),
    aging: ageReceivables(agingRows, policy.agingBuckets).map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      amount: bucket.amount,
      count: bucket.count,
      share: bucket.share,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Maintenance                                                                 */
/* -------------------------------------------------------------------------- */

export interface MaintenanceSummary {
  total: number;
  open: number;
  assigned: number;
  inProgress: number;
  pending: number;
  completed: number;
  cancelled: number;
  averageResolutionDays: number;
  slaCompliance: number;
  totalCost: number;
}

export async function getMaintenanceSummary(scope: MetricScope): Promise<MaintenanceSummary> {
  const db = await getDb();
  const propertyIds = await resolveScopedPropertyIds(scope);
  const { start, end } = periodBounds(scope);

  if (propertyIds.length === 0) {
    return {
      total: 0,
      open: 0,
      assigned: 0,
      inProgress: 0,
      pending: 0,
      completed: 0,
      cancelled: 0,
      averageResolutionDays: 0,
      slaCompliance: 0,
      totalCost: 0,
    };
  }

  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where ${workOrders.status} = 'open')::int`,
      assigned: sql<number>`count(*) filter (where ${workOrders.status} = 'assigned')::int`,
      inProgress: sql<number>`count(*) filter (where ${workOrders.status} = 'in_progress')::int`,
      pending: sql<number>`count(*) filter (where ${workOrders.status} = 'pending')::int`,
      completed: sql<number>`count(*) filter (where ${workOrders.status} = 'completed')::int`,
      cancelled: sql<number>`count(*) filter (where ${workOrders.status} = 'cancelled')::int`,
      avgResolutionHours: sql<number>`coalesce(avg(${workOrders.actualResolutionHours}), 0)::float8`,
      slaMet: sql<number>`count(*) filter (where ${workOrders.resolutionSlaMet} is true)::int`,
      slaEvaluated: sql<number>`count(*) filter (where ${workOrders.resolutionSlaMet} is not null)::int`,
      totalCost: sql<number>`coalesce(sum(${workOrders.actualCost}), 0)::float8`,
    })
    .from(workOrders)
    .where(
      and(
        inArray(workOrders.propertyId, propertyIds),
        gte(workOrders.createdAt, start),
        lte(workOrders.createdAt, end),
        isNull(workOrders.deletedAt),
      ),
    );

  return {
    total: Number(row?.total ?? 0),
    open: Number(row?.open ?? 0),
    assigned: Number(row?.assigned ?? 0),
    inProgress: Number(row?.inProgress ?? 0),
    pending: Number(row?.pending ?? 0),
    completed: Number(row?.completed ?? 0),
    cancelled: Number(row?.cancelled ?? 0),
    averageResolutionDays: round2(Number(row?.avgResolutionHours ?? 0) / 24),
    slaCompliance: slaCompliance(Number(row?.slaMet ?? 0), Number(row?.slaEvaluated ?? 0)),
    totalCost: round2(Number(row?.totalCost ?? 0)),
  };
}

/* -------------------------------------------------------------------------- */
/* Tenant concentration                                                        */
/* -------------------------------------------------------------------------- */

export async function getTenantConcentration(scope: MetricScope, topN = 10) {
  const db = await getDb();
  const propertyIds = await resolveScopedPropertyIds(scope);
  if (propertyIds.length === 0) return concentration([], topN);

  const { tenants } = await import('@/db/schema');
  const rows = await db
    .select({
      key: tenants.id,
      label: tenants.displayName,
      revenue: sql<number>`coalesce(sum(${contracts.annualRent}), 0)::float8`,
      units: sql<number>`count(*)::int`,
    })
    .from(contracts)
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .where(and(inArray(contracts.propertyId, propertyIds), eq(contracts.isActive, true)))
    .groupBy(tenants.id, tenants.displayName)
    .orderBy(desc(sql`sum(${contracts.annualRent})`))
    .limit(topN);

  const unitCountByTenant = new Map(rows.map((row) => [row.key, Number(row.units)]));
  const result = concentration(
    rows.map((row) => ({ key: row.key, label: row.label, revenue: Number(row.revenue) })),
    topN,
  );
  return {
    ...result,
    entries: result.entries.map((entry) => ({
      ...entry,
      unitCount: unitCountByTenant.get(entry.key) ?? 0,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Executive exceptions (BRD 74)                                               */
/* -------------------------------------------------------------------------- */

export interface ExceptionItem {
  key: string;
  severity: 'warning' | 'error';
  title: string;
  detail: string;
  value: string;
  href: string;
}

export async function getExecutiveExceptions(scope: MetricScope): Promise<ExceptionItem[]> {
  const db = await getDb();
  const policy = await getPolicy(scope.organizationId);
  const propertyIds = await resolveScopedPropertyIds(scope);
  if (propertyIds.length === 0) return [];

  const exceptions: ExceptionItem[] = [];

  // Long-vacant units
  const [longVacant] = await db
    .select({
      count: sql<number>`count(*)::int`,
      loss: sql<number>`coalesce(sum(${vacancyPeriods.estimatedTotalLoss}), 0)::float8`,
    })
    .from(vacancyPeriods)
    .where(
      and(
        inArray(vacancyPeriods.propertyId, propertyIds),
        isNull(vacancyPeriods.vacancyEndDate),
        gte(vacancyPeriods.daysVacant, policy.longVacancyDays),
      ),
    );

  if (Number(longVacant?.count ?? 0) > 0) {
    exceptions.push({
      key: 'long_vacancy',
      severity: 'warning',
      title: 'Long-vacant units',
      detail: `${longVacant.count} ${Number(longVacant.count) === 1 ? 'unit has' : 'units have'} been vacant for more than ${policy.longVacancyDays} days`,
      value: `SAR ${Math.round(Number(longVacant.loss)).toLocaleString()} estimated loss`,
      href: `/units?availability=available&minDaysVacant=${policy.longVacancyDays}`,
    });
  }

  // Properties below the collection floor
  const performance = await getPropertyPerformance(scope);
  const weakCollection = performance.filter(
    (row) => row.billed > 0 && row.collectionRate < policy.collectionRateFloor,
  );
  for (const property of weakCollection.slice(0, 3)) {
    exceptions.push({
      key: `collection_${property.propertyId}`,
      severity: 'error',
      title: `Collection below target at ${property.name}`,
      detail: `Collection rate ${property.collectionRate}% against a ${policy.collectionRateFloor}% floor`,
      value: `SAR ${Math.round(property.outstanding).toLocaleString()} outstanding`,
      href: `/collections?propertyId=${property.propertyId}`,
    });
  }

  // Contracts expiring inside the alert window
  const horizon = new Date();
  horizon.setUTCDate(horizon.getUTCDate() + policy.contractExpiryWindowDays);
  const [expiring] = await db
    .select({
      count: sql<number>`count(*)::int`,
      value: sql<number>`coalesce(sum(${contracts.annualRent}), 0)::float8`,
    })
    .from(contracts)
    .where(
      and(
        inArray(contracts.propertyId, propertyIds),
        eq(contracts.isActive, true),
        lte(contracts.endDate, iso(horizon)),
      ),
    );

  if (Number(expiring?.count ?? 0) > 0) {
    exceptions.push({
      key: 'expiring_contracts',
      severity: 'warning',
      title: 'Contracts expiring soon',
      detail: `${expiring.count} ${Number(expiring.count) === 1 ? 'contract expires' : 'contracts expire'} within ${policy.contractExpiryWindowDays} days`,
      value: `SAR ${Math.round(Number(expiring.value)).toLocaleString()} at risk`,
      href: `/contracts?expiringWithinDays=${policy.contractExpiryWindowDays}`,
    });
  }

  // Maintenance SLA breaches
  const [slaBreaches] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workOrders)
    .where(
      and(
        inArray(workOrders.propertyId, propertyIds),
        eq(workOrders.resolutionSlaMet, false),
        gte(workOrders.createdAt, new Date(Date.now() - 90 * 86_400_000)),
      ),
    );

  if (Number(slaBreaches?.count ?? 0) > 0) {
    exceptions.push({
      key: 'sla_breach',
      severity: 'error',
      title: 'Maintenance SLA breaches',
      detail: `${slaBreaches.count} work ${Number(slaBreaches.count) === 1 ? 'order' : 'orders'} exceeded the resolution target in the last 90 days`,
      value: `${slaBreaches.count} breaches`,
      href: '/maintenance?slaBreached=true',
    });
  }

  // Tenant concentration
  const tenantMix = await getTenantConcentration(scope, 1);
  if (tenantMix.topShare > policy.tenantConcentrationPercent) {
    exceptions.push({
      key: 'tenant_concentration',
      severity: 'warning',
      title: 'High tenant concentration',
      detail: `${tenantMix.entries[0]?.label} accounts for ${tenantMix.topShare}% of contracted revenue`,
      value: `${tenantMix.topShare}% of revenue`,
      href: '/tenants',
    });
  }

  // Maintenance spend against budget
  const summary = await getPortfolioSummary(scope);
  const { budgets, budgetLines } = await import('@/db/schema');
  const [budgetRow] = await db
    .select({ total: sql<number>`coalesce(sum(${budgetLines.budgetAmount}), 0)::float8` })
    .from(budgetLines)
    .innerJoin(budgets, eq(budgets.id, budgetLines.budgetId))
    .where(
      and(
        inArray(budgets.propertyId, propertyIds),
        eq(budgetLines.lineType, 'maintenance'),
        eq(budgets.fiscalYear, new Date().getUTCFullYear()),
      ),
    );

  const maintenanceBudget = Number(budgetRow?.total ?? 0);
  if (maintenanceBudget > 0) {
    const variance = round2(
      safeDivide(summary.maintenanceCost - maintenanceBudget, maintenanceBudget) * 100,
    );
    if (variance > policy.maintenanceBudgetVariance) {
      exceptions.push({
        key: 'maintenance_budget',
        severity: 'warning',
        title: 'Maintenance spend over budget',
        detail: `Actual spend is ${variance}% above the approved maintenance budget`,
        value: `SAR ${Math.round(summary.maintenanceCost - maintenanceBudget).toLocaleString()} over`,
        href: '/financials/budgets',
      });
    }
  }

  return exceptions;
}

/* -------------------------------------------------------------------------- */
/* Unit status breakdown                                                       */
/* -------------------------------------------------------------------------- */

export interface StatusBreakdownRow {
  key: string;
  label: string;
  colorToken: string;
  availabilityClass: string;
  count: number;
  share: number;
}

export async function getUnitStatusBreakdown(scope: MetricScope): Promise<StatusBreakdownRow[]> {
  const db = await getDb();
  const propertyIds = await resolveScopedPropertyIds(scope);
  if (propertyIds.length === 0) return [];

  const rows = await db
    .select({
      key: unitStatuses.key,
      label: unitStatuses.nameEn,
      colorToken: unitStatuses.colorToken,
      availabilityClass: unitStatuses.availabilityClass,
      count: sql<number>`count(*)::int`,
    })
    .from(units)
    .innerJoin(unitStatuses, eq(unitStatuses.id, units.statusId))
    .where(unitScopePredicate(scope, propertyIds))
    .groupBy(unitStatuses.key, unitStatuses.nameEn, unitStatuses.colorToken, unitStatuses.availabilityClass, unitStatuses.sortOrder)
    .orderBy(asc(unitStatuses.sortOrder));

  const total = rows.reduce((sum, row) => sum + Number(row.count), 0);
  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    colorToken: row.colorToken,
    availabilityClass: row.availabilityClass,
    count: Number(row.count),
    share: round2(safeDivide(Number(row.count), total) * 100),
  }));
}

/** Rolls unit statuses up into the five KPI buckets shown on the dashboard. */
export async function getAvailabilityBreakdown(scope: MetricScope) {
  const rows = await getUnitStatusBreakdown(scope);
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const bucket = (availabilityClass: string) =>
    rows.filter((row) => row.availabilityClass === availabilityClass).reduce((sum, row) => sum + row.count, 0);

  const available = bucket('available');
  const reserved = bucket('reserved');
  const leased = bucket('leased');
  const notAvailable = bucket('not_available');

  return {
    total,
    available,
    reserved,
    leased,
    notAvailable,
    availableShare: round2(safeDivide(available, total) * 100),
    reservedShare: round2(safeDivide(reserved, total) * 100),
    leasedShare: round2(safeDivide(leased, total) * 100),
    notAvailableShare: round2(safeDivide(notAvailable, total) * 100),
  };
}

export { propertyPredicate };

/* -------------------------------------------------------------------------- */
/* Dashboard hierarchical filters (City → Building → Unit)                     */
/* -------------------------------------------------------------------------- */

export interface DashboardFilterOptions {
  cities: Array<{ id: string; name: string }>;
  buildings: Array<{ id: string; name: string; cityId: string; propertyId: string; propertyName: string }>;
  units: Array<{ id: string; name: string; buildingId: string | null; propertyId: string; cityId: string }>;
}

/**
 * Real hierarchy options for the dashboard filters, scoped to the user's
 * organization and data scope. Buildings and units carry their parent ids so
 * the client can cascade and the server can resolve a selection to a concrete
 * city/property/building/unit scope. Any id not present here is out of scope and
 * is ignored server-side (an IDOR-safe allow-list).
 */
export async function getDashboardFilterOptions(user: SessionUser): Promise<DashboardFilterOptions> {
  const db = await getDb();
  const scope = scopeFromSession(user);
  const propertyIds = await resolveScopedPropertyIds(scope);
  if (propertyIds.length === 0) return { cities: [], buildings: [], units: [] };

  const [cityRows, buildingRows, unitRows] = await Promise.all([
    db
      .selectDistinct({ id: cities.id, name: cities.nameEn })
      .from(properties)
      .innerJoin(cities, eq(cities.id, properties.cityId))
      .where(propertyPredicate(scope))
      .orderBy(asc(cities.nameEn)),
    db
      .select({ id: buildings.id, name: buildings.nameEn, cityId: properties.cityId, propertyId: buildings.propertyId, propertyName: properties.nameEn })
      .from(buildings)
      .innerJoin(properties, eq(properties.id, buildings.propertyId))
      .where(and(inArray(buildings.propertyId, propertyIds), isNull(buildings.deletedAt)))
      .orderBy(asc(buildings.nameEn)),
    db
      .select({ id: units.id, name: units.unitNumber, buildingId: units.buildingId, propertyId: units.propertyId, cityId: properties.cityId })
      .from(units)
      .innerJoin(properties, eq(properties.id, units.propertyId))
      .where(and(inArray(units.propertyId, propertyIds), isNull(units.deletedAt)))
      .orderBy(asc(units.unitNumber)),
  ]);

  return {
    cities: cityRows,
    buildings: buildingRows.map((b) => ({ id: b.id, name: b.name, cityId: b.cityId, propertyId: b.propertyId, propertyName: b.propertyName })),
    units: unitRows.map((u) => ({ id: u.id, name: u.name, buildingId: u.buildingId, propertyId: u.propertyId, cityId: u.cityId })),
  };
}

export interface UnitFocus {
  unit: {
    id: string;
    unitNumber: string;
    code: string;
    unitType: string;
    propertyName: string;
    buildingName: string | null;
    floorName: string | null;
    cityName: string;
    statusKey: string;
    statusLabel: string;
    availabilityClass: string;
    leasableArea: number | null;
    bedroomCount: number | null;
    bathroomCount: number | null;
  };
  contract: {
    contractNumber: string;
    tenantName: string;
    startDate: string;
    endDate: string;
    annualRent: number;
    status: string;
    renewalStatus: string;
  } | null;
  financial: { billed: number; collected: number; outstanding: number; collectionRate: number };
  maintenance: { openWorkOrders: number; completedWorkOrders: number; totalMaintenanceCost: number; lastCompletedAt: string | null };
}

/** Unit 360 summary for a specifically selected unit (organization-scoped). */
export async function getUnitFocus(organizationId: string, unitId: string): Promise<UnitFocus | null> {
  const db = await getDb();
  const [unit] = await db
    .select({
      id: units.id,
      unitNumber: units.unitNumber,
      code: units.code,
      unitType: unitTypes.nameEn,
      propertyName: properties.nameEn,
      buildingName: buildings.nameEn,
      floorName: floors.nameEn,
      cityName: cities.nameEn,
      statusKey: unitStatuses.key,
      statusLabel: unitStatuses.nameEn,
      availabilityClass: units.computedAvailabilityClass,
      leasableArea: units.leasableArea,
      bedroomCount: units.bedroomCount,
      bathroomCount: units.bathroomCount,
    })
    .from(units)
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .innerJoin(unitTypes, eq(unitTypes.id, units.unitTypeId))
    .innerJoin(unitStatuses, eq(unitStatuses.id, units.statusId))
    .innerJoin(cities, eq(cities.id, properties.cityId))
    .leftJoin(buildings, eq(buildings.id, units.buildingId))
    .leftJoin(floors, eq(floors.id, units.floorId))
    .where(and(eq(units.id, unitId), eq(units.organizationId, organizationId), isNull(units.deletedAt)))
    .limit(1);
  if (!unit) return null;

  const [contractRow] = await db
    .select({
      contractNumber: contracts.contractNumber,
      tenantName: tenants.displayName,
      startDate: contracts.startDate,
      endDate: contracts.endDate,
      annualRent: contracts.annualRent,
      status: contracts.status,
      renewalStatus: contracts.renewalStatus,
    })
    .from(contracts)
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .where(and(eq(contracts.unitId, unitId), eq(contracts.organizationId, organizationId), eq(contracts.isActive, true), isNull(contracts.deletedAt)))
    .orderBy(desc(contracts.startDate))
    .limit(1);

  const [invoiceRow] = await db
    .select({
      billed: sql<number>`coalesce(sum(${invoices.totalAmount}), 0)::float8`,
      collected: sql<number>`coalesce(sum(${invoices.paidAmount}), 0)::float8`,
      outstanding: sql<number>`coalesce(sum(${invoices.balanceAmount}), 0)::float8`,
    })
    .from(invoices)
    .where(and(eq(invoices.unitId, unitId), eq(invoices.organizationId, organizationId), isNull(invoices.deletedAt)));

  const [woRow] = await db
    .select({
      open: sql<number>`count(*) filter (where ${workOrders.status} in ('open','assigned','in_progress','pending'))::int`,
      completed: sql<number>`count(*) filter (where ${workOrders.status} = 'completed')::int`,
      lastCompletedAt: sql<string | null>`max(${workOrders.completedAt})`,
    })
    .from(workOrders)
    .where(and(eq(workOrders.unitId, unitId), eq(workOrders.organizationId, organizationId), isNull(workOrders.deletedAt)));

  const [costRow] = await db
    .select({ total: sql<number>`coalesce(sum(${maintenanceCosts.amount}), 0)::float8` })
    .from(maintenanceCosts)
    .where(and(eq(maintenanceCosts.unitId, unitId), eq(maintenanceCosts.organizationId, organizationId)));

  const billed = round2(Number(invoiceRow?.billed ?? 0));
  const collected = round2(Number(invoiceRow?.collected ?? 0));

  return {
    unit: {
      id: unit.id,
      unitNumber: unit.unitNumber,
      code: unit.code,
      unitType: unit.unitType,
      propertyName: unit.propertyName,
      buildingName: unit.buildingName,
      floorName: unit.floorName,
      cityName: unit.cityName,
      statusKey: unit.statusKey,
      statusLabel: unit.statusLabel,
      availabilityClass: unit.availabilityClass,
      leasableArea: unit.leasableArea,
      bedroomCount: unit.bedroomCount,
      bathroomCount: unit.bathroomCount,
    },
    contract: contractRow
      ? {
          contractNumber: contractRow.contractNumber,
          tenantName: contractRow.tenantName,
          startDate: contractRow.startDate,
          endDate: contractRow.endDate,
          annualRent: Number(contractRow.annualRent),
          status: contractRow.status,
          renewalStatus: contractRow.renewalStatus,
        }
      : null,
    financial: {
      billed,
      collected,
      outstanding: round2(Number(invoiceRow?.outstanding ?? 0)),
      collectionRate: collectionRate({ billed, collected }),
    },
    maintenance: {
      openWorkOrders: Number(woRow?.open ?? 0),
      completedWorkOrders: Number(woRow?.completed ?? 0),
      totalMaintenanceCost: round2(Number(costRow?.total ?? 0)),
      lastCompletedAt: woRow?.lastCompletedAt ?? null,
    },
  };
}
