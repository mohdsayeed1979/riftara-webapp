import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { isDemo, pk, timestamps } from './_shared';
import { organizations } from './org';

/**
 * Configurable reference data. Administrators extend these from Settings
 * without a software release (BRD 5, 13, 23, 39).
 */

const taxonomyColumns = {
  id: pk(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  key: varchar('key', { length: 64 }).notNull(),
  nameEn: varchar('name_en', { length: 120 }).notNull(),
  nameAr: varchar('name_ar', { length: 120 }),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  isSystem: boolean('is_system').notNull().default(false),
  isDemo: isDemo(),
  ...timestamps,
};

export const propertyTypes = pgTable(
  'property_types',
  {
    ...taxonomyColumns,
    /** residential | commercial | mixed | land | specialised */
    category: varchar('category', { length: 32 }).notNull().default('commercial'),
    icon: varchar('icon', { length: 48 }),
  },
  (t) => [unique('property_types_org_key_uq').on(t.organizationId, t.key)],
);

export const unitTypes = pgTable(
  'unit_types',
  {
    ...taxonomyColumns,
    category: varchar('category', { length: 32 }).notNull().default('commercial'),
  },
  (t) => [unique('unit_types_org_key_uq').on(t.organizationId, t.key)],
);

/**
 * Unit lifecycle states (BRD 13). `availabilityClass` groups a status into the
 * five KPI buckets used across dashboards, and `publishable` enforces BR-001.
 */
export const unitStatuses = pgTable(
  'unit_statuses',
  {
    ...taxonomyColumns,
    /** available | reserved | leased | not_available */
    availabilityClass: varchar('availability_class', { length: 24 }).notNull().default('not_available'),
    /** Design-system status token used for badge colours. */
    colorToken: varchar('color_token', { length: 32 }).notNull().default('neutral'),
    publishable: boolean('publishable').notNull().default(false),
    /** Counts towards occupied units in occupancy KPIs. */
    countsAsOccupied: boolean('counts_as_occupied').notNull().default(false),
    /** Blocks new reservations / contracts. */
    blocksLeasing: boolean('blocks_leasing').notNull().default(false),
  },
  (t) => [unique('unit_statuses_org_key_uq').on(t.organizationId, t.key)],
);

export const leadSources = pgTable(
  'lead_sources',
  {
    ...taxonomyColumns,
    /** digital | offline | referral | portal | direct */
    channel: varchar('channel', { length: 32 }).notNull().default('digital'),
    marketingPlatformKey: varchar('marketing_platform_key', { length: 48 }),
  },
  (t) => [unique('lead_sources_org_key_uq').on(t.organizationId, t.key)],
);

export const leadStages = pgTable(
  'lead_stages',
  {
    ...taxonomyColumns,
    pipelineOrder: integer('pipeline_order').notNull().default(0),
    /** open | won | lost */
    stageType: varchar('stage_type', { length: 16 }).notNull().default('open'),
    colorToken: varchar('color_token', { length: 32 }).notNull().default('info'),
    requiresLossReason: boolean('requires_loss_reason').notNull().default(false),
    /** Probability used for weighted pipeline value, 0-100. */
    probability: integer('probability').notNull().default(0),
  },
  (t) => [unique('lead_stages_org_key_uq').on(t.organizationId, t.key)],
);

export const documentCategories = pgTable(
  'document_categories',
  {
    ...taxonomyColumns,
    /** Entity types this category may attach to. */
    appliesTo: jsonb('applies_to').$type<string[]>().notNull().default([]),
    requiresExpiry: boolean('requires_expiry').notNull().default(false),
    expiryWarningDays: integer('expiry_warning_days').notNull().default(30),
  },
  (t) => [unique('document_categories_org_key_uq').on(t.organizationId, t.key)],
);

export const expenseCategories = pgTable(
  'expense_categories',
  {
    ...taxonomyColumns,
    /** Included in OPEX for NOI calculation. */
    includedInOpex: boolean('included_in_opex').notNull().default(true),
    isRecoverable: boolean('is_recoverable').notNull().default(false),
  },
  (t) => [unique('expense_categories_org_key_uq').on(t.organizationId, t.key)],
);

export const maintenanceCategories = pgTable(
  'maintenance_categories',
  {
    ...taxonomyColumns,
    defaultResponseHours: integer('default_response_hours').notNull().default(24),
    defaultResolutionHours: integer('default_resolution_hours').notNull().default(72),
  },
  (t) => [unique('maintenance_categories_org_key_uq').on(t.organizationId, t.key)],
);

export const lossReasons = pgTable(
  'loss_reasons',
  { ...taxonomyColumns },
  (t) => [unique('loss_reasons_org_key_uq').on(t.organizationId, t.key)],
);

export const vendors = pgTable(
  'vendors',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 32 }).notNull(),
    nameEn: varchar('name_en', { length: 160 }).notNull(),
    nameAr: varchar('name_ar', { length: 160 }),
    commercialRegistration: varchar('commercial_registration', { length: 40 }),
    vatNumber: varchar('vat_number', { length: 40 }),
    contactPerson: varchar('contact_person', { length: 160 }),
    phone: varchar('phone', { length: 32 }),
    email: varchar('email', { length: 160 }),
    specialities: jsonb('specialities').$type<string[]>().notNull().default([]),
    slaCompliancePercent: integer('sla_compliance_percent').notNull().default(0),
    rating: integer('rating_x10').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    unique('vendors_org_code_uq').on(t.organizationId, t.code),
    index('vendors_org_idx').on(t.organizationId),
  ],
);
