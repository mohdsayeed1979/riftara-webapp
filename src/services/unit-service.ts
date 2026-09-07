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
import { recordAudit } from '@/lib/audit';
import { notFound, validationError } from '@/lib/errors';
import type { DbExecutor } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';
import { computeUnitAvailability } from '@/services/availability-service';
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

/* ------------------------- Unit master-data writes ------------------------ */

/** Reference data for the New / Edit Unit form. Hierarchy Property -> Building
 *  -> Floor, all organization-scoped and loaded from the database (never
 *  hardcoded). Full lists carry parent ids so the form filters on the client
 *  and the server re-validates. */
export async function getUnitFormReferenceData(organizationId: string) {
  const db = await getDb();
  const [propertyRows, buildingRows, floorRows, typeRows, statusRows] = await Promise.all([
    db
      .select({ id: properties.id, name: properties.nameEn })
      .from(properties)
      .where(and(eq(properties.organizationId, organizationId), isNull(properties.deletedAt)))
      .orderBy(asc(properties.nameEn)),
    db
      .select({ id: buildings.id, name: buildings.nameEn, propertyId: buildings.propertyId })
      .from(buildings)
      .where(and(eq(buildings.organizationId, organizationId), isNull(buildings.deletedAt)))
      .orderBy(asc(buildings.code)),
    db
      .select({ id: floors.id, name: floors.nameEn, buildingId: floors.buildingId, level: floors.level })
      .from(floors)
      .where(and(eq(floors.organizationId, organizationId), isNull(floors.deletedAt)))
      .orderBy(asc(floors.level)),
    db
      .select({ id: unitTypes.id, name: unitTypes.nameEn })
      .from(unitTypes)
      .where(and(eq(unitTypes.organizationId, organizationId), eq(unitTypes.isActive, true)))
      .orderBy(asc(unitTypes.sortOrder)),
    db
      .select({ id: unitStatuses.id, name: unitStatuses.nameEn, key: unitStatuses.key })
      .from(unitStatuses)
      .where(and(eq(unitStatuses.organizationId, organizationId), eq(unitStatuses.isActive, true)))
      .orderBy(asc(unitStatuses.sortOrder)),
  ]);
  return { properties: propertyRows, buildings: buildingRows, floors: floorRows, types: typeRows, statuses: statusRows };
}

export async function nextUnitCode(organizationId: string): Promise<string> {
  const db = await getDb();
  const [{ total }] = await db
    .select({ total: count() })
    .from(units)
    .where(eq(units.organizationId, organizationId));
  return `UNIT-${String(Number(total) + 1).padStart(4, '0')}`;
}

export interface UnitWriteInput {
  propertyId: string;
  buildingId?: string | null;
  floorId?: string | null;
  code: string;
  unitNumber: string;
  unitTypeId: string;
  usageType: string;
  statusId: string;
  grossArea?: number | null;
  netArea?: number | null;
  leasableArea?: number | null;
  terraceArea?: number | null;
  balconyArea?: number | null;
  storageArea?: number | null;
  parkingAllocation?: number;
  roomCount?: number | null;
  bedroomCount?: number | null;
  bathroomCount?: number | null;
  hasKitchen?: boolean;
  hasMaidRoom?: boolean;
  hasDriverRoom?: boolean;
  furnishingStatus?: string;
  hvacType?: string | null;
  electricityMeterNumber?: string | null;
  waterMeterNumber?: string | null;
  electricityAccount?: string | null;
  waterAccount?: string | null;
  condition?: string | null;
  fitOutStatus?: string;
  frontage?: number | null;
  ceilingHeight?: number | null;
  electricalLoad?: string | null;
  permittedActivities?: string[];
  signageRights?: boolean;
  loadingAccess?: boolean;
  deliveryAccess?: boolean;
  fireSystem?: boolean;
  hvacCapacity?: string | null;
  utilityCapacity?: string | null;
  fitOutRequirements?: string | null;
  availabilityDate?: string | null;
  descriptionEn?: string | null;
  descriptionAr?: string | null;
}

/** Validates the Property -> Building -> Floor chain inside the org and returns
 *  the resolved building/floor ids (null when not provided). */
async function resolveHierarchy(
  tx: DbExecutor,
  organizationId: string,
  input: { propertyId: string; buildingId?: string | null; floorId?: string | null },
): Promise<{ buildingId: string | null; floorId: string | null }> {
  const [property] = await tx
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.id, input.propertyId), eq(properties.organizationId, organizationId), isNull(properties.deletedAt)))
    .limit(1);
  if (!property) throw notFound('Property', input.propertyId);

  let buildingId: string | null = null;
  if (input.buildingId) {
    const [building] = await tx
      .select({ id: buildings.id })
      .from(buildings)
      .where(and(eq(buildings.id, input.buildingId), eq(buildings.organizationId, organizationId), eq(buildings.propertyId, input.propertyId), isNull(buildings.deletedAt)))
      .limit(1);
    if (!building) throw validationError('The selected building does not belong to the selected property.');
    buildingId = building.id;
  }

  let floorId: string | null = null;
  if (input.floorId) {
    if (!buildingId) throw validationError('Select a building before choosing a floor.');
    const [floor] = await tx
      .select({ id: floors.id })
      .from(floors)
      .where(and(eq(floors.id, input.floorId), eq(floors.organizationId, organizationId), eq(floors.buildingId, buildingId), isNull(floors.deletedAt)))
      .limit(1);
    if (!floor) throw validationError('The selected floor does not belong to the selected building.');
    floorId = floor.id;
  }

  return { buildingId, floorId };
}

