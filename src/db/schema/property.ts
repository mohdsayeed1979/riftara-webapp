import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  approvalStatusEnum,
  area,
  isDemo,
  money,
  ownerTypeEnum,
  percent,
  pk,
  publicationStateEnum,
  timestamps,
} from './_shared';
import { cities, districts, portfolios, regions } from './geo';
import { organizations, users } from './org';
import { propertyTypes, unitStatuses, unitTypes } from './taxonomy';

export const properties = pgTable(
  'properties',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 32 }).notNull(),
    nameEn: varchar('name_en', { length: 200 }).notNull(),
    nameAr: varchar('name_ar', { length: 200 }),
    propertyTypeId: uuid('property_type_id')
      .notNull()
      .references(() => propertyTypes.id, { onDelete: 'restrict' }),
    /** residential | commercial | office | retail | industrial | mixed | land */
    usage: varchar('usage', { length: 32 }).notNull().default('commercial'),
    /** active | under_construction | under_renovation | planned | disposed | inactive */
    status: varchar('status', { length: 32 }).notNull().default('active'),

    portfolioId: uuid('portfolio_id').references(() => portfolios.id, { onDelete: 'set null' }),
    regionId: uuid('region_id').references(() => regions.id, { onDelete: 'set null' }),
    cityId: uuid('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    districtId: uuid('district_id').references(() => districts.id, { onDelete: 'set null' }),

    addressLine: text('address_line'),
    nationalAddress: varchar('national_address', { length: 64 }),
    latitude: numeric('latitude', { precision: 10, scale: 7, mode: 'number' }),
    longitude: numeric('longitude', { precision: 10, scale: 7, mode: 'number' }),
    googleMapsReference: text('google_maps_reference'),
    costCenter: varchar('cost_center', { length: 48 }),

    propertyManagerId: uuid('property_manager_id').references(() => users.id, { onDelete: 'set null' }),
    leasingManagerId: uuid('leasing_manager_id').references(() => users.id, { onDelete: 'set null' }),
    assetManagerId: uuid('asset_manager_id').references(() => users.id, { onDelete: 'set null' }),

    acquisitionDate: date('acquisition_date'),
    operationalStartDate: date('operational_start_date'),

    // Technical information (BRD 9)
    landArea: area('land_area'),
    builtUpArea: area('built_up_area'),
    grossLeasableArea: area('gross_leasable_area'),
    netLeasableArea: area('net_leasable_area'),
    commonArea: area('common_area'),
    parkingArea: area('parking_area'),
    buildingCount: integer('building_count').notNull().default(0),
    floorCount: integer('floor_count').notNull().default(0),
    unitCount: integer('unit_count').notNull().default(0),
    constructionYear: integer('construction_year'),
    renovationYear: integer('renovation_year'),
    condition: varchar('condition', { length: 32 }),
    parkingCapacity: integer('parking_capacity'),
    elevatorCount: integer('elevator_count'),
    hvacType: varchar('hvac_type', { length: 64 }),
    electricalCapacity: varchar('electrical_capacity', { length: 64 }),
    waterInfrastructure: varchar('water_infrastructure', { length: 64 }),
    fireFightingSystem: boolean('fire_fighting_system').notNull().default(false),
    fireAlarmSystem: boolean('fire_alarm_system').notNull().default(false),
    generator: boolean('generator').notNull().default(false),
    buildingManagementSystem: boolean('building_management_system').notNull().default(false),
    cctv: boolean('cctv').notNull().default(false),
    accessControl: boolean('access_control').notNull().default(false),
    loadingFacilities: boolean('loading_facilities').notNull().default(false),
    emergencySystems: boolean('emergency_systems').notNull().default(false),

    amenities: jsonb('amenities').$type<string[]>().notNull().default([]),
    descriptionEn: text('description_en'),
    descriptionAr: text('description_ar'),
    coverImageUrl: text('cover_image_url'),

    // Website publishing controls (BRD 89)
    publicationState: publicationStateEnum('publication_state').notNull().default('unpublished'),
    publishPrice: boolean('publish_price').notNull().default(true),
    publishAvailability: boolean('publish_availability').notNull().default(true),
    firstPublishedAt: timestamp('first_published_at', { withTimezone: true }),

    /** Custom fields configured per organization (BRD 3.5). */
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    unique('properties_org_code_uq').on(t.organizationId, t.code),
    index('properties_org_idx').on(t.organizationId),
    index('properties_city_idx').on(t.cityId),
    index('properties_district_idx').on(t.districtId),
    index('properties_type_idx').on(t.propertyTypeId),
    index('properties_status_idx').on(t.status),
    index('properties_name_idx').on(t.nameEn),
    index('properties_portfolio_idx').on(t.portfolioId),
  ],
);

