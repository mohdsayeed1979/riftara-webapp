import 'server-only';
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  buildings,
  cities,
  districts,
  portfolios,
  properties,
  propertyOwnerships,
  propertyTypes,
  regions,
  units,
  unitStatuses,
  users,
} from '@/db/schema';
import { recordAudit } from '@/lib/audit';
import type { SessionUser } from '@/lib/auth/session';
import { occupancyRate } from '@/lib/calculations/metrics';
import { round2 } from '@/lib/utils';

/**
 * Property repository + service. List queries carry the same scoping and
 * filtering the inventory screen needs; mutations write an audit entry.
 */

export interface PropertyListFilters {
  organizationId: string;
  allowedPropertyIds?: string[] | null;
  allowedCityIds?: string[] | null;
  search?: string;
  cityId?: string;
  districtId?: string;
  propertyTypeId?: string;
  usage?: string;
  status?: string;
  portfolioId?: string;
  sort?: 'name' | 'newest' | 'occupancy' | 'value' | 'units';
  page: number;
  pageSize: number;
}

export interface PropertyListItem {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  typeName: string;
  usage: string;
  status: string;
  cityName: string;
  districtName: string | null;
  coverImageUrl: string | null;
  totalUnits: number;
  occupiedUnits: number;
  availableUnits: number;
  occupancyRate: number;
  annualRentalValue: number;
}

function scopedPropertyWhere(filters: PropertyListFilters): SQL {
  const conditions: SQL[] = [
    eq(properties.organizationId, filters.organizationId),
    isNull(properties.deletedAt),
  ];
  if (filters.allowedPropertyIds?.length) conditions.push(inArray(properties.id, filters.allowedPropertyIds));
  if (filters.allowedCityIds?.length) conditions.push(inArray(properties.cityId, filters.allowedCityIds));
  if (filters.search) {
    conditions.push(
      or(
        ilike(properties.nameEn, `%${filters.search}%`),
        ilike(properties.nameAr, `%${filters.search}%`),
        ilike(properties.code, `%${filters.search}%`),
        ilike(properties.addressLine, `%${filters.search}%`),
      ) as SQL,
    );
  }
  if (filters.cityId) conditions.push(eq(properties.cityId, filters.cityId));
  if (filters.districtId) conditions.push(eq(properties.districtId, filters.districtId));
  if (filters.propertyTypeId) conditions.push(eq(properties.propertyTypeId, filters.propertyTypeId));
  if (filters.usage) conditions.push(eq(properties.usage, filters.usage));
  if (filters.status) conditions.push(eq(properties.status, filters.status));
  if (filters.portfolioId) conditions.push(eq(properties.portfolioId, filters.portfolioId));
  return and(...conditions) as SQL;
}

