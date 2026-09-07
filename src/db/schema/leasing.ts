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
  collectionActionTypeEnum,
  contractStatusEnum,
  invoiceStatusEnum,
  isDemo,
  money,
  paymentFrequencyEnum,
  percent,
  pk,
  timestamps,
} from './_shared';
import { customers, proposals, reservations } from './crm';
import { organizations, users } from './org';
import { buildings, properties, units } from './property';

export const tenants = pgTable(
  'tenants',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 32 }).notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    displayName: varchar('display_name', { length: 200 }).notNull(),
    displayNameAr: varchar('display_name_ar', { length: 200 }),
    industry: varchar('industry', { length: 120 }),
    /** active | former | prospective | blacklisted */
    status: varchar('status', { length: 24 }).notNull().default('active'),
    onboardedAt: date('onboarded_at'),
    accountManagerId: uuid('account_manager_id').references(() => users.id, { onDelete: 'set null' }),
    creditRating: varchar('credit_rating', { length: 16 }),
    notes: text('notes'),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    unique('tenants_org_code_uq').on(t.organizationId, t.code),
    index('tenants_customer_idx').on(t.customerId),
    index('tenants_org_idx').on(t.organizationId),
  ],
);

/**
 * Lease contracts. BR-003 (no overlapping active contracts per unit) is
 * enforced by an EXCLUDE constraint added in migration SQL.
 * BR-012: signed contracts are never hard-deleted.
 */
export const contracts = pgTable(
  'contracts',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    contractNumber: varchar('contract_number', { length: 40 }).notNull(),
    version: integer('version').notNull().default(1),
    ejarReference: varchar('ejar_reference', { length: 64 }),
    ejarStatus: varchar('ejar_status', { length: 32 }).notNull().default('not_submitted'),
    ejarSubmittedAt: timestamp('ejar_submitted_at', { withTimezone: true }),
    ejarLastSyncAt: timestamp('ejar_last_sync_at', { withTimezone: true }),
    ejarErrorMessage: text('ejar_error_message'),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    lessorName: varchar('lessor_name', { length: 200 }).notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),
    buildingId: uuid('building_id').references(() => buildings.id, { onDelete: 'set null' }),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'restrict' }),
    reservationId: uuid('reservation_id').references(() => reservations.id, { onDelete: 'set null' }),
    proposalId: uuid('proposal_id').references(() => proposals.id, { onDelete: 'set null' }),

    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    durationMonths: integer('duration_months').notNull(),
    leasableArea: area('leasable_area'),

    annualRent: money('annual_rent').notNull(),
    rentPerSqm: money('rent_per_sqm'),
    paymentFrequency: paymentFrequencyEnum('payment_frequency').notNull().default('quarterly'),
    depositAmount: money('deposit_amount').notNull().default(0),
    vatRateBps: integer('vat_rate_bps').notNull().default(1500),
    serviceCharges: money('service_charges').notNull().default(0),
    escalationPercent: percent('escalation_percent').notNull().default(0),
    escalationFrequencyMonths: integer('escalation_frequency_months').notNull().default(12),
    gracePeriodDays: integer('grace_period_days').notNull().default(0),
    fitOutPeriodDays: integer('fit_out_period_days').notNull().default(0),
    specialConditions: text('special_conditions'),

    status: contractStatusEnum('status').notNull().default('draft'),
    /** Denormalised for the BR-003 exclusion constraint. */
    isActive: boolean('is_active').notNull().default(false),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    activatedAt: timestamp('activated_at', { withTimezone: true }),

    // Notice / move-out (BRD 85)
    noticeDate: date('notice_date'),
    expectedVacateDate: date('expected_vacate_date'),
    terminationReason: text('termination_reason'),
    terminatedAt: timestamp('terminated_at', { withTimezone: true }),

    // Renewal (BRD 83-84)
    renewalStatus: varchar('renewal_status', { length: 32 }).notNull().default('not_started'),
    renewedFromContractId: uuid('renewed_from_contract_id'),
    renewalProbability: integer('renewal_probability').notNull().default(50),
    proposedRenewalRent: money('proposed_renewal_rent'),

    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    unique('contracts_org_number_version_uq').on(t.organizationId, t.contractNumber, t.version),
    index('contracts_unit_idx').on(t.unitId),
    index('contracts_tenant_idx').on(t.tenantId),
    index('contracts_property_idx').on(t.propertyId),
    index('contracts_status_idx').on(t.status),
    index('contracts_dates_idx').on(t.startDate, t.endDate),
    index('contracts_end_date_idx').on(t.endDate),
  ],
);

