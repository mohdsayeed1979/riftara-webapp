import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  area,
  customerTypeEnum,
  isDemo,
  money,
  percent,
  pk,
  priorityEnum,
  proposalStatusEnum,
  reservationStatusEnum,
  timestamps,
  viewingStatusEnum,
} from './_shared';
import { organizations, users } from './org';
import { properties, units } from './property';
import { leadSources, leadStages, lossReasons, unitTypes } from './taxonomy';

export const customers = pgTable(
  'customers',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 32 }).notNull(),
    customerType: customerTypeEnum('customer_type').notNull().default('individual'),
    fullNameEn: varchar('full_name_en', { length: 200 }).notNull(),
    fullNameAr: varchar('full_name_ar', { length: 200 }),
    companyName: varchar('company_name', { length: 200 }),
    mobile: varchar('mobile', { length: 32 }),
    alternateMobile: varchar('alternate_mobile', { length: 32 }),
    email: varchar('email', { length: 160 }),
    nationality: varchar('nationality', { length: 64 }),
    employer: varchar('employer', { length: 160 }),
    monthlyIncome: money('monthly_income'),
    businessActivity: varchar('business_activity', { length: 160 }),
    unifiedNumber: varchar('unified_number', { length: 40 }),
    vatNumber: varchar('vat_number', { length: 40 }),
    authorizedRepresentative: varchar('authorized_representative', { length: 160 }),
    addressLine: text('address_line'),
    notes: text('notes'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    /** low | medium | high */
    priority: varchar('priority', { length: 16 }).notNull().default('medium'),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    marketingConsent: boolean('marketing_consent').notNull().default(false),
    communicationConsent: boolean('communication_consent').notNull().default(true),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    unique('customers_org_code_uq').on(t.organizationId, t.code),
    index('customers_mobile_idx').on(t.mobile),
    index('customers_email_idx').on(t.email),
    index('customers_org_idx').on(t.organizationId),
    index('customers_name_idx').on(t.fullNameEn),
  ],
);

/**
 * Identification documents used for duplicate detection (BRD 22, BR-007).
 * The unique index guarantees the same identifier can never be registered twice.
 */
export const customerIdentifiers = pgTable(
  'customer_identifiers',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    /** national_id | iqama | passport | commercial_registration | mobile | email */
    identifierType: varchar('identifier_type', { length: 32 }).notNull(),
    /** Normalised (lowercased / digits only) for reliable matching. */
    identifierValue: varchar('identifier_value', { length: 120 }).notNull(),
    issuingCountry: varchar('issuing_country', { length: 64 }),
    expiryDate: date('expiry_date'),
    isPrimary: boolean('is_primary').notNull().default(false),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    unique('customer_identifiers_uq').on(t.organizationId, t.identifierType, t.identifierValue),
    index('customer_identifiers_customer_idx').on(t.customerId),
    index('customer_identifiers_value_idx').on(t.identifierValue),
  ],
);

export const leads = pgTable(
  'leads',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 32 }).notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    stageId: uuid('stage_id')
      .notNull()
      .references(() => leadStages.id, { onDelete: 'restrict' }),
    sourceId: uuid('source_id').references(() => leadSources.id, { onDelete: 'set null' }),
    campaignId: uuid('campaign_id'),

    requestedPropertyId: uuid('requested_property_id').references(() => properties.id, {
      onDelete: 'set null',
    }),
    requestedUnitId: uuid('requested_unit_id').references(() => units.id, { onDelete: 'set null' }),
    requestedUnitTypeId: uuid('requested_unit_type_id').references(() => unitTypes.id, {
      onDelete: 'set null',
    }),
    requiredArea: area('required_area'),
    budgetMin: money('budget_min'),
    budgetMax: money('budget_max'),
    moveInDate: date('move_in_date'),

    assignedUserId: uuid('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    /** unqualified | qualified | disqualified */
    qualification: varchar('qualification', { length: 24 }).notNull().default('unqualified'),
    priority: priorityEnum('priority').notNull().default('medium'),
    score: integer('score').notNull().default(0),

    nextAction: varchar('next_action', { length: 200 }),
    nextFollowUpAt: timestamp('next_follow_up_at', { withTimezone: true }),

    // SLA tracking (BRD 25)
    firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
    firstResponseMinutes: integer('first_response_minutes'),
    slaBreached: boolean('sla_breached').notNull().default(false),
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),

    lossReasonId: uuid('loss_reason_id').references(() => lossReasons.id, { onDelete: 'set null' }),
    lossNotes: text('loss_notes'),
    closedAt: timestamp('closed_at', { withTimezone: true }),

    // Website / marketing attribution (BRD 92, 96)
    landingPage: text('landing_page'),
    device: varchar('device', { length: 32 }),
    utmSource: varchar('utm_source', { length: 120 }),
    utmMedium: varchar('utm_medium', { length: 120 }),
    utmCampaign: varchar('utm_campaign', { length: 160 }),
    utmContent: varchar('utm_content', { length: 160 }),
    utmTerm: varchar('utm_term', { length: 160 }),
    clickId: varchar('click_id', { length: 160 }),
    firstTouchSource: varchar('first_touch_source', { length: 120 }),
    lastTouchSource: varchar('last_touch_source', { length: 120 }),

    notes: text('notes'),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    unique('leads_org_code_uq').on(t.organizationId, t.code),
    index('leads_stage_idx').on(t.stageId),
    index('leads_customer_idx').on(t.customerId),
    index('leads_assigned_idx').on(t.assignedUserId),
    index('leads_org_created_idx').on(t.organizationId, t.createdAt),
    index('leads_followup_idx').on(t.nextFollowUpAt),
    index('leads_property_idx').on(t.requestedPropertyId),
    index('leads_source_idx').on(t.sourceId),
  ],
);