export async function listProperties(
  filters: PropertyListFilters,
): Promise<{ items: PropertyListItem[]; total: number }> {
  const db = await getDb();
  const where = scopedPropertyWhere(filters);

  const [{ total }] = await db.select({ total: count() }).from(properties).where(where);

  // Occupancy and rental value are aggregated per property via a correlated
  // subquery so pagination stays correct.
  const occupiedExpr = sql<number>`(
    select count(*)::int from ${units} u
    join ${unitStatuses} s on s.id = u.status_id
    where u.property_id = ${properties.id} and u.deleted_at is null and s.counts_as_occupied
  )`;
  const availableExpr = sql<number>`(
    select count(*)::int from ${units} u
    where u.property_id = ${properties.id} and u.deleted_at is null and u.computed_availability_class = 'available'
  )`;
  const annualRentalExpr = sql<number>`(
    select coalesce(sum(p.asking_rent), 0)::float8 from ${units} u
    join unit_pricing p on p.unit_id = u.id
    where u.property_id = ${properties.id} and u.deleted_at is null
  )`;

  const orderBy = (() => {
    switch (filters.sort) {
      case 'newest':
        return desc(properties.createdAt);
      case 'value':
        return desc(annualRentalExpr);
      case 'units':
        return desc(properties.unitCount);
      case 'occupancy':
        return desc(occupiedExpr);
      default:
        return asc(properties.nameEn);
    }
  })();

  const rows = await db
    .select({
      id: properties.id,
      code: properties.code,
      name: properties.nameEn,
      nameAr: properties.nameAr,
      usage: properties.usage,
      status: properties.status,
      coverImageUrl: properties.coverImageUrl,
      totalUnits: properties.unitCount,
      typeName: propertyTypes.nameEn,
      cityName: cities.nameEn,
      districtName: districts.nameEn,
      occupiedUnits: occupiedExpr,
      availableUnits: availableExpr,
      annualRentalValue: annualRentalExpr,
    })
    .from(properties)
    .innerJoin(propertyTypes, eq(propertyTypes.id, properties.propertyTypeId))
    .innerJoin(cities, eq(cities.id, properties.cityId))
    .leftJoin(districts, eq(districts.id, properties.districtId))
    .where(where)
    .orderBy(orderBy)
    .limit(filters.pageSize)
    .offset((filters.page - 1) * filters.pageSize);

  const items: PropertyListItem[] = rows.map((row) => {
    const totalUnits = Number(row.totalUnits);
    const occupiedUnits = Number(row.occupiedUnits);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      nameAr: row.nameAr,
      typeName: row.typeName,
      usage: row.usage,
      status: row.status,
      cityName: row.cityName,
      districtName: row.districtName,
      coverImageUrl: row.coverImageUrl,
      totalUnits,
      occupiedUnits,
      availableUnits: Number(row.availableUnits),
      occupancyRate: occupancyRate({ totalUnits, occupiedUnits }),
      annualRentalValue: round2(Number(row.annualRentalValue)),
    };
  });

  return { items, total: Number(total) };
}

export interface PropertyDetail {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  usage: string;
  status: string;
  typeName: string;
  typeId: string;
  cityId: string;
  cityName: string;
  districtName: string | null;
  regionName: string | null;
  addressLine: string | null;
  nationalAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  googleMapsReference: string | null;
  costCenter: string | null;
  acquisitionDate: string | null;
  operationalStartDate: string | null;
  constructionYear: number | null;
  renovationYear: number | null;
  condition: string | null;
  buildingCount: number;
  floorCount: number;
  unitCount: number;
  landArea: number | null;
  builtUpArea: number | null;
  grossLeasableArea: number | null;
  netLeasableArea: number | null;
  commonArea: number | null;
  parkingArea: number | null;
  parkingCapacity: number | null;
  elevatorCount: number | null;
  hvacType: string | null;
  electricalCapacity: string | null;
  waterInfrastructure: string | null;
  amenities: string[];
  descriptionEn: string | null;
  coverImageUrl: string | null;
  publicationState: string;
  propertyManagerName: string | null;
  leasingManagerName: string | null;
  assetManagerName: string | null;
  fireFightingSystem: boolean;
  fireAlarmSystem: boolean;
  generator: boolean;
  buildingManagementSystem: boolean;
  cctv: boolean;
  accessControl: boolean;
  loadingFacilities: boolean;
  emergencySystems: boolean;
}