/** Immutable snapshot of contract terms at each material change. */
export const contractVersions = pgTable(
  'contract_versions',
  {
    id: pk(),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    changeReason: text('change_reason'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    unique('contract_versions_uq').on(t.contractId, t.version),
    index('contract_versions_contract_idx').on(t.contractId),
  ],
);

export const renewals = pgTable(
  'renewals',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id, { onDelete: 'cascade' }),
    noticeDueDate: date('notice_due_date').notNull(),
    /** pending | in_discussion | offer_sent | renewed | not_renewed | declined */
    status: varchar('status', { length: 32 }).notNull().default('pending'),
    currentRent: money('current_rent').notNull(),
    proposedRent: money('proposed_rent'),
    marketRent: money('market_rent'),
    agreedRent: money('agreed_rent'),
    newContractId: uuid('new_contract_id'),
    probability: integer('probability').notNull().default(50),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    index('renewals_contract_idx').on(t.contractId),
    index('renewals_status_idx').on(t.status),
    index('renewals_notice_idx').on(t.noticeDueDate),
  ],
);

export const handovers = pgTable(
  'handovers',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id, { onDelete: 'cascade' }),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'restrict' }),
    /** handover | move_out */
    handoverType: varchar('handover_type', { length: 16 }).notNull().default('handover'),
    /** pending | ready | completed | cancelled */
    status: varchar('status', { length: 24 }).notNull().default('pending'),
    contractSigned: boolean('contract_signed').notNull().default(false),
    paymentReceived: boolean('payment_received').notNull().default(false),
    depositReceived: boolean('deposit_received').notNull().default(false),
    unitReady: boolean('unit_ready').notNull().default(false),
    keysHandedOver: integer('keys_handed_over').notNull().default(0),
    accessCards: integer('access_cards').notNull().default(0),
    parkingCards: integer('parking_cards').notNull().default(0),
    electricityMeterReading: varchar('electricity_meter_reading', { length: 32 }),
    waterMeterReading: varchar('water_meter_reading', { length: 32 }),
    unitCondition: varchar('unit_condition', { length: 64 }),
    notes: text('notes'),
    photoDocumentIds: jsonb('photo_document_ids').$type<string[]>().notNull().default([]),
    tenantSignature: text('tenant_signature'),
    companySignature: text('company_signature'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedByUserId: uuid('completed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [index('handovers_contract_idx').on(t.contractId), index('handovers_unit_idx').on(t.unitId)],
);

/** Generated from contract terms (BRD 40). One row per scheduled instalment. */
export const paymentSchedules = pgTable(
  'payment_schedules',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id, { onDelete: 'cascade' }),
    installmentNumber: integer('installment_number').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    invoiceDate: date('invoice_date').notNull(),
    dueDate: date('due_date').notNull(),
    rentAmount: money('rent_amount').notNull(),
    serviceChargeAmount: money('service_charge_amount').notNull().default(0),
    vatAmount: money('vat_amount').notNull().default(0),
    totalAmount: money('total_amount').notNull(),
    invoiceId: uuid('invoice_id'),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    unique('payment_schedules_contract_installment_uq').on(t.contractId, t.installmentNumber),
    index('payment_schedules_contract_idx').on(t.contractId),
    index('payment_schedules_due_idx').on(t.dueDate),
  ],
);

/** BR-013: invoices are never hard-deleted; they are cancelled or waived. */
export const invoices = pgTable(
  'invoices',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    invoiceNumber: varchar('invoice_number', { length: 40 }).notNull(),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id, { onDelete: 'restrict' }),
    scheduleId: uuid('schedule_id').references(() => paymentSchedules.id, { onDelete: 'set null' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'restrict' }),
    invoiceDate: date('invoice_date').notNull(),
    dueDate: date('due_date').notNull(),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    rentAmount: money('rent_amount').notNull().default(0),
    serviceChargeAmount: money('service_charge_amount').notNull().default(0),
    vatAmount: money('vat_amount').notNull().default(0),
    otherChargesAmount: money('other_charges_amount').notNull().default(0),
    totalAmount: money('total_amount').notNull(),
    paidAmount: money('paid_amount').notNull().default(0),
    balanceAmount: money('balance_amount').notNull(),
    status: invoiceStatusEnum('status').notNull().default('upcoming'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
    waivedAt: timestamp('waived_at', { withTimezone: true }),
    waiverReason: text('waiver_reason'),
    notes: text('notes'),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    unique('invoices_org_number_uq').on(t.organizationId, t.invoiceNumber),
    index('invoices_contract_idx').on(t.contractId),
    index('invoices_tenant_idx').on(t.tenantId),
    index('invoices_property_idx').on(t.propertyId),
    index('invoices_unit_idx').on(t.unitId),
    index('invoices_due_idx').on(t.dueDate),
    index('invoices_status_idx').on(t.status),
    index('invoices_org_status_due_idx').on(t.organizationId, t.status, t.dueDate),
  ],
);