export const leadActivities = pgTable(
  'lead_activities',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'cascade' }),
    /** call | whatsapp | email | meeting | viewing | note | task | reminder | stage_change | system */
    activityType: varchar('activity_type', { length: 32 }).notNull(),
    subject: varchar('subject', { length: 200 }).notNull(),
    body: text('body'),
    outcome: varchar('outcome', { length: 120 }),
    /** inbound | outbound | internal */
    direction: varchar('direction', { length: 16 }).notNull().default('outbound'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    nextAction: varchar('next_action', { length: 200 }),
    nextFollowUpAt: timestamp('next_follow_up_at', { withTimezone: true }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    isDemo: isDemo(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index('lead_activities_lead_idx').on(t.leadId),
    index('lead_activities_customer_idx').on(t.customerId),
    index('lead_activities_occurred_idx').on(t.occurredAt),
  ],
);

export const viewings = pgTable(
  'viewings',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 32 }).notNull(),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
    assignedUserId: uuid('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
    meetingPoint: varchar('meeting_point', { length: 200 }),
    scheduledDate: date('scheduled_date').notNull(),
    scheduledTime: time('scheduled_time').notNull(),
    status: viewingStatusEnum('status').notNull().default('scheduled'),
    customerConfirmed: boolean('customer_confirmed').notNull().default(false),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    notes: text('notes'),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    unique('viewings_org_code_uq').on(t.organizationId, t.code),
    index('viewings_customer_idx').on(t.customerId),
    index('viewings_unit_idx').on(t.unitId),
    index('viewings_date_idx').on(t.scheduledDate),
    index('viewings_status_idx').on(t.status),
  ],
);

