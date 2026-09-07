import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  area,
  isDemo,
  maintenanceTypeEnum,
  money,
  percent,
  pk,
  priorityEnum,
  timestamps,
  workOrderStatusEnum,
} from './_shared';
import { customers } from './crm';
import { contracts, tenants } from './leasing';
import { organizations, users } from './org';
import { buildings, properties, units } from './property';
import { expenseCategories, maintenanceCategories, vendors } from './taxonomy';

/** Operational equipment register (BRD 55). */
export const maintenanceAssets = pgTable(
  'maintenance_assets',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 40 }).notNull(),
    nameEn: varchar('name_en', { length: 160 }).notNull(),
    nameAr: varchar('name_ar', { length: 160 }),
    /** elevator | chiller | generator | pump | fire_panel | hvac | cctv | access_control | other */
    assetType: varchar('asset_type', { length: 40 }).notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    buildingId: uuid('building_id').references(() => buildings.id, { onDelete: 'set null' }),
    location: varchar('location', { length: 160 }),
    manufacturer: varchar('manufacturer', { length: 120 }),
    modelNumber: varchar('model_number', { length: 80 }),
    serialNumber: varchar('serial_number', { length: 80 }),
    purchaseDate: date('purchase_date'),
    purchaseCost: money('purchase_cost'),
    warrantyExpiryDate: date('warranty_expiry_date'),
    supplierVendorId: uuid('supplier_vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
    /** operational | under_maintenance | faulty | decommissioned */
    status: varchar('status', { length: 24 }).notNull().default('operational'),
    lifetimeMaintenanceCost: money('lifetime_maintenance_cost').notNull().default(0),
    lastServiceDate: date('last_service_date'),
    nextServiceDate: date('next_service_date'),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    unique('maintenance_assets_org_code_uq').on(t.organizationId, t.code),
    index('maintenance_assets_property_idx').on(t.propertyId),
    index('maintenance_assets_type_idx').on(t.assetType),
  ],
);

