import type { Database } from '../types';
import {
  buildings,
  floors,
  priceHistory,
  properties,
  propertyOwnerships,
  unitPricing,
  units,
  valuations,
} from '../schema';
import type { ReferenceData } from './reference';
import { addMonths, anchorMonth, insertInBatches, iso, round2, roundRent, type Rng } from './util';

export interface SeededUnit {
  id: string;
  code: string;
  unitNumber: string;
  propertyId: string;
  propertyKey: string;
  buildingId: string;
  floorId: string;
  floorLevel: number;
  unitTypeKey: string;
  usageType: string;
  leasableArea: number;
  askingRent: number;
  rentPerSqm: number;
  serviceCharges: number;
  /** Assigned by the leasing seed. */
  occupancyPlan: 'leased' | 'available' | 'reserved' | 'maintenance';
}

export interface SeededProperty {
  id: string;
  key: string;
  code: string;
  name: string;
  cityKey: string;
  districtKey: string;
  marketValue: number;
  unitIds: string[];
}

export interface PortfolioResult {
  properties: SeededProperty[];
  units: SeededUnit[];
}

interface Blueprint {
  key: string;
  code: string;
  nameEn: string;
  nameAr: string;
  typeKey: string;
  usage: string;
  cityKey: string;
  districtKey: string;
  address: string;
  lat: number;
  lng: number;
  constructionYear: number;
  buildings: Array<{ code: string; name: string; floors: number; unitsPerFloor: number }>;
  unitTypeKeys: string[];
  areaRange: [number, number];
  rentPerSqm: number;
  serviceChargePerSqm: number;
  /** Market value per leasable square metre, used to derive the valuation. */
  valuePerSqm: number;
  /** Share of units that are leased. */
  occupancyTarget: number;
  managerKey: string;
  amenities: string[];
  descriptionEn: string;
}