export const viewingFeedback = pgTable(
  'viewing_feedback',
  {
    id: pk(),
    viewingId: uuid('viewing_id')
      .notNull()
      .references(() => viewings.id, { onDelete: 'cascade' })
      .unique(),
    /** All ratings 1-5. */
    interestLevel: integer('interest_level'),
    priceSuitability: integer('price_suitability'),
    areaSuitability: integer('area_suitability'),
    locationSuitability: integer('location_suitability'),
    unitSuitability: integer('unit_suitability'),
    likelihoodToLease: integer('likelihood_to_lease'),
    customerComments: text('customer_comments'),
    agentComments: text('agent_comments'),
    nextAction: varchar('next_action', { length: 200 }),
    recordedByUserId: uuid('recorded_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [index('viewing_feedback_viewing_idx').on(t.viewingId)],
);

/**
 * Proposals. Every modification creates a new row with an incremented version;
 * superseded versions are retained forever (BRD 32).
 */
export const proposals = pgTable(
  'proposals',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    reference: varchar('reference', { length: 32 }).notNull(),
    version: integer('version').notNull().default(1),
    supersedesId: uuid('supersedes_id'),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'restrict' }),

    leasableArea: area('leasable_area').notNull(),
    rentPerSqm: money('rent_per_sqm').notNull(),
    annualRent: money('annual_rent').notNull(),
    vatAmount: money('vat_amount').notNull().default(0),
    serviceCharges: money('service_charges').notNull().default(0),
    depositAmount: money('deposit_amount').notNull().default(0),
    contractDurationMonths: integer('contract_duration_months').notNull(),
    paymentTerms: varchar('payment_terms', { length: 120 }).notNull().default('quarterly'),
    escalationPercent: percent('escalation_percent').notNull().default(0),
    gracePeriodDays: integer('grace_period_days').notNull().default(0),
    fitOutPeriodDays: integer('fit_out_period_days').notNull().default(0),
    parkingSpaces: integer('parking_spaces').notNull().default(0),
    utilitiesTerms: text('utilities_terms'),
    specialTerms: text('special_terms'),
    totalContractValue: money('total_contract_value').notNull(),

    status: proposalStatusEnum('status').notNull().default('draft'),
    pricingApprovalId: uuid('pricing_approval_id'),
    validUntil: date('valid_until'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    documentId: uuid('document_id'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    unique('proposals_org_ref_version_uq').on(t.organizationId, t.reference, t.version),
    index('proposals_customer_idx').on(t.customerId),
    index('proposals_unit_idx').on(t.unitId),
    index('proposals_status_idx').on(t.status),
  ],
);

/**
 * Reservations. BR-002 / double-booking prevention is enforced by the unique
 * partial index `reservations_one_active_per_unit` created in migration SQL.
 */
export const reservations = pgTable(
  'reservations',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 32 }).notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    proposalId: uuid('proposal_id').references(() => proposals.id, { onDelete: 'set null' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'restrict' }),
    reservationDate: date('reservation_date').notNull(),
    expiryDate: date('expiry_date').notNull(),
    reservationAmount: money('reservation_amount').notNull().default(0),
    /** unpaid | paid | refunded | forfeited */
    paymentStatus: varchar('payment_status', { length: 24 }).notNull().default('unpaid'),
    terms: text('terms'),
    status: reservationStatusEnum('status').notNull().default('active'),
    /** Denormalised flag backing the single-active-reservation partial index. */
    isActive: boolean('is_active').notNull().default(true),
    expiredAt: timestamp('expired_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    unique('reservations_org_code_uq').on(t.organizationId, t.code),
    index('reservations_unit_idx').on(t.unitId),
    index('reservations_customer_idx').on(t.customerId),
    index('reservations_status_idx').on(t.status),
    index('reservations_expiry_idx').on(t.expiryDate),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    priority: priorityEnum('priority').notNull().default('medium'),
    /** open | in_progress | completed | cancelled */
    status: varchar('status', { length: 24 }).notNull().default('open'),
    linkedEntityType: varchar('linked_entity_type', { length: 48 }),
    linkedEntityId: uuid('linked_entity_id'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    index('tasks_owner_idx').on(t.ownerUserId),
    index('tasks_status_idx').on(t.status),
    index('tasks_due_idx').on(t.dueAt),
  ],
);

export const customersRelations = relations(customers, ({ many }) => ({
  identifiers: many(customerIdentifiers),
  leads: many(leads),
  viewings: many(viewings),
  proposals: many(proposals),
  reservations: many(reservations),
}));

export const leadsRelations = relations(leads, ({ one, many }) => ({
  customer: one(customers, { fields: [leads.customerId], references: [customers.id] }),
  stage: one(leadStages, { fields: [leads.stageId], references: [leadStages.id] }),
  source: one(leadSources, { fields: [leads.sourceId], references: [leadSources.id] }),
  assignedUser: one(users, { fields: [leads.assignedUserId], references: [users.id] }),
  requestedProperty: one(properties, {
    fields: [leads.requestedPropertyId],
    references: [properties.id],
  }),
  requestedUnit: one(units, { fields: [leads.requestedUnitId], references: [units.id] }),
  activities: many(leadActivities),
}));

export const viewingsRelations = relations(viewings, ({ one }) => ({
  customer: one(customers, { fields: [viewings.customerId], references: [customers.id] }),
  property: one(properties, { fields: [viewings.propertyId], references: [properties.id] }),
  unit: one(units, { fields: [viewings.unitId], references: [units.id] }),
  assignedUser: one(users, { fields: [viewings.assignedUserId], references: [users.id] }),
  feedback: one(viewingFeedback, {
    fields: [viewings.id],
    references: [viewingFeedback.viewingId],
  }),
}));

export const reservationsRelations = relations(reservations, ({ one }) => ({
  customer: one(customers, { fields: [reservations.customerId], references: [customers.id] }),
  unit: one(units, { fields: [reservations.unitId], references: [units.id] }),
  property: one(properties, { fields: [reservations.propertyId], references: [properties.id] }),
}));

export const proposalsRelations = relations(proposals, ({ one }) => ({
  customer: one(customers, { fields: [proposals.customerId], references: [customers.id] }),
  unit: one(units, { fields: [proposals.unitId], references: [units.id] }),
  property: one(properties, { fields: [proposals.propertyId], references: [properties.id] }),
}));