export const workOrders = pgTable(
  'work_orders',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 32 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    maintenanceType: maintenanceTypeEnum('maintenance_type').notNull().default('corrective'),
    categoryId: uuid('category_id').references(() => maintenanceCategories.id, { onDelete: 'set null' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    buildingId: uuid('building_id').references(() => buildings.id, { onDelete: 'set null' }),
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
    assetId: uuid('asset_id').references(() => maintenanceAssets.id, { onDelete: 'set null' }),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    reportedByCustomerId: uuid('reported_by_customer_id').references(() => customers.id, {
      onDelete: 'set null',
    }),
    priority: priorityEnum('priority').notNull().default('medium'),
    status: workOrderStatusEnum('status').notNull().default('open'),
    vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
    assignedUserId: uuid('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),

    // SLA (BRD 53)
    responseSlaHours: integer('response_sla_hours').notNull().default(24),
    resolutionSlaHours: integer('resolution_sla_hours').notNull().default(72),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    actualResponseHours: integer('actual_response_hours'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    actualResolutionHours: integer('actual_resolution_hours'),
    responseSlaMet: boolean('response_sla_met'),
    resolutionSlaMet: boolean('resolution_sla_met'),

    estimatedCost: money('estimated_cost').notNull().default(0),
    actualCost: money('actual_cost').notNull().default(0),
    resolutionNotes: text('resolution_notes'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    unique('work_orders_org_code_uq').on(t.organizationId, t.code),
    index('work_orders_property_idx').on(t.propertyId),
    index('work_orders_unit_idx').on(t.unitId),
    index('work_orders_status_idx').on(t.status),
    index('work_orders_priority_idx').on(t.priority),
    index('work_orders_created_idx').on(t.createdAt),
    index('work_orders_vendor_idx').on(t.vendorId),
  ],
);

/** Individual cost lines that roll up to property OPEX (BR-014). */
export const maintenanceCosts = pgTable(
  'maintenance_costs',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
    assetId: uuid('asset_id').references(() => maintenanceAssets.id, { onDelete: 'set null' }),
    vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
    /** labour | parts | vendor_invoice | other */
    costType: varchar('cost_type', { length: 24 }).notNull().default('vendor_invoice'),
    description: varchar('description', { length: 240 }).notNull(),
    amount: money('amount').notNull(),
    vatAmount: money('vat_amount').notNull().default(0),
    invoiceNumber: varchar('invoice_number', { length: 60 }),
    incurredOn: date('incurred_on').notNull(),
    documentId: uuid('document_id'),
    recordedByUserId: uuid('recorded_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    index('maintenance_costs_work_order_idx').on(t.workOrderId),
    index('maintenance_costs_property_idx').on(t.propertyId),
    index('maintenance_costs_incurred_idx').on(t.incurredOn),
  ],
);

export const preventiveMaintenanceSchedules = pgTable(
  'preventive_maintenance_schedules',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    nameEn: varchar('name_en', { length: 160 }).notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    buildingId: uuid('building_id').references(() => buildings.id, { onDelete: 'set null' }),
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
    assetId: uuid('asset_id').references(() => maintenanceAssets.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').references(() => maintenanceCategories.id, { onDelete: 'set null' }),
    /** weekly | monthly | quarterly | semi_annual | annual */
    frequency: varchar('frequency', { length: 24 }).notNull().default('quarterly'),
    intervalMonths: integer('interval_months').notNull().default(3),
    nextDueDate: date('next_due_date').notNull(),
    lastCompletedDate: date('last_completed_date'),
    vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
    estimatedCost: money('estimated_cost').notNull().default(0),
    /** scheduled | due | overdue | paused */
    status: varchar('status', { length: 24 }).notNull().default('scheduled'),
    isActive: boolean('is_active').notNull().default(true),
    checklist: jsonb('checklist').$type<string[]>().notNull().default([]),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    index('pm_schedules_property_idx').on(t.propertyId),
    index('pm_schedules_due_idx').on(t.nextDueDate),
    index('pm_schedules_asset_idx').on(t.assetId),
  ],
);

/** Operating expenses (BRD 56) — the OPEX side of the NOI formula. */
export const operatingExpenses = pgTable(
  'operating_expenses',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    reference: varchar('reference', { length: 40 }).notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    buildingId: uuid('building_id').references(() => buildings.id, { onDelete: 'set null' }),
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => expenseCategories.id, { onDelete: 'restrict' }),
    vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
    workOrderId: uuid('work_order_id').references(() => workOrders.id, { onDelete: 'set null' }),
    description: varchar('description', { length: 240 }).notNull(),
    amount: money('amount').notNull(),
    vatAmount: money('vat_amount').notNull().default(0),
    incurredOn: date('incurred_on').notNull(),
    periodYear: integer('period_year').notNull(),
    periodMonth: integer('period_month').notNull(),
    invoiceNumber: varchar('invoice_number', { length: 60 }),
    documentId: uuid('document_id'),
    isRecoverable: boolean('is_recoverable').notNull().default(false),
    recordedByUserId: uuid('recorded_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    unique('operating_expenses_org_ref_uq').on(t.organizationId, t.reference),
    index('operating_expenses_property_idx').on(t.propertyId),
    index('operating_expenses_category_idx').on(t.categoryId),
    index('operating_expenses_period_idx').on(t.periodYear, t.periodMonth),
    index('operating_expenses_incurred_idx').on(t.incurredOn),
  ],
);

/** Budget headers and lines (BRD 72). */
export const budgets = pgTable(
  'budgets',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 160 }).notNull(),
    fiscalYear: integer('fiscal_year').notNull(),
    propertyId: uuid('property_id').references(() => properties.id, { onDelete: 'cascade' }),
    /** draft | approved | closed */
    status: varchar('status', { length: 24 }).notNull().default('approved'),
    notes: text('notes'),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    index('budgets_property_idx').on(t.propertyId),
    index('budgets_year_idx').on(t.fiscalYear),
  ],
);

export const budgetLines = pgTable(
  'budget_lines',
  {
    id: pk(),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id, { onDelete: 'cascade' }),
    /** revenue | collection | opex | maintenance | noi */
    lineType: varchar('line_type', { length: 24 }).notNull(),
    categoryId: uuid('category_id').references(() => expenseCategories.id, { onDelete: 'set null' }),
    periodMonth: integer('period_month').notNull(),
    budgetAmount: money('budget_amount').notNull().default(0),
    notes: text('notes'),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    unique('budget_lines_uq').on(t.budgetId, t.lineType, t.periodMonth, t.categoryId),
    index('budget_lines_budget_idx').on(t.budgetId),
  ],
);

