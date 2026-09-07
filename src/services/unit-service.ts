import 'server-only';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  buildings,
  contracts,
  floors,
  priceHistory,
  properties,
  tenants,
  unitPricing,
  units,
  unitStatuses,
  unitTypes,
} from '@/db/schema';
import { round2 } from '@/lib/utils';

/**
 * Unit repository. Availability filters use the engine-derived
 * `computed_availability_class`, never the raw status alone (BRD 14).
 */

export interface UnitListFilters {
  organizationId: string;
  allowedPropertyIds?: string[] | null;
  search?: string;
  propertyId?: string;
  buildingId?: string;
  floorId?: string;
  unitTypeId?: string;
  usageType?: string;
  statusKey?: string;
  availability?: string;
  minArea?: number;
  maxArea?: number;
  minRent?: number;
  maxRent?: number;
  sort?: 'code' | 'rent_desc' | 'rent_asc' | 'area_desc' | 'availability';
  page: number;
  pageSize: number;
}

export interface UnitListItem {
  id: string;
  code: string;
  unitNumber: string;
  propertyId: string;
  propertyName: string;
  buildingName: string | null;
  floorName: string | null;
  typeName: string;
  usageType: string;
  statusKey: string;
  statusLabel: string;
  statusColor: string;
  availabilityClass: string;
  leasableArea: number;
  askingRent: number;
  rentPerSqm: number;
  availableFrom: string | null;
  publicationState: string;
  tenantName: string | null;
}

function unitWhere(filters: UnitListFilters): SQL {
  const conditions: SQL[] = [eq(units.organizationId, filters.organizationId), isNull(units.deletedAt)];
  if (filters.allowedPropertyIds?.length) conditions.push(inArray(units.propertyId, filters.allowedPropertyIds));
  if (filters.search) {
    conditions.push(
      or(ilike(units.code, `%${filters.search}%`), ilike(units.unitNumber, `%${filters.search}%`)) as SQL,
    );
  }
  if (filters.propertyId) conditions.push(eq(units.propertyId, filters.propertyId));
  if (filters.buildingId) conditions.push(eq(units.buildingId, filters.buildingId));
  if (filters.floorId) conditions.push(eq(units.floorId, filters.floorId));
  if (filters.unitTypeId) conditions.push(eq(units.unitTypeId, filters.unitTypeId));
  if (filters.usageType) conditions.push(eq(units.usageType, filters.usageType));
  if (filters.availability) conditions.push(eq(units.computedAvailabilityClass, filters.availability));
  if (filters.minArea) conditions.push(gte(units.leasableArea, filters.minArea));
  if (filters.maxArea) conditions.push(lte(units.leasableArea, filters.maxArea));
  return and(...conditions) as SQL;
}

export async function listUnits(filters: UnitListFilters): Promise<{ items: UnitListItem[]; total: number }> {
  const db = await getDb();

  // Status-key and rent filters require the joined tables, so build the full
  // predicate that includes them.
  const extra: SQL[] = [];
  if (filters.statusKey) extra.push(eq(unitStatuses.key, filters.statusKey));
  if (filters.minRent) extra.push(gte(unitPricing.askingRent, filters.minRent));
  if (filters.maxRent) extra.push(lte(unitPricing.askingRent, filters.maxRent));
  const where = extra.length ? (and(unitWhere(filters), ...extra) as SQL) : unitWhere(filters);

  const orderBy = (() => {
    switch (filters.sort) {
      case 'rent_desc':
        return desc(unitPricing.askingRent);
      case 'rent_asc':
        return asc(unitPricing.askingRent);
      case 'area_desc':
        return desc(units.leasableArea);
      case 'availability':
        return asc(units.computedAvailabilityClass);
      default:
        return asc(units.code);
    }
  })();

  const baseQuery = db
    .select({
      id: units.id,
      code: units.code,
      unitNumber: units.unitNumber,
      propertyId: units.propertyId,
      propertyName: properties.nameEn,
      buildingName: buildings.nameEn,
      floorName: floors.nameEn,
      typeName: unitTypes.nameEn,
      usageType: units.usageType,
      statusKey: unitStatuses.key,
      statusLabel: unitStatuses.nameEn,
      statusColor: unitStatuses.colorToken,
      availabilityClass: units.computedAvailabilityClass,
      leasableArea: units.leasableArea,
      askingRent: unitPricing.askingRent,
      rentPerSqm: unitPricing.rentPerSqm,
      availableFrom: units.computedAvailableFrom,
      publicationState: units.publicationState,
      tenantName: tenants.displayName,
    })
    .from(units)
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .innerJoin(unitTypes, eq(unitTypes.id, units.unitTypeId))
    .innerJoin(unitStatuses, eq(unitStatuses.id, units.statusId))
    .leftJoin(buildings, eq(buildings.id, units.buildingId))
    .leftJoin(floors, eq(floors.id, units.floorId))
    .leftJoin(unitPricing, eq(unitPricing.unitId, units.id))
    .leftJoin(
      contracts,
      and(eq(contracts.unitId, units.id), eq(contracts.isActive, true), isNull(contracts.deletedAt)),
    )
    .leftJoin(tenants, eq(tenants.id, contracts.tenantId))
    .where(where);

  const rows = await baseQuery
    .orderBy(orderBy)
    .limit(filters.pageSize)
    .offset((filters.page - 1) * filters.pageSize);

  const countRows = await db
    .select({ total: count() })
    .from(units)
    .innerJoin(unitStatuses, eq(unitStatuses.id, units.statusId))
    .leftJoin(unitPricing, eq(unitPricing.unitId, units.id))
    .where(where);

  const items: UnitListItem[] = rows.map((row) => ({
    id: row.id,
    code: row.code,
    unitNumber: row.unitNumber,
    propertyId: row.propertyId,
    propertyName: row.propertyName,
    buildingName: row.buildingName,
    floorName: row.floorName,
    typeName: row.typeName,
    usageType: row.usageType,
    statusKey: row.statusKey,
    statusLabel: row.statusLabel,
    statusColor: row.statusColor,
    availabilityClass: row.availabilityClass,
    leasableArea: round2(Number(row.leasableArea ?? 0)),
    askingRent: round2(Number(row.askingRent ?? 0)),
    rentPerSqm: round2(Number(row.rentPerSqm ?? 0)),
    availableFrom: row.availableFrom,
    publicationState: row.publicationState,
    tenantName: row.tenantName,
  }));

  return { items, total: Number(countRows[0]?.total ?? 0) };
}