export async function getPropertyDetail(
  organizationId: string,
  propertyId: string,
): Promise<PropertyDetail | null> {
  const db = await getDb();
  const [row] = await db
    .select({
      id: properties.id,
      code: properties.code,
      nameEn: properties.nameEn,
      nameAr: properties.nameAr,
      usage: properties.usage,
      status: properties.status,
      typeName: propertyTypes.nameEn,
      typeId: properties.propertyTypeId,
      cityId: properties.cityId,
      cityName: cities.nameEn,
      districtName: districts.nameEn,
      regionName: regions.nameEn,
      addressLine: properties.addressLine,
      nationalAddress: properties.nationalAddress,
      latitude: properties.latitude,
      longitude: properties.longitude,
      googleMapsReference: properties.googleMapsReference,
      costCenter: properties.costCenter,
      acquisitionDate: properties.acquisitionDate,
      operationalStartDate: properties.operationalStartDate,
      constructionYear: properties.constructionYear,
      renovationYear: properties.renovationYear,
      condition: properties.condition,
      buildingCount: properties.buildingCount,
      floorCount: properties.floorCount,
      unitCount: properties.unitCount,
      landArea: properties.landArea,
      builtUpArea: properties.builtUpArea,
      grossLeasableArea: properties.grossLeasableArea,
      netLeasableArea: properties.netLeasableArea,
      commonArea: properties.commonArea,
      parkingArea: properties.parkingArea,
      parkingCapacity: properties.parkingCapacity,
      elevatorCount: properties.elevatorCount,
      hvacType: properties.hvacType,
      electricalCapacity: properties.electricalCapacity,
      waterInfrastructure: properties.waterInfrastructure,
      amenities: properties.amenities,
      descriptionEn: properties.descriptionEn,
      coverImageUrl: properties.coverImageUrl,
      publicationState: properties.publicationState,
      propertyManagerId: properties.propertyManagerId,
      leasingManagerId: properties.leasingManagerId,
      assetManagerId: properties.assetManagerId,
      fireFightingSystem: properties.fireFightingSystem,
      fireAlarmSystem: properties.fireAlarmSystem,
      generator: properties.generator,
      buildingManagementSystem: properties.buildingManagementSystem,
      cctv: properties.cctv,
      accessControl: properties.accessControl,
      loadingFacilities: properties.loadingFacilities,
      emergencySystems: properties.emergencySystems,
    })
    .from(properties)
    .innerJoin(propertyTypes, eq(propertyTypes.id, properties.propertyTypeId))
    .innerJoin(cities, eq(cities.id, properties.cityId))
    .leftJoin(districts, eq(districts.id, properties.districtId))
    .leftJoin(regions, eq(regions.id, properties.regionId))
    .where(
      and(
        eq(properties.id, propertyId),
        eq(properties.organizationId, organizationId),
        isNull(properties.deletedAt),
      ),
    )
    .limit(1);

  if (!row) return null;

  // Resolve manager names in a second lightweight query.
  const managerIds = [row.propertyManagerId, row.leasingManagerId, row.assetManagerId].filter(
    (id): id is string => Boolean(id),
  );
  const managerRows = managerIds.length
    ? await db.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, managerIds))
    : [];
  const managerName = (id: string | null) => managerRows.find((m) => m.id === id)?.name ?? null;

  return {
    ...row,
    latitude: row.latitude,
    longitude: row.longitude,
    amenities: row.amenities ?? [],
    propertyManagerName: managerName(row.propertyManagerId),
    leasingManagerName: managerName(row.leasingManagerId),
    assetManagerName: managerName(row.assetManagerId),
  } as PropertyDetail;
}

export async function getPropertyBuildings(propertyId: string) {
  const db = await getDb();
  return db
    .select({
      id: buildings.id,
      code: buildings.code,
      name: buildings.nameEn,
      floorCount: buildings.floorCount,
      unitCount: buildings.unitCount,
      grossLeasableArea: buildings.grossLeasableArea,
      status: buildings.status,
    })
    .from(buildings)
    .where(and(eq(buildings.propertyId, propertyId), isNull(buildings.deletedAt)))
    .orderBy(asc(buildings.code));
}

export async function getPropertyOwnership(propertyId: string) {
  const db = await getDb();
  return db
    .select()
    .from(propertyOwnerships)
    .where(and(eq(propertyOwnerships.propertyId, propertyId), isNull(propertyOwnerships.deletedAt)))
    .orderBy(desc(propertyOwnerships.ownershipPercentage));
}

/** Filter options for the inventory screen. */
export async function getPropertyFilterOptions(organizationId: string, allowedCityIds: string[] | null) {
  const db = await getDb();
  const cityFilter = allowedCityIds?.length
    ? and(eq(cities.organizationId, organizationId), inArray(cities.id, allowedCityIds))
    : eq(cities.organizationId, organizationId);

  const [cityRows, typeRows] = await Promise.all([
    db
      .select({ id: cities.id, name: cities.nameEn })
      .from(cities)
      .where(and(cityFilter, isNull(cities.deletedAt)))
      .orderBy(cities.nameEn),
    db
      .select({ id: propertyTypes.id, name: propertyTypes.nameEn })
      .from(propertyTypes)
      .where(and(eq(propertyTypes.organizationId, organizationId), eq(propertyTypes.isActive, true)))
      .orderBy(propertyTypes.sortOrder),
  ]);

  return { cities: cityRows, types: typeRows };
}