/** Ownership records (BRD 7). Multiple owners per property with percentages. */
export const propertyOwnerships = pgTable(
  'property_ownerships',
  {
    id: pk(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    documentType: varchar('document_type', { length: 64 }).notNull(),
    documentNumber: varchar('document_number', { length: 64 }).notNull(),
    documentDate: date('document_date'),
    issuingAuthority: varchar('issuing_authority', { length: 160 }),
    documentId: uuid('document_id'),
    ownerType: ownerTypeEnum('owner_type').notNull(),
    ownerName: varchar('owner_name', { length: 200 }).notNull(),
    identificationType: varchar('identification_type', { length: 48 }),
    identificationNumber: varchar('identification_number', { length: 64 }),
    commercialRegistration: varchar('commercial_registration', { length: 40 }),
    ownershipPercentage: percent('ownership_percentage').notNull().default(100),
    authorizedRepresentative: varchar('authorized_representative', { length: 160 }),
    notes: text('notes'),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    index('property_ownerships_property_idx').on(t.propertyId),
    index('property_ownerships_doc_idx').on(t.documentNumber),
    index('property_ownerships_cr_idx').on(t.commercialRegistration),
  ],
);

export const buildings = pgTable(
  'buildings',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 32 }).notNull(),
    nameEn: varchar('name_en', { length: 160 }).notNull(),
    nameAr: varchar('name_ar', { length: 160 }),
    floorCount: integer('floor_count').notNull().default(0),
    unitCount: integer('unit_count').notNull().default(0),
    grossLeasableArea: area('gross_leasable_area'),
    constructionYear: integer('construction_year'),
    elevatorCount: integer('elevator_count'),
    parkingCapacity: integer('parking_capacity'),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    unique('buildings_property_code_uq').on(t.propertyId, t.code),
    index('buildings_property_idx').on(t.propertyId),
  ],
);

export const floors = pgTable(
  'floors',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    buildingId: uuid('building_id')
      .notNull()
      .references(() => buildings.id, { onDelete: 'cascade' }),
    level: integer('level').notNull(),
    nameEn: varchar('name_en', { length: 120 }).notNull(),
    nameAr: varchar('name_ar', { length: 120 }),
    grossArea: area('gross_area'),
    unitCount: integer('unit_count').notNull().default(0),
    floorPlanUrl: text('floor_plan_url'),
    /** Unit boundary polygons for the interactive floor plan. */
    floorPlanLayout: jsonb('floor_plan_layout').$type<Record<string, unknown>>(),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    unique('floors_building_level_uq').on(t.buildingId, t.level),
    index('floors_building_idx').on(t.buildingId),
  ],
);