function unitValues(input: UnitWriteInput, hierarchy: { buildingId: string | null; floorId: string | null }) {
  return {
    code: input.code,
    unitNumber: input.unitNumber,
    unitTypeId: input.unitTypeId,
    usageType: input.usageType,
    statusId: input.statusId,
    buildingId: hierarchy.buildingId,
    floorId: hierarchy.floorId,
    grossArea: input.grossArea ?? null,
    netArea: input.netArea ?? null,
    leasableArea: input.leasableArea ?? null,
    terraceArea: input.terraceArea ?? null,
    balconyArea: input.balconyArea ?? null,
    storageArea: input.storageArea ?? null,
    parkingAllocation: input.parkingAllocation ?? 0,
    roomCount: input.roomCount ?? null,
    bedroomCount: input.bedroomCount ?? null,
    bathroomCount: input.bathroomCount ?? null,
    hasKitchen: input.hasKitchen ?? false,
    hasMaidRoom: input.hasMaidRoom ?? false,
    hasDriverRoom: input.hasDriverRoom ?? false,
    furnishingStatus: input.furnishingStatus ?? 'unfurnished',
    hvacType: input.hvacType ?? null,
    electricityMeterNumber: input.electricityMeterNumber ?? null,
    waterMeterNumber: input.waterMeterNumber ?? null,
    electricityAccount: input.electricityAccount ?? null,
    waterAccount: input.waterAccount ?? null,
    condition: input.condition ?? null,
    fitOutStatus: input.fitOutStatus ?? 'shell_core',
    frontage: input.frontage ?? null,
    ceilingHeight: input.ceilingHeight ?? null,
    electricalLoad: input.electricalLoad ?? null,
    permittedActivities: input.permittedActivities ?? [],
    signageRights: input.signageRights ?? false,
    loadingAccess: input.loadingAccess ?? false,
    deliveryAccess: input.deliveryAccess ?? false,
    fireSystem: input.fireSystem ?? false,
    hvacCapacity: input.hvacCapacity ?? null,
    utilityCapacity: input.utilityCapacity ?? null,
    fitOutRequirements: input.fitOutRequirements ?? null,
    availabilityDate: input.availabilityDate ?? null,
    descriptionEn: input.descriptionEn ?? null,
    descriptionAr: input.descriptionAr ?? null,
  };
}

export async function createUnit(actor: SessionUser, input: UnitWriteInput): Promise<{ id: string }> {
  const db = await getDb();
  const created = await db.transaction(async (tx) => {
    const hierarchy = await resolveHierarchy(tx, actor.organizationId, input);
    const [row] = await tx
      .insert(units)
      .values({
        organizationId: actor.organizationId, // session org only — never client-supplied
        propertyId: input.propertyId,
        ...unitValues(input, hierarchy),
      })
      .returning({ id: units.id });

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'create',
      entityType: 'unit',
      entityId: row.id,
      entityLabel: input.unitNumber,
      newValue: input,
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return row;
  });

  // Derive availability from the engine (BRD 14) after the write commits — the
  // engine reads policy on its own connection, so it must run outside the tx.
  await computeUnitAvailability(db, created.id, actor.organizationId);
  return created;
}

export async function updateUnit(actor: SessionUser, unitId: string, input: UnitWriteInput): Promise<{ id: string }> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: units.id, unitNumber: units.unitNumber })
      .from(units)
      .where(and(eq(units.id, unitId), eq(units.organizationId, actor.organizationId), isNull(units.deletedAt)))
      .limit(1);
    if (!existing) throw notFound('Unit', unitId);

    const hierarchy = await resolveHierarchy(tx, actor.organizationId, input);
    await tx
      .update(units)
      .set({ propertyId: input.propertyId, ...unitValues(input, hierarchy), updatedAt: new Date() })
      .where(eq(units.id, unitId));

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'unit',
      entityId: unitId,
      entityLabel: input.unitNumber,
      previousValue: { unitNumber: existing.unitNumber },
      newValue: input,
      actor: { id: actor.id, fullName: actor.fullName },
    });
  });

  // Recompute derived availability after the write commits (see createUnit).
  await computeUnitAvailability(db, unitId, actor.organizationId);
  return { id: unitId };
}

/** Full writable unit row + current pricing, for the edit form. */
export async function getUnitForEdit(organizationId: string, unitId: string) {
  const db = await getDb();
  const [unit] = await db
    .select()
    .from(units)
    .where(and(eq(units.id, unitId), eq(units.organizationId, organizationId), isNull(units.deletedAt)))
    .limit(1);
  if (!unit) return null;
  const [pricing] = await db.select().from(unitPricing).where(eq(unitPricing.unitId, unitId)).limit(1);
  return { unit, pricing: pricing ?? null };
}