/** Reference data for the New / Edit Property forms. All rows are loaded from
 *  the database and scoped to the organization — never hardcoded. Geography is
 *  returned in full (with parent ids) so the form can enforce the
 *  Region -> City -> District hierarchy on the client and the server. */
export async function getPropertyFormReferenceData(organizationId: string) {
  const db = await getDb();
  const [regionRows, cityRows, districtRows, portfolioRows, typeRows, managerRows] = await Promise.all([
    db
      .select({ id: regions.id, name: regions.nameEn })
      .from(regions)
      .where(and(eq(regions.organizationId, organizationId), eq(regions.isActive, true), isNull(regions.deletedAt)))
      .orderBy(regions.nameEn),
    db
      .select({ id: cities.id, name: cities.nameEn, regionId: cities.regionId })
      .from(cities)
      .where(and(eq(cities.organizationId, organizationId), eq(cities.isActive, true), isNull(cities.deletedAt)))
      .orderBy(cities.nameEn),
    db
      .select({ id: districts.id, name: districts.nameEn, cityId: districts.cityId })
      .from(districts)
      .where(and(eq(districts.organizationId, organizationId), eq(districts.isActive, true), isNull(districts.deletedAt)))
      .orderBy(districts.nameEn),
    db
      .select({ id: portfolios.id, name: portfolios.nameEn })
      .from(portfolios)
      .where(and(eq(portfolios.organizationId, organizationId), eq(portfolios.isActive, true), isNull(portfolios.deletedAt)))
      .orderBy(portfolios.nameEn),
    db
      .select({ id: propertyTypes.id, name: propertyTypes.nameEn })
      .from(propertyTypes)
      .where(and(eq(propertyTypes.organizationId, organizationId), eq(propertyTypes.isActive, true)))
      .orderBy(propertyTypes.sortOrder),
    db
      .select({ id: users.id, name: users.fullName })
      .from(users)
      .where(and(eq(users.organizationId, organizationId), eq(users.isActive, true), isNull(users.deletedAt)))
      .orderBy(users.fullName),
  ]);

  return {
    regions: regionRows,
    cities: cityRows,
    districts: districtRows,
    portfolios: portfolioRows,
    types: typeRows,
    managers: managerRows,
  };
}

export interface CreateOwnershipInput {
  documentType: string;
  documentNumber: string;
  documentDate?: string | null;
  issuingAuthority?: string | null;
  ownerType: 'individual' | 'entity';
  ownerName: string;
  identificationType?: string | null;
  identificationNumber?: string | null;
  commercialRegistration?: string | null;
  ownershipPercentage?: number | null;
  authorizedRepresentative?: string | null;
  notes?: string | null;
}

export interface CreatePropertyInput {
  // Basic
  code: string;
  nameEn: string;
  nameAr?: string | null;
  propertyTypeId: string;
  usage: string;
  status: string;
  portfolioId?: string | null;
  // Location & geography
  regionId?: string | null;
  cityId: string;
  districtId?: string | null;
  addressLine?: string | null;
  nationalAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  googleMapsReference?: string | null;
  costCenter?: string | null;
  // Management
  propertyManagerId?: string | null;
  leasingManagerId?: string | null;
  assetManagerId?: string | null;
  acquisitionDate?: string | null;
  operationalStartDate?: string | null;
  // Technical
  landArea?: number | null;
  builtUpArea?: number | null;
  grossLeasableArea?: number | null;
  netLeasableArea?: number | null;
  commonArea?: number | null;
  parkingArea?: number | null;
  buildingCount?: number;
  floorCount?: number;
  unitCount?: number;
  constructionYear?: number | null;
  renovationYear?: number | null;
  condition?: string | null;
  parkingCapacity?: number | null;
  elevatorCount?: number | null;
  hvacType?: string | null;
  electricalCapacity?: string | null;
  waterInfrastructure?: string | null;
  fireFightingSystem?: boolean;
  fireAlarmSystem?: boolean;
  generator?: boolean;
  buildingManagementSystem?: boolean;
  cctv?: boolean;
  accessControl?: boolean;
  loadingFacilities?: boolean;
  emergencySystems?: boolean;
  // Additional
  descriptionEn?: string | null;
  descriptionAr?: string | null;
  // Ownership (optional first owner record)
  ownership?: CreateOwnershipInput | null;
}