/** BR-013: payments are never hard-deleted; they are reversed. */
export const payments = pgTable(
  'payments',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    paymentNumber: varchar('payment_number', { length: 40 }).notNull(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    contractId: uuid('contract_id').references(() => contracts.id, { onDelete: 'restrict' }),
    propertyId: uuid('property_id').references(() => properties.id, { onDelete: 'restrict' }),
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'restrict' }),
    paymentDate: date('payment_date').notNull(),
    amount: money('amount').notNull(),
    /** Portion not yet matched to an invoice (BRD 49). */
    unallocatedAmount: money('unallocated_amount').notNull().default(0),
    /** bank_transfer | cheque | cash | card | sadad | pos | online */
    method: varchar('method', { length: 32 }).notNull().default('bank_transfer'),
    referenceNumber: varchar('reference_number', { length: 80 }),
    bankName: varchar('bank_name', { length: 120 }),
    /** received | reconciled | reversed */
    status: varchar('status', { length: 24 }).notNull().default('received'),
    /** deposit | rent | service_charge | other */
    paymentType: varchar('payment_type', { length: 24 }).notNull().default('rent'),
    reversedAt: timestamp('reversed_at', { withTimezone: true }),
    reversalReason: text('reversal_reason'),
    notes: text('notes'),
    recordedByUserId: uuid('recorded_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    unique('payments_org_number_uq').on(t.organizationId, t.paymentNumber),
    index('payments_tenant_idx').on(t.tenantId),
    index('payments_contract_idx').on(t.contractId),
    index('payments_property_idx').on(t.propertyId),
    index('payments_date_idx').on(t.paymentDate),
    index('payments_status_idx').on(t.status),
  ],
);

/** Matching between payments and invoices (BRD 49). */
export const paymentAllocations = pgTable(
  'payment_allocations',
  {
    id: pk(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    amount: money('amount').notNull(),
    /** automatic | manual */
    allocationMethod: varchar('allocation_method', { length: 16 }).notNull().default('automatic'),
    reversedAt: timestamp('reversed_at', { withTimezone: true }),
    allocatedByUserId: uuid('allocated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    isDemo: isDemo(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index('payment_allocations_payment_idx').on(t.paymentId),
    index('payment_allocations_invoice_idx').on(t.invoiceId),
  ],
);

/** Append-only tenant statement of account (BRD 48). */
export const tenantLedgerEntries = pgTable(
  'tenant_ledger_entries',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    contractId: uuid('contract_id').references(() => contracts.id, { onDelete: 'restrict' }),
    entryDate: date('entry_date').notNull(),
    /** opening_balance | invoice | payment | credit_note | adjustment | deposit | refund */
    entryType: varchar('entry_type', { length: 24 }).notNull(),
    description: varchar('description', { length: 240 }).notNull(),
    debitAmount: money('debit_amount').notNull().default(0),
    creditAmount: money('credit_amount').notNull().default(0),
    runningBalance: money('running_balance').notNull(),
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    isDemo: isDemo(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index('tenant_ledger_tenant_idx').on(t.tenantId),
    index('tenant_ledger_date_idx').on(t.entryDate),
    index('tenant_ledger_contract_idx').on(t.contractId),
  ],
);

/** Collection workflow history (BRD 47). */
export const collectionActions = pgTable(
  'collection_actions',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    contractId: uuid('contract_id').references(() => contracts.id, { onDelete: 'set null' }),
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
    actionType: collectionActionTypeEnum('action_type').notNull(),
    outstandingAmount: money('outstanding_amount').notNull().default(0),
    daysOverdue: integer('days_overdue').notNull().default(0),
    notes: text('notes'),
    outcome: varchar('outcome', { length: 160 }),
    nextActionDate: date('next_action_date'),
    performedByUserId: uuid('performed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    isDemo: isDemo(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index('collection_actions_tenant_idx').on(t.tenantId),
    index('collection_actions_invoice_idx').on(t.invoiceId),
    index('collection_actions_created_idx').on(t.createdAt),
  ],
);

export const contractsRelations = relations(contracts, ({ one, many }) => ({
  tenant: one(tenants, { fields: [contracts.tenantId], references: [tenants.id] }),
  property: one(properties, { fields: [contracts.propertyId], references: [properties.id] }),
  unit: one(units, { fields: [contracts.unitId], references: [units.id] }),
  building: one(buildings, { fields: [contracts.buildingId], references: [buildings.id] }),
  schedules: many(paymentSchedules),
  invoices: many(invoices),
}));

export const tenantsRelations = relations(tenants, ({ one, many }) => ({
  customer: one(customers, { fields: [tenants.customerId], references: [customers.id] }),
  contracts: many(contracts),
  invoices: many(invoices),
  payments: many(payments),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  contract: one(contracts, { fields: [invoices.contractId], references: [contracts.id] }),
  tenant: one(tenants, { fields: [invoices.tenantId], references: [tenants.id] }),
  property: one(properties, { fields: [invoices.propertyId], references: [properties.id] }),
  unit: one(units, { fields: [invoices.unitId], references: [units.id] }),
  allocations: many(paymentAllocations),
}));

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  tenant: one(tenants, { fields: [payments.tenantId], references: [tenants.id] }),
  contract: one(contracts, { fields: [payments.contractId], references: [contracts.id] }),
  allocations: many(paymentAllocations),
}));

export const paymentAllocationsRelations = relations(paymentAllocations, ({ one }) => ({
  payment: one(payments, { fields: [paymentAllocations.paymentId], references: [payments.id] }),
  invoice: one(invoices, { fields: [paymentAllocations.invoiceId], references: [invoices.id] }),
}));