export const units = pgTable(
  'units',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    buildingId: uuid('building_id').references(() => buildings.id, { onDelete: 'set null' }),
    floorId: uuid('floor_id').references(() => floors.id, { onDelete: 'set null' }),
    code: varchar('code', { length: 40 }).notNull(),
    unitNumber: varchar('unit_number', { length: 40 }).notNull(),
    unitTypeId: uuid('unit_type_id')
      .notNull()
      .references(() => unitTypes.id, { onDelete: 'restrict' }),
    usageType: varchar('usage_type', { length: 32 }).notNull().default('commercial'),
    statusId: uuid('status_id')
      .notNull()
      .references(() => unitStatuses.id, { onDelete: 'restrict' }),

    grossArea: area('gross_area'),
    netArea: area('net_area'),
    leasableArea: area('leasable_area'),
    terraceArea: area('terrace_area'),
    balconyArea: area('balcony_area'),
    storageArea: area('storage_area'),
    parkingAllocation: integer('parking_allocation').notNull().default(0),

    roomCount: integer('room_count'),
    bedroomCount: integer('bedroom_count'),
    bathroomCount: integer('bathroom_count'),
    hasKitchen: boolean('has_kitchen').notNull().default(false),
    hasMaidRoom: boolean('has_maid_room').notNull().default(false),
    hasDriverRoom: boolean('has_driver_room').notNull().default(false),
    furnishingStatus: varchar('furnishing_status', { length: 32 }).notNull().default('unfurnished'),
    hvacType: varchar('hvac_type', { length: 64 }),
    electricityMeterNumber: varchar('electricity_meter_number', { length: 48 }),
    waterMeterNumber: varchar('water_meter_number', { length: 48 }),
    electricityAccount: varchar('electricity_account', { length: 48 }),
    waterAccount: varchar('water_account', { length: 48 }),
    condition: varchar('condition', { length: 32 }),

    /** Manually declared availability date; the engine derives the effective one. */
    availabilityDate: date('availability_date'),
    /** Derived by the availability engine (BRD 14) — never edited directly. */
    computedAvailableFrom: date('computed_available_from'),
    computedAvailabilityClass: varchar('computed_availability_class', { length: 24 })
      .notNull()
      .default('not_available'),
    availabilityComputedAt: timestamp('availability_computed_at', { withTimezone: true }),

    // Commercial unit information (BRD 11)
    frontage: numeric('frontage', { precision: 8, scale: 2, mode: 'number' }),
    ceilingHeight: numeric('ceiling_height', { precision: 6, scale: 2, mode: 'number' }),
    electricalLoad: varchar('electrical_load', { length: 64 }),
    permittedActivities: jsonb('permitted_activities').$type<string[]>().notNull().default([]),
    signageRights: boolean('signage_rights').notNull().default(false),
    loadingAccess: boolean('loading_access').notNull().default(false),
    deliveryAccess: boolean('delivery_access').notNull().default(false),
    /** shell_core | semi_fitted | fully_fitted | furnished */
    fitOutStatus: varchar('fit_out_status', { length: 24 }).notNull().default('shell_core'),
    fireSystem: boolean('fire_system').notNull().default(false),
    hvacCapacity: varchar('hvac_capacity', { length: 64 }),
    utilityCapacity: varchar('utility_capacity', { length: 64 }),
    fitOutRequirements: text('fit_out_requirements'),

    descriptionEn: text('description_en'),
    descriptionAr: text('description_ar'),
    coverImageUrl: text('cover_image_url'),

    // Website publishing (BRD 89) — BR-001 enforced in the publishing service.
    publicationState: publicationStateEnum('publication_state').notNull().default('unpublished'),
    publishPrice: boolean('publish_price').notNull().default(true),
    publishUnitNumber: boolean('publish_unit_number').notNull().default(true),
    publishAvailability: boolean('publish_availability').notNull().default(true),
    contactForPrice: boolean('contact_for_price').notNull().default(false),
    firstPublishedAt: timestamp('first_published_at', { withTimezone: true }),
    listedAt: timestamp('listed_at', { withTimezone: true }),

    // Vacancy tracking (BRD 76-78)
    vacancyStartDate: date('vacancy_start_date'),
    lastLeasedAt: date('last_leased_at'),

    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    unique('units_org_code_uq').on(t.organizationId, t.code),
    index('units_property_idx').on(t.propertyId),
    index('units_building_idx').on(t.buildingId),
    index('units_floor_idx').on(t.floorId),
    index('units_status_idx').on(t.statusId),
    index('units_availability_idx').on(t.computedAvailabilityClass),
    index('units_type_idx').on(t.unitTypeId),
    index('units_number_idx').on(t.unitNumber),
    index('units_publication_idx').on(t.publicationState),
  ],
);