export async function createProperty(
  actor: SessionUser,
  input: CreatePropertyInput,
): Promise<{ id: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(properties)
      .values({
        organizationId: actor.organizationId, // always the session org — never client-supplied
        code: input.code,
        nameEn: input.nameEn,
        nameAr: input.nameAr ?? null,
        propertyTypeId: input.propertyTypeId,
        usage: input.usage,
        status: input.status,
        portfolioId: input.portfolioId ?? null,
        regionId: input.regionId ?? null,
        cityId: input.cityId,
        districtId: input.districtId ?? null,
        addressLine: input.addressLine ?? null,
        nationalAddress: input.nationalAddress ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        googleMapsReference: input.googleMapsReference ?? null,
        costCenter: input.costCenter ?? null,
        propertyManagerId: input.propertyManagerId ?? null,
        leasingManagerId: input.leasingManagerId ?? null,
        assetManagerId: input.assetManagerId ?? null,
        acquisitionDate: input.acquisitionDate ?? null,
        operationalStartDate: input.operationalStartDate ?? null,
        landArea: input.landArea ?? null,
        builtUpArea: input.builtUpArea ?? null,
        grossLeasableArea: input.grossLeasableArea ?? null,
        netLeasableArea: input.netLeasableArea ?? null,
        commonArea: input.commonArea ?? null,
        parkingArea: input.parkingArea ?? null,
        buildingCount: input.buildingCount ?? 0,
        floorCount: input.floorCount ?? 0,
        unitCount: input.unitCount ?? 0,
        constructionYear: input.constructionYear ?? null,
        renovationYear: input.renovationYear ?? null,
        condition: input.condition ?? null,
        parkingCapacity: input.parkingCapacity ?? null,
        elevatorCount: input.elevatorCount ?? null,
        hvacType: input.hvacType ?? null,
        electricalCapacity: input.electricalCapacity ?? null,
        waterInfrastructure: input.waterInfrastructure ?? null,
        fireFightingSystem: input.fireFightingSystem ?? false,
        fireAlarmSystem: input.fireAlarmSystem ?? false,
        generator: input.generator ?? false,
        buildingManagementSystem: input.buildingManagementSystem ?? false,
        cctv: input.cctv ?? false,
        accessControl: input.accessControl ?? false,
        loadingFacilities: input.loadingFacilities ?? false,
        emergencySystems: input.emergencySystems ?? false,
        descriptionEn: input.descriptionEn ?? null,
        descriptionAr: input.descriptionAr ?? null,
      })
      .returning({ id: properties.id });

    if (input.ownership) {
      const o = input.ownership;
      await tx.insert(propertyOwnerships).values({
        propertyId: created.id,
        documentType: o.documentType,
        documentNumber: o.documentNumber,
        documentDate: o.documentDate ?? null,
        issuingAuthority: o.issuingAuthority ?? null,
        ownerType: o.ownerType,
        ownerName: o.ownerName,
        identificationType: o.identificationType ?? null,
        identificationNumber: o.identificationNumber ?? null,
        commercialRegistration: o.commercialRegistration ?? null,
        ownershipPercentage: o.ownershipPercentage ?? 100,
        authorizedRepresentative: o.authorizedRepresentative ?? null,
        notes: o.notes ?? null,
      });
    }

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'create',
      entityType: 'property',
      entityId: created.id,
      entityLabel: input.nameEn,
      newValue: input,
      actor: { id: actor.id, fullName: actor.fullName },
    });

    return created;
  });
}

export async function nextPropertyCode(organizationId: string): Promise<string> {
  const db = await getDb();
  const [{ total }] = await db
    .select({ total: count() })
    .from(properties)
    .where(eq(properties.organizationId, organizationId));
  return `PROP-${String(Number(total) + 1).padStart(4, '0')}`;
}