export async function getUnitFilterOptions(organizationId: string) {
  const db = await getDb();
  const [propertyRows, typeRows, statusRows] = await Promise.all([
    db
      .select({ id: properties.id, name: properties.nameEn })
      .from(properties)
      .where(and(eq(properties.organizationId, organizationId), isNull(properties.deletedAt)))
      .orderBy(properties.nameEn),
    db
      .select({ id: unitTypes.id, name: unitTypes.nameEn })
      .from(unitTypes)
      .where(and(eq(unitTypes.organizationId, organizationId), eq(unitTypes.isActive, true)))
      .orderBy(unitTypes.sortOrder),
    db
      .select({ key: unitStatuses.key, name: unitStatuses.nameEn })
      .from(unitStatuses)
      .where(and(eq(unitStatuses.organizationId, organizationId), eq(unitStatuses.isActive, true)))
      .orderBy(unitStatuses.sortOrder),
  ]);
  return { properties: propertyRows, types: typeRows, statuses: statusRows };
}

export interface UnitDetail extends UnitListItem {
  grossArea: number | null;
  netArea: number | null;
  terraceArea: number | null;
  balconyArea: number | null;
  storageArea: number | null;
  parkingAllocation: number;
  bedroomCount: number | null;
  bathroomCount: number | null;
  furnishingStatus: string;
  hvacType: string | null;
  electricityMeterNumber: string | null;
  waterMeterNumber: string | null;
  condition: string | null;
  fitOutStatus: string;
  ceilingHeight: number | null;
  frontage: number | null;
  electricalLoad: string | null;
  descriptionEn: string | null;
  permittedActivities: string[];
  signageRights: boolean;
  loadingAccess: boolean;
  serviceCharges: number;
  depositAmount: number;
  marketRent: number | null;
  targetRent: number | null;
  minimumRent: number | null;
  vacancyStartDate: string | null;
}