/** Asset valuations (BRD 58-59). */
export const valuations = pgTable(
  'valuations',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    valuationDate: date('valuation_date').notNull(),
    acquisitionCost: money('acquisition_cost'),
    bookValue: money('book_value'),
    marketValue: money('market_value').notNull(),
    landValue: money('land_value'),
    buildingValue: money('building_value'),
    previousMarketValue: money('previous_market_value'),
    changeAmount: money('change_amount'),
    changePercent: percent('change_percent'),
    valuationCompany: varchar('valuation_company', { length: 160 }),
    /** income | comparable | cost | residual */
    valuationMethod: varchar('valuation_method', { length: 32 }),
    capRate: percent('cap_rate'),
    reportDocumentId: uuid('report_document_id'),
    /** draft | approved | superseded */
    status: varchar('status', { length: 24 }).notNull().default('approved'),
    /** Exactly one approved current valuation per property drives portfolio value. */
    isCurrent: boolean('is_current').notNull().default(true),
    notes: text('notes'),
    approvedByUserId: uuid('approved_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    index('valuations_property_idx').on(t.propertyId),
    index('valuations_date_idx').on(t.valuationDate),
    index('valuations_current_idx').on(t.propertyId, t.isCurrent),
  ],
);

/**
 * Historical KPI snapshots (BRD 141). Reports reference a snapshot so a
 * generated report never changes when operational data moves on (BRD 118).
 */
export const performanceSnapshots = pgTable(
  'performance_snapshots',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** portfolio | region | city | district | property | building | unit */
    scopeType: varchar('scope_type', { length: 24 }).notNull(),
    scopeId: uuid('scope_id'),
    snapshotDate: date('snapshot_date').notNull(),
    periodYear: integer('period_year').notNull(),
    periodMonth: integer('period_month').notNull(),
    metrics: jsonb('metrics').$type<Record<string, number>>().notNull(),
    isDemo: isDemo(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    unique('performance_snapshots_uq').on(t.scopeType, t.scopeId, t.snapshotDate),
    index('performance_snapshots_scope_idx').on(t.scopeType, t.scopeId),
    index('performance_snapshots_period_idx').on(t.periodYear, t.periodMonth),
  ],
);

/** Vacancy events used for Days on Market / vacancy loss (BRD 76-78). */
export const vacancyPeriods = pgTable(
  'vacancy_periods',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    vacancyStartDate: date('vacancy_start_date').notNull(),
    firstPublishDate: date('first_publish_date'),
    listingDate: date('listing_date'),
    leaseSignedDate: date('lease_signed_date'),
    vacancyEndDate: date('vacancy_end_date'),
    daysVacant: integer('days_vacant'),
    daysOnMarket: integer('days_on_market'),
    estimatedMonthlyLoss: money('estimated_monthly_loss').notNull().default(0),
    estimatedTotalLoss: money('estimated_total_loss').notNull().default(0),
    previousContractId: uuid('previous_contract_id').references(() => contracts.id, {
      onDelete: 'set null',
    }),
    leasableArea: area('leasable_area'),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    index('vacancy_periods_unit_idx').on(t.unitId),
    index('vacancy_periods_property_idx').on(t.propertyId),
    index('vacancy_periods_start_idx').on(t.vacancyStartDate),
  ],
);

export const workOrdersRelations = relations(workOrders, ({ one, many }) => ({
  property: one(properties, { fields: [workOrders.propertyId], references: [properties.id] }),
  unit: one(units, { fields: [workOrders.unitId], references: [units.id] }),
  vendor: one(vendors, { fields: [workOrders.vendorId], references: [vendors.id] }),
  category: one(maintenanceCategories, {
    fields: [workOrders.categoryId],
    references: [maintenanceCategories.id],
  }),
  asset: one(maintenanceAssets, { fields: [workOrders.assetId], references: [maintenanceAssets.id] }),
  costs: many(maintenanceCosts),
}));

export const maintenanceAssetsRelations = relations(maintenanceAssets, ({ one, many }) => ({
  property: one(properties, { fields: [maintenanceAssets.propertyId], references: [properties.id] }),
  building: one(buildings, { fields: [maintenanceAssets.buildingId], references: [buildings.id] }),
  workOrders: many(workOrders),
}));

export const operatingExpensesRelations = relations(operatingExpenses, ({ one }) => ({
  property: one(properties, { fields: [operatingExpenses.propertyId], references: [properties.id] }),
  category: one(expenseCategories, {
    fields: [operatingExpenses.categoryId],
    references: [expenseCategories.id],
  }),
}));

export const valuationsRelations = relations(valuations, ({ one }) => ({
  property: one(properties, { fields: [valuations.propertyId], references: [properties.id] }),
}));