const BLUEPRINTS: Blueprint[] = [
  {
    key: 'al_yarmouk',
    code: 'RYD-YRM-01',
    nameEn: 'RIFTARA Office Park — Al Yarmouk',
    nameAr: 'ريفتارا أوفيس بارك — اليرموك',
    typeKey: 'office_building',
    usage: 'office',
    cityKey: 'riyadh',
    districtKey: 'al_yarmouk',
    address: 'Eastern Ring Road, Al Yarmouk District, Riyadh 13251',
    lat: 24.8021,
    lng: 46.7912,
    constructionYear: 2022,
    buildings: [
      { code: 'A', name: 'Building A', floors: 5, unitsPerFloor: 4 },
      { code: 'B', name: 'Building B', floors: 5, unitsPerFloor: 4 },
    ],
    unitTypeKeys: ['office_small', 'office_medium', 'office_large'],
    areaRange: [180, 650],
    rentPerSqm: 1650,
    serviceChargePerSqm: 145,
    valuePerSqm: 24500,
    occupancyTarget: 0.9,
    managerKey: 'faisal_alotaibi',
    amenities: ['Covered parking', 'District cooling', '24/7 security', 'Fibre connectivity', 'Café'],
    descriptionEn:
      'Grade-A office campus on the Eastern Ring Road with flexible floor plates, structured parking and full building automation.',
  },
  {
    key: 'al_aqeeq',
    code: 'RYD-AQQ-02',
    nameEn: 'RIFTARA Office Tower — Al Aqeeq',
    nameAr: 'برج ريفتارا — العقيق',
    typeKey: 'office_building',
    usage: 'office',
    cityKey: 'riyadh',
    districtKey: 'al_aqeeq',
    address: 'King Salman Road, Al Aqeeq District, Riyadh 13515',
    lat: 24.7663,
    lng: 46.6301,
    constructionYear: 2023,
    buildings: [{ code: 'T', name: 'Tower', floors: 13, unitsPerFloor: 1 }],
    unitTypeKeys: ['office_large'],
    areaRange: [820, 1050],
    rentPerSqm: 1850,
    serviceChargePerSqm: 165,
    valuePerSqm: 27500,
    occupancyTarget: 0.88,
    managerKey: 'faisal_alotaibi',
    amenities: ['Full-floor plates', 'Sky lobby', 'EV charging', 'BMS', 'Executive parking'],
    descriptionEn:
      'Thirteen full-floor office plates adjacent to the King Abdullah Financial District corridor, delivered fully fitted.',
  },
  {
    key: 'granata',
    code: 'RYD-GRN-03',
    nameEn: 'RIFTARA Business Park — Granada',
    nameAr: 'ريفتارا بزنس بارك — غرناطة',
    typeKey: 'mixed_use',
    usage: 'mixed',
    cityKey: 'riyadh',
    districtKey: 'granata',
    address: 'Eastern Ring Road, Granada District, Riyadh 13241',
    lat: 24.7674,
    lng: 46.7521,
    constructionYear: 2021,
    buildings: [
      { code: 'G1', name: 'Granada One', floors: 4, unitsPerFloor: 4 },
      { code: 'G2', name: 'Granada Two', floors: 4, unitsPerFloor: 4 },
      { code: 'G3', name: 'Granada Three', floors: 4, unitsPerFloor: 4 },
    ],
    unitTypeKeys: ['office_medium', 'office_large', 'retail_shop'],
    areaRange: [200, 700],
    rentPerSqm: 1550,
    serviceChargePerSqm: 135,
    valuePerSqm: 22800,
    occupancyTarget: 0.93,
    managerKey: 'faisal_alotaibi',
    amenities: ['Retail podium', 'Landscaped courtyards', 'Visitor parking', 'Prayer areas'],
    descriptionEn:
      'Mixed-use business park combining office floors above an active retail podium, adjacent to Granada Mall.',
  },
  {
    key: 'olaya',
    code: 'RYD-OLY-04',
    nameEn: 'RIFTARA Olaya Tower',
    nameAr: 'برج ريفتارا العليا',
    typeKey: 'mixed_use',
    usage: 'mixed',
    cityKey: 'riyadh',
    districtKey: 'al_olaya',
    address: 'King Fahd Road, Al Olaya District, Riyadh 12211',
    lat: 24.6901,
    lng: 46.6852,
    constructionYear: 2024,
    buildings: [{ code: 'OT', name: 'Olaya Tower', floors: 15, unitsPerFloor: 3 }],
    unitTypeKeys: ['office_large', 'office_medium', 'showroom'],
    areaRange: [250, 1200],
    rentPerSqm: 2100,
    serviceChargePerSqm: 195,
    valuePerSqm: 31000,
    occupancyTarget: 0.85,
    managerKey: 'nora_alhamdan',
    amenities: ['LEED Gold', 'Sky garden', 'Concierge', 'Valet parking', 'Conference centre'],
    descriptionEn:
      'Flagship mixed-use tower on King Fahd Road with LEED Gold certification, concierge services and premium showroom frontage.',
  },
  {
    key: 'jeddah_commerce',
    code: 'JED-CMH-05',
    nameEn: 'RIFTARA Commerce Hub — Jeddah',
    nameAr: 'ريفتارا كوميرس هَب — جدة',
    typeKey: 'shopping_center',
    usage: 'retail',
    cityKey: 'jeddah',
    districtKey: 'al_rawdah',
    address: 'Prince Sultan Road, Al Rawdah District, Jeddah 23432',
    lat: 21.5702,
    lng: 39.1601,
    constructionYear: 2020,
    buildings: [{ code: 'CH', name: 'Commerce Hub', floors: 3, unitsPerFloor: 12 }],
    unitTypeKeys: ['retail_shop', 'showroom', 'kiosk_unit'],
    areaRange: [65, 420],
    rentPerSqm: 2200,
    serviceChargePerSqm: 240,
    valuePerSqm: 26000,
    occupancyTarget: 0.84,
    managerKey: 'faisal_alotaibi',
    amenities: ['Anchor tenants', 'Food court', 'Basement parking', 'Family entrance'],
    descriptionEn:
      'Community retail centre on Prince Sultan Road anchored by a supermarket and a fitness operator, with strong footfall.',
  },
  {
    key: 'dammam_logistics',
    code: 'DMM-LOG-06',
    nameEn: 'RIFTARA Logistics Park — Dammam',
    nameAr: 'ريفتارا اللوجستية — الدمام',
    typeKey: 'logistics_asset',
    usage: 'industrial',
    cityKey: 'dammam',
    districtKey: 'second_industrial',
    address: 'Second Industrial City, Dammam 34326',
    lat: 26.3612,
    lng: 50.0603,
    constructionYear: 2019,
    buildings: [{ code: 'W', name: 'Warehouse Block', floors: 1, unitsPerFloor: 12 }],
    unitTypeKeys: ['warehouse_unit', 'storage_unit'],
    areaRange: [1500, 6000],
    rentPerSqm: 320,
    serviceChargePerSqm: 22,
    valuePerSqm: 4200,
    occupancyTarget: 0.92,
    managerKey: 'nora_alhamdan',
    amenities: ['12m clear height', 'Dock levellers', 'Heavy power', 'Truck marshalling yard'],
    descriptionEn:
      'Modern logistics park in Dammam Second Industrial City with dock-level loading, 12-metre clear height and heavy power supply.',
  },
  {
    key: 'khobar_residences',
    code: 'KHB-RES-07',
    nameEn: 'RIFTARA Residences — Al Khobar',
    nameAr: 'ريفتارا ريزيدنس — الخبر',
    typeKey: 'residential_building',
    usage: 'residential',
    cityKey: 'khobar',
    districtKey: 'al_aqrabiyah',
    address: 'Prince Faisal Bin Fahd Road, Al Aqrabiyah, Al Khobar 34445',
    lat: 26.3011,
    lng: 50.2015,
    constructionYear: 2022,
    buildings: [{ code: 'R', name: 'Residences', floors: 4, unitsPerFloor: 7 }],
    unitTypeKeys: ['apartment_1br', 'apartment_2br', 'apartment_3br'],
    areaRange: [85, 220],
    rentPerSqm: 620,
    serviceChargePerSqm: 45,
    valuePerSqm: 9500,
    occupancyTarget: 0.91,
    managerKey: 'faisal_alotaibi',
    amenities: ['Gym', 'Rooftop terrace', 'Covered parking', 'Concierge', 'Play area'],
    descriptionEn:
      'Contemporary residential building near the Corniche offering one- to three-bedroom apartments with shared amenities.',
  },
];