export async function getUnitDetail(
  organizationId: string,
  unitId: string,
): Promise<UnitDetail | null> {
  const db = await getDb();
  const [row] = await db
    .select({
      id: units.id,
      code: units.code,
      unitNumber: units.unitNumber,
      propertyId: units.propertyId,
      propertyName: properties.nameEn,
      buildingName: buildings.nameEn,
      floorName: floors.nameEn,
      typeName: unitTypes.nameEn,
      usageType: units.usageType,
      statusKey: unitStatuses.key,
      statusLabel: unitStatuses.nameEn,
      statusColor: unitStatuses.colorToken,
      availabilityClass: units.computedAvailabilityClass,
      leasableArea: units.leasableArea,
      grossArea: units.grossArea,
      netArea: units.netArea,
      terraceArea: units.terraceArea,
      balconyArea: units.balconyArea,
      storageArea: units.storageArea,
      parkingAllocation: units.parkingAllocation,
      bedroomCount: units.bedroomCount,
      bathroomCount: units.bathroomCount,
      furnishingStatus: units.furnishingStatus,
      hvacType: units.hvacType,
      electricityMeterNumber: units.electricityMeterNumber,
      waterMeterNumber: units.waterMeterNumber,
      condition: units.condition,
      fitOutStatus: units.fitOutStatus,
      ceilingHeight: units.ceilingHeight,
      frontage: units.frontage,
      electricalLoad: units.electricalLoad,
      descriptionEn: units.descriptionEn,
      permittedActivities: units.permittedActivities,
      signageRights: units.signageRights,
      loadingAccess: units.loadingAccess,
      publicationState: units.publicationState,
      availableFrom: units.computedAvailableFrom,
      vacancyStartDate: units.vacancyStartDate,
      askingRent: unitPricing.askingRent,
      rentPerSqm: unitPricing.rentPerSqm,
      serviceCharges: unitPricing.serviceCharges,
      depositAmount: unitPricing.depositAmount,
      marketRent: unitPricing.marketRent,
      targetRent: unitPricing.targetRent,
      minimumRent: unitPricing.minimumRent,
    })
    .from(units)
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .innerJoin(unitTypes, eq(unitTypes.id, units.unitTypeId))
    .innerJoin(unitStatuses, eq(unitStatuses.id, units.statusId))
    .leftJoin(buildings, eq(buildings.id, units.buildingId))
    .leftJoin(floors, eq(floors.id, units.floorId))
    .leftJoin(unitPricing, eq(unitPricing.unitId, units.id))
    .where(and(eq(units.id, unitId), eq(units.organizationId, organizationId), isNull(units.deletedAt)))
    .limit(1);

  if (!row) return null;

  const [activeContract] = await db
    .select({ tenantName: tenants.displayName })
    .from(contracts)
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .where(and(eq(contracts.unitId, unitId), eq(contracts.isActive, true)))
    .limit(1);

  return {
    ...row,
    leasableArea: round2(Number(row.leasableArea ?? 0)),
    askingRent: round2(Number(row.askingRent ?? 0)),
    rentPerSqm: round2(Number(row.rentPerSqm ?? 0)),
    serviceCharges: round2(Number(row.serviceCharges ?? 0)),
    depositAmount: round2(Number(row.depositAmount ?? 0)),
    marketRent: row.marketRent !== null ? round2(Number(row.marketRent)) : null,
    targetRent: row.targetRent !== null ? round2(Number(row.targetRent)) : null,
    minimumRent: row.minimumRent !== null ? round2(Number(row.minimumRent)) : null,
    permittedActivities: row.permittedActivities ?? [],
    tenantName: activeContract?.tenantName ?? null,
  } as UnitDetail;
}

export async function getUnitPriceHistory(unitId: string) {
  const db = await getDb();
  return db
    .select()
    .from(priceHistory)
    .where(eq(priceHistory.unitId, unitId))
    .orderBy(desc(priceHistory.createdAt))
    .limit(50);
}

export async function getUnitLeaseHistory(unitId: string) {
  const db = await getDb();
  return db
    .select({
      id: contracts.id,
      contractNumber: contracts.contractNumber,
      tenantName: tenants.displayName,
      startDate: contracts.startDate,
      endDate: contracts.endDate,
      annualRent: contracts.annualRent,
      status: contracts.status,
    })
    .from(contracts)
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .where(and(eq(contracts.unitId, unitId), isNull(contracts.deletedAt)))
    .orderBy(desc(contracts.startDate))
    .limit(20);
}

/** Availability KPI counts for the unit inventory header. */
export async function getUnitAvailabilityCounts(
  organizationId: string,
  allowedPropertyIds: string[] | null,
) {
  const db = await getDb();
  const conditions: SQL[] = [eq(units.organizationId, organizationId), isNull(units.deletedAt)];
  if (allowedPropertyIds?.length) conditions.push(inArray(units.propertyId, allowedPropertyIds));

  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      available: sql<number>`count(*) filter (where ${units.computedAvailabilityClass} = 'available')::int`,
      reserved: sql<number>`count(*) filter (where ${units.computedAvailabilityClass} = 'reserved')::int`,
      leased: sql<number>`count(*) filter (where ${units.computedAvailabilityClass} = 'leased')::int`,
      notAvailable: sql<number>`count(*) filter (where ${units.computedAvailabilityClass} = 'not_available')::int`,
    })
    .from(units)
    .where(and(...conditions));

  return {
    total: Number(row?.total ?? 0),
    available: Number(row?.available ?? 0),
    reserved: Number(row?.reserved ?? 0),
    leased: Number(row?.leased ?? 0),
    notAvailable: Number(row?.notAvailable ?? 0),
  };
}