/** Current pricing for a unit (BRD 16). One row per unit. */
export const unitPricing = pgTable(
  'unit_pricing',
  {
    id: pk(),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' })
      .unique(),
    askingRent: money('asking_rent').notNull().default(0),
    targetRent: money('target_rent'),
    minimumRent: money('minimum_rent'),
    approvedRent: money('approved_rent'),
    marketRent: money('market_rent'),
    previousRent: money('previous_rent'),
    rentPerSqm: money('rent_per_sqm'),
    serviceCharges: money('service_charges').notNull().default(0),
    depositAmount: money('deposit_amount').notNull().default(0),
    utilitiesCharges: money('utilities_charges').notNull().default(0),
    parkingCharges: money('parking_charges').notNull().default(0),
    otherCharges: money('other_charges').notNull().default(0),
    vatApplicable: boolean('vat_applicable').notNull().default(true),
    discountPercent: percent('discount_percent').notNull().default(0),
    incentives: text('incentives'),
    rentFreeDays: integer('rent_free_days').notNull().default(0),
    fitOutContribution: money('fit_out_contribution').notNull().default(0),
    effectiveFrom: date('effective_from'),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [index('unit_pricing_unit_idx').on(t.unitId)],
);

/** Append-only price history (BRD 17, BR-005). Rows are never updated. */
export const priceHistory = pgTable(
  'price_history',
  {
    id: pk(),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    field: varchar('field', { length: 48 }).notNull(),
    previousValue: money('previous_value'),
    newValue: money('new_value').notNull(),
    effectiveDate: date('effective_date').notNull(),
    changedByUserId: uuid('changed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    reason: text('reason'),
    approvalReference: varchar('approval_reference', { length: 64 }),
    supportingDocumentId: uuid('supporting_document_id'),
    marketReference: text('market_reference'),
    isDemo: isDemo(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index('price_history_unit_idx').on(t.unitId),
    index('price_history_created_idx').on(t.createdAt),
  ],
);

/** Pricing exception approvals (BRD 18, BR-004). */
export const pricingApprovals = pgTable(
  'pricing_approvals',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    reference: varchar('reference', { length: 32 }).notNull(),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id'),
    proposalId: uuid('proposal_id'),
    askingPrice: money('asking_price').notNull(),
    requestedPrice: money('requested_price').notNull(),
    discountAmount: money('discount_amount').notNull(),
    discountPercent: percent('discount_percent').notNull(),
    annualImpact: money('annual_impact').notNull(),
    contractTermMonths: integer('contract_term_months').notNull(),
    totalContractValue: money('total_contract_value').notNull(),
    justification: text('justification').notNull(),
    /** Approval tier resolved from configured thresholds. */
    requiredRoleKey: varchar('required_role_key', { length: 64 }).notNull(),
    status: approvalStatusEnum('status').notNull().default('pending'),
    requestedByUserId: uuid('requested_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    decidedByUserId: uuid('decided_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNotes: text('decision_notes'),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    unique('pricing_approvals_org_ref_uq').on(t.organizationId, t.reference),
    index('pricing_approvals_status_idx').on(t.status),
    index('pricing_approvals_unit_idx').on(t.unitId),
  ],
);

export const propertiesRelations = relations(properties, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [properties.organizationId],
    references: [organizations.id],
  }),
  propertyType: one(propertyTypes, {
    fields: [properties.propertyTypeId],
    references: [propertyTypes.id],
  }),
  city: one(cities, { fields: [properties.cityId], references: [cities.id] }),
  district: one(districts, { fields: [properties.districtId], references: [districts.id] }),
  region: one(regions, { fields: [properties.regionId], references: [regions.id] }),
  portfolio: one(portfolios, { fields: [properties.portfolioId], references: [portfolios.id] }),
  propertyManager: one(users, { fields: [properties.propertyManagerId], references: [users.id] }),
  buildings: many(buildings),
  units: many(units),
  ownerships: many(propertyOwnerships),
}));

export const buildingsRelations = relations(buildings, ({ one, many }) => ({
  property: one(properties, { fields: [buildings.propertyId], references: [properties.id] }),
  floors: many(floors),
  units: many(units),
}));

export const floorsRelations = relations(floors, ({ one, many }) => ({
  building: one(buildings, { fields: [floors.buildingId], references: [buildings.id] }),
  units: many(units),
}));

export const unitsRelations = relations(units, ({ one, many }) => ({
  property: one(properties, { fields: [units.propertyId], references: [properties.id] }),
  building: one(buildings, { fields: [units.buildingId], references: [buildings.id] }),
  floor: one(floors, { fields: [units.floorId], references: [floors.id] }),
  unitType: one(unitTypes, { fields: [units.unitTypeId], references: [unitTypes.id] }),
  status: one(unitStatuses, { fields: [units.statusId], references: [unitStatuses.id] }),
  pricing: one(unitPricing, { fields: [units.id], references: [unitPricing.unitId] }),
  priceHistory: many(priceHistory),
}));