const OWNER_TEMPLATES = [
  {
    documentType: 'Title Deed',
    issuingAuthority: 'Ministry of Justice',
    ownerName: 'RIFTARA Real Estate Company LLC',
    ownerType: 'entity' as const,
    identificationType: 'Commercial Registration',
    commercialRegistration: '1010512345',
    percentage: 100,
  },
];

export async function seedPortfolio(
  db: Database,
  reference: ReferenceData,
  rng: Rng,
): Promise<PortfolioResult> {
  const today = new Date();
  const currentMonth = anchorMonth(today);
  const seededProperties: SeededProperty[] = [];
  const seededUnits: SeededUnit[] = [];

  const unitRowsToInsert: Array<typeof units.$inferInsert> = [];
  const pricingRowsToInsert: Array<{ unitCode: string; row: Omit<typeof unitPricing.$inferInsert, 'unitId'> }> = [];

  for (const blueprint of BLUEPRINTS) {
    const totalUnits = blueprint.buildings.reduce((sum, b) => sum + b.floors * b.unitsPerFloor, 0);
    const totalFloors = blueprint.buildings.reduce((sum, b) => sum + b.floors, 0);

    // Areas are generated first so property-level totals reconcile with units.
    const unitPlans: Array<{
      buildingCode: string;
      buildingName: string;
      floorLevel: number;
      indexOnFloor: number;
      area: number;
      unitTypeKey: string;
    }> = [];

    for (const building of blueprint.buildings) {
      for (let level = 1; level <= building.floors; level += 1) {
        for (let n = 1; n <= building.unitsPerFloor; n += 1) {
          // Higher floors carry larger plates in towers; retail ground floors are smaller.
          const [minArea, maxArea] = blueprint.areaRange;
          const area = round2(rng.float(minArea, maxArea, 0));
          const unitTypeKey =
            area > maxArea * 0.7
              ? blueprint.unitTypeKeys[blueprint.unitTypeKeys.length - 1]
              : area < minArea * 1.6
                ? blueprint.unitTypeKeys[0]
                : blueprint.unitTypeKeys[Math.min(1, blueprint.unitTypeKeys.length - 1)];
          unitPlans.push({
            buildingCode: building.code,
            buildingName: building.name,
            floorLevel: level,
            indexOnFloor: n,
            area,
            unitTypeKey,
          });
        }
      }
    }

    const totalLeasableArea = round2(unitPlans.reduce((sum, plan) => sum + plan.area, 0));
    const commonArea = round2(totalLeasableArea * 0.18);
    const grossArea = round2(totalLeasableArea + commonArea);
    const marketValue = Math.round((totalLeasableArea * blueprint.valuePerSqm) / 1000) * 1000;

    const [property] = await db
      .insert(properties)
      .values({
        organizationId: reference.organizationId,
        code: blueprint.code,
        nameEn: blueprint.nameEn,
        nameAr: blueprint.nameAr,
        propertyTypeId: reference.propertyTypeIds[blueprint.typeKey],
        usage: blueprint.usage,
        status: 'active',
        portfolioId: reference.portfolioId,
        regionId: null,
        cityId: reference.cityIds[blueprint.cityKey],
        districtId: reference.districtIds[blueprint.districtKey],
        addressLine: blueprint.address,
        nationalAddress: `${blueprint.code.replace(/-/g, '')}${rng.int(1000, 9999)}`,
        latitude: blueprint.lat,
        longitude: blueprint.lng,
        googleMapsReference: `https://maps.google.com/?q=${blueprint.lat},${blueprint.lng}`,
        costCenter: `CC-${blueprint.code}`,
        propertyManagerId: reference.userIds[blueprint.managerKey],
        leasingManagerId: reference.userIds.sarah_mohammed,
        assetManagerId: reference.userIds.nora_alhamdan,
        acquisitionDate: iso(new Date(Date.UTC(blueprint.constructionYear - 1, 5, 15))),
        operationalStartDate: iso(new Date(Date.UTC(blueprint.constructionYear, 0, 15))),
        landArea: round2(grossArea * 0.42),
        builtUpArea: grossArea,
        grossLeasableArea: totalLeasableArea,
        netLeasableArea: round2(totalLeasableArea * 0.96),
        commonArea,
        parkingArea: round2(grossArea * 0.25),
        buildingCount: blueprint.buildings.length,
        floorCount: totalFloors,
        unitCount: totalUnits,
        constructionYear: blueprint.constructionYear,
        condition: 'excellent',
        parkingCapacity: Math.round(totalLeasableArea / 55),
        elevatorCount: blueprint.buildings.length * (totalFloors > 6 ? 4 : 2),
        hvacType: blueprint.usage === 'industrial' ? 'Split units' : 'District cooling',
        electricalCapacity: `${Math.round(totalLeasableArea / 8)} kVA`,
        waterInfrastructure: 'Municipal supply with storage tanks',
        fireFightingSystem: true,
        fireAlarmSystem: true,
        generator: true,
        buildingManagementSystem: blueprint.usage !== 'industrial',
        cctv: true,
        accessControl: true,
        loadingFacilities: blueprint.usage === 'industrial' || blueprint.usage === 'retail',
        emergencySystems: true,
        amenities: blueprint.amenities,
        descriptionEn: blueprint.descriptionEn,
        publicationState: 'published',
        publishPrice: true,
        publishAvailability: true,
        firstPublishedAt: addMonths(currentMonth, -18),
        isDemo: true,
      })
      .returning({ id: properties.id });

    await db.insert(propertyOwnerships).values(
      OWNER_TEMPLATES.map((owner) => ({
        propertyId: property.id,
        documentType: owner.documentType,
        documentNumber: `${rng.int(300000000000, 399999999999)}`,
        documentDate: iso(new Date(Date.UTC(blueprint.constructionYear - 1, 4, 2))),
        issuingAuthority: owner.issuingAuthority,
        ownerType: owner.ownerType,
        ownerName: owner.ownerName,
        identificationType: owner.identificationType,
        commercialRegistration: owner.commercialRegistration,
        ownershipPercentage: owner.percentage,
        authorizedRepresentative: 'Khalid AlRashid',
        isDemo: true,
      })),
    );

    // --- Valuations (current + prior year) ---------------------------------
    const priorValue = Math.round((marketValue / 1.09) / 1000) * 1000;
    await db.insert(valuations).values([
      {
        organizationId: reference.organizationId,
        propertyId: property.id,
        valuationDate: iso(addMonths(currentMonth, -14)),
        acquisitionCost: Math.round((marketValue / 1.22) / 1000) * 1000,
        bookValue: Math.round((marketValue / 1.12) / 1000) * 1000,
        marketValue: priorValue,
        landValue: Math.round((priorValue * 0.38) / 1000) * 1000,
        buildingValue: Math.round((priorValue * 0.62) / 1000) * 1000,
        valuationCompany: 'Knight Frank Saudi Arabia',
        valuationMethod: 'income',
        capRate: 6.5,
        status: 'superseded',
        isCurrent: false,
        approvedByUserId: reference.userIds.nora_alhamdan,
        isDemo: true,
      },
      {
        organizationId: reference.organizationId,
        propertyId: property.id,
        valuationDate: iso(addMonths(currentMonth, -2)),
        acquisitionCost: Math.round((marketValue / 1.22) / 1000) * 1000,
        bookValue: Math.round((marketValue / 1.1) / 1000) * 1000,
        marketValue,
        landValue: Math.round((marketValue * 0.38) / 1000) * 1000,
        buildingValue: Math.round((marketValue * 0.62) / 1000) * 1000,
        previousMarketValue: priorValue,
        changeAmount: marketValue - priorValue,
        changePercent: round2(((marketValue - priorValue) / priorValue) * 100),
        valuationCompany: 'Knight Frank Saudi Arabia',
        valuationMethod: 'income',
        capRate: round2(rng.float(5.8, 7.2)),
        status: 'approved',
        isCurrent: true,
        approvedByUserId: reference.userIds.nora_alhamdan,
        isDemo: true,
      },
    ]);

    // --- Buildings, floors, units -----------------------------------------
    const unitIds: string[] = [];

    for (const buildingSpec of blueprint.buildings) {
      const buildingPlans = unitPlans.filter((p) => p.buildingCode === buildingSpec.code);
      const buildingArea = round2(buildingPlans.reduce((sum, p) => sum + p.area, 0));

      const [building] = await db
        .insert(buildings)
        .values({
          organizationId: reference.organizationId,
          propertyId: property.id,
          code: buildingSpec.code,
          nameEn: buildingSpec.name,
          nameAr: buildingSpec.name,
          floorCount: buildingSpec.floors,
          unitCount: buildingPlans.length,
          grossLeasableArea: buildingArea,
          constructionYear: blueprint.constructionYear,
          elevatorCount: buildingSpec.floors > 6 ? 4 : 2,
          parkingCapacity: Math.round(buildingArea / 55),
          status: 'active',
          isDemo: true,
        })
        .returning({ id: buildings.id });

      for (let level = 1; level <= buildingSpec.floors; level += 1) {
        const floorPlans = buildingPlans.filter((p) => p.floorLevel === level);
        const floorArea = round2(floorPlans.reduce((sum, p) => sum + p.area, 0));

        const [floor] = await db
          .insert(floors)
          .values({
            organizationId: reference.organizationId,
            buildingId: building.id,
            level,
            nameEn: level === 1 ? 'Ground Floor' : `Level ${level}`,
            nameAr: level === 1 ? 'الدور الأرضي' : `الدور ${level}`,
            grossArea: floorArea,
            unitCount: floorPlans.length,
            isDemo: true,
          })
          .returning({ id: floors.id });

        for (const plan of floorPlans) {
          const unitNumber = `${buildingSpec.code}-${level}${String(plan.indexOnFloor).padStart(2, '0')}`;
          const code = `${blueprint.code}-${unitNumber}`;
          // Upper floors command a premium; ground-floor retail commands frontage value.
          const floorFactor =
            blueprint.usage === 'retail' ? (level === 1 ? 1.25 : 0.92) : 1 + (level - 1) * 0.012;
          const rentPerSqm = round2(blueprint.rentPerSqm * floorFactor * rng.float(0.94, 1.07, 3));
          const askingRent = roundRent(rentPerSqm * plan.area);

          unitIds.push(code);
          unitRowsToInsert.push({
            organizationId: reference.organizationId,
            propertyId: property.id,
            buildingId: building.id,
            floorId: floor.id,
            code,
            unitNumber,
            unitTypeId: reference.unitTypeIds[plan.unitTypeKey],
            usageType: blueprint.usage,
            statusId: reference.unitStatusIds.available,
            grossArea: round2(plan.area * 1.12),
            netArea: round2(plan.area * 0.94),
            leasableArea: plan.area,
            parkingAllocation: Math.max(1, Math.round(plan.area / 60)),
            bedroomCount: plan.unitTypeKey.startsWith('apartment')
              ? Number(plan.unitTypeKey.charAt(plan.unitTypeKey.length - 3)) || 2
              : null,
            bathroomCount: plan.unitTypeKey.startsWith('apartment') ? rng.int(1, 3) : rng.int(1, 2),
            hasKitchen: plan.unitTypeKey.startsWith('apartment'),
            furnishingStatus: plan.unitTypeKey.startsWith('apartment') ? 'semi_furnished' : 'unfurnished',
            hvacType: blueprint.usage === 'industrial' ? 'Split units' : 'District cooling',
            electricityMeterNumber: `EM${rng.int(1000000, 9999999)}`,
            waterMeterNumber: `WM${rng.int(1000000, 9999999)}`,
            condition: 'excellent',
            ceilingHeight: blueprint.usage === 'industrial' ? 12 : 3.2,
            electricalLoad: `${Math.round(plan.area / 6)} kVA`,
            signageRights: blueprint.usage === 'retail' || level === 1,
            loadingAccess: blueprint.usage === 'industrial',
            deliveryAccess: blueprint.usage !== 'residential',
            fitOutStatus: blueprint.usage === 'office' ? 'semi_fitted' : 'shell_core',
            fireSystem: true,
            descriptionEn: `${plan.area} m² ${plan.unitTypeKey.replace(/_/g, ' ')} at ${blueprint.nameEn}.`,
            publicationState: 'unpublished',
            publishPrice: true,
            publishUnitNumber: false,
            publishAvailability: true,
            isDemo: true,
          });

          pricingRowsToInsert.push({
            unitCode: code,
            row: {
              askingRent,
              targetRent: roundRent(askingRent * 0.97),
              minimumRent: roundRent(askingRent * 0.88),
              marketRent: roundRent(askingRent * rng.float(0.96, 1.06, 3)),
              rentPerSqm: round2(askingRent / plan.area),
              serviceCharges: roundRent(blueprint.serviceChargePerSqm * plan.area),
              depositAmount: roundRent(askingRent * 0.25),
              parkingCharges: 0,
              otherCharges: 0,
              vatApplicable: true,
              effectiveFrom: iso(addMonths(currentMonth, -12)),
              isDemo: true,
            },
          });
        }
      }
    }

    seededProperties.push({
      id: property.id,
      key: blueprint.key,
      code: blueprint.code,
      name: blueprint.nameEn,
      cityKey: blueprint.cityKey,
      districtKey: blueprint.districtKey,
      marketValue,
      unitIds: [],
    });
  }

  // --- Bulk insert units and pricing ---------------------------------------
  const insertedUnits: Array<{ id: string; code: string }> = [];
  await insertInBatches(unitRowsToInsert, 200, async (batch) => {
    const rows = await db.insert(units).values(batch).returning({ id: units.id, code: units.code });
    insertedUnits.push(...rows);
  });

  const unitIdByCode = new Map(insertedUnits.map((row) => [row.code, row.id]));

  await insertInBatches(pricingRowsToInsert, 200, async (batch) =>
    db.insert(unitPricing).values(
      batch.map((entry) => ({ ...entry.row, unitId: unitIdByCode.get(entry.unitCode) as string })),
    ),
  );

  // --- Price history (BR-005): an annual uplift on every unit --------------
  const historyRows = pricingRowsToInsert.map((entry) => ({
    unitId: unitIdByCode.get(entry.unitCode) as string,
    field: 'askingRent',
    previousValue: roundRent((entry.row.askingRent as number) / 1.06),
    newValue: entry.row.askingRent as number,
    effectiveDate: iso(addMonths(currentMonth, -12)),
    changedByUserId: reference.userIds.sarah_mohammed,
    reason: 'Annual market review — 6% uplift approved for the current leasing year.',
    approvalReference: 'PA-ANNUAL-2025',
    marketReference: 'JLL Riyadh Office Market Report',
    isDemo: true,
  }));
  await insertInBatches(historyRows, 200, async (batch) => db.insert(priceHistory).values(batch));

  // --- Assemble the result ------------------------------------------------
  const unitDetailByCode = new Map(
    unitRowsToInsert.map((row) => [row.code as string, row]),
  );
  const pricingByCode = new Map(pricingRowsToInsert.map((entry) => [entry.unitCode, entry.row]));

  for (const blueprint of BLUEPRINTS) {
    const property = seededProperties.find((p) => p.key === blueprint.key) as SeededProperty;
    const codes = insertedUnits
      .filter((u) => u.code.startsWith(`${blueprint.code}-`))
      .map((u) => u.code);

    // Deterministically choose which units are leased / available / blocked.
    const shuffled = rng.shuffle(codes);
    const leasedCount = Math.round(shuffled.length * blueprint.occupancyTarget);
    const reservedCount = Math.max(1, Math.round(shuffled.length * 0.02));
    const maintenanceCount = Math.max(0, Math.round(shuffled.length * 0.015));

    shuffled.forEach((code, index) => {
      const detail = unitDetailByCode.get(code);
      const pricing = pricingByCode.get(code);
      if (!detail || !pricing) return;

      const occupancyPlan: SeededUnit['occupancyPlan'] =
        index < leasedCount
          ? 'leased'
          : index < leasedCount + reservedCount
            ? 'reserved'
            : index < leasedCount + reservedCount + maintenanceCount
              ? 'maintenance'
              : 'available';

      property.unitIds.push(unitIdByCode.get(code) as string);
      seededUnits.push({
        id: unitIdByCode.get(code) as string,
        code,
        unitNumber: detail.unitNumber as string,
        propertyId: property.id,
        propertyKey: blueprint.key,
        buildingId: detail.buildingId as string,
        floorId: detail.floorId as string,
        floorLevel: Number((detail.unitNumber as string).split('-')[1]?.charAt(0) ?? 1),
        unitTypeKey: blueprint.unitTypeKeys[0],
        usageType: blueprint.usage,
        leasableArea: detail.leasableArea as number,
        askingRent: pricing.askingRent as number,
        rentPerSqm: pricing.rentPerSqm as number,
        serviceCharges: pricing.serviceCharges as number,
        occupancyPlan,
      });
    });
  }

  return { properties: seededProperties, units: seededUnits };
}
