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
import { integrationStatusEnum, isDemo, pk, timestamps } from './_shared';
import { organizations, users } from './org';
import { documentCategories } from './taxonomy';

/** Polymorphic document store (BRD 12, 137). */
export const documents = pgTable(
  'documents',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').references(() => documentCategories.id, { onDelete: 'set null' }),
    /** property | unit | building | customer | tenant | contract | invoice | payment | work_order | valuation | proposal | reservation */
    entityType: varchar('entity_type', { length: 48 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    title: varchar('title', { length: 240 }).notNull(),
    description: text('description'),
    fileName: varchar('file_name', { length: 260 }).notNull(),
    storageKey: text('storage_key').notNull(),
    mimeType: varchar('mime_type', { length: 120 }).notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    version: integer('version').notNull().default(1),
    /** Points at the head document when this row is an older version. */
    supersedesId: uuid('supersedes_id'),
    isCurrentVersion: boolean('is_current_version').notNull().default(true),
    expiryDate: date('expiry_date'),
    expiryNotifiedAt: timestamp('expiry_notified_at', { withTimezone: true }),
    /** Minimum permission key required to download. */
    requiredPermission: varchar('required_permission', { length: 96 }),
    isConfidential: boolean('is_confidential').notNull().default(false),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    index('documents_entity_idx').on(t.entityType, t.entityId),
    index('documents_org_idx').on(t.organizationId),
    index('documents_expiry_idx').on(t.expiryDate),
    index('documents_category_idx').on(t.categoryId),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** Broadcast to everyone holding this permission when userId is null. */
    requiredPermission: varchar('required_permission', { length: 96 }),
    /** new_lead | uncontacted_lead | follow_up_due | viewing_today | approval_required |
     *  reservation_expiry | contract_expiry | payment_due | payment_overdue |
     *  document_expiry | maintenance_sla_breach | vacant_unit | renewal_required */
    notificationType: varchar('notification_type', { length: 48 }).notNull(),
    severity: varchar('severity', { length: 16 }).notNull().default('info'),
    title: varchar('title', { length: 200 }).notNull(),
    body: text('body'),
    linkHref: varchar('link_href', { length: 400 }),
    entityType: varchar('entity_type', { length: 48 }),
    entityId: uuid('entity_id'),
    readAt: timestamp('read_at', { withTimezone: true }),
    isDemo: isDemo(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index('notifications_user_idx').on(t.userId),
    index('notifications_created_idx').on(t.createdAt),
    index('notifications_type_idx').on(t.notificationType),
    index('notifications_unread_idx').on(t.userId, t.readAt),
  ],
);

/** Integration Hub registry (BRD 108). Status is derived from real credentials. */
export const integrations = pgTable(
  'integrations',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: varchar('key', { length: 48 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    description: text('description'),
    /** website | marketing | government | accounting | crm | automation | bi | communication */
    category: varchar('category', { length: 32 }).notNull(),
    status: integrationStatusEnum('status').notNull().default('not_connected'),
    accountLabel: varchar('account_label', { length: 160 }),
    /** Which system owns the data for this entity set (BRD 109). */
    systemOfRecord: varchar('system_of_record', { length: 48 }).notNull().default('riftara'),
    /** Names of the env vars this connector requires; presence drives status. */
    requiredEnvKeys: jsonb('required_env_keys').$type<string[]>().notNull().default([]),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastSuccessfulSyncAt: timestamp('last_successful_sync_at', { withTimezone: true }),
    failedTransactionCount: integer('failed_transaction_count').notNull().default(0),
    lastErrorMessage: text('last_error_message'),
    /** valid | expired | missing */
    tokenStatus: varchar('token_status', { length: 24 }).notNull().default('missing'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    unique('integrations_org_key_uq').on(t.organizationId, t.key),
    index('integrations_category_idx').on(t.category),
  ],
);

/** BR-018: every integration attempt is logged and traceable. */
export const integrationLogs = pgTable(
  'integration_logs',
  {
    id: pk(),
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => integrations.id, { onDelete: 'cascade' }),
    /** sync | push | pull | webhook_in | webhook_out | auth */
    operation: varchar('operation', { length: 32 }).notNull(),
    direction: varchar('direction', { length: 16 }).notNull().default('outbound'),
    /** success | failure | skipped */
    result: varchar('result', { length: 16 }).notNull(),
    httpStatus: integer('http_status'),
    durationMs: integer('duration_ms'),
    entityType: varchar('entity_type', { length: 48 }),
    entityId: uuid('entity_id'),
    requestSummary: jsonb('request_summary').$type<Record<string, unknown>>(),
    responseSummary: jsonb('response_summary').$type<Record<string, unknown>>(),
    errorMessage: text('error_message'),
    isDemo: isDemo(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index('integration_logs_integration_idx').on(t.integrationId),
    index('integration_logs_created_idx').on(t.createdAt),
    index('integration_logs_result_idx').on(t.result),
  ],
);

/** Outbound webhook subscriptions (BRD 111). */
export const webhooks = pgTable(
  'webhooks',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    targetUrl: text('target_url').notNull(),
    events: jsonb('events').$type<string[]>().notNull().default([]),
    secretHash: varchar('secret_hash', { length: 128 }),
    isActive: boolean('is_active').notNull().default(true),
    lastDeliveryAt: timestamp('last_delivery_at', { withTimezone: true }),
    failureCount: integer('failure_count').notNull().default(0),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [index('webhooks_org_idx').on(t.organizationId)],
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: pk(),
    webhookId: uuid('webhook_id')
      .notNull()
      .references(() => webhooks.id, { onDelete: 'cascade' }),
    event: varchar('event', { length: 64 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    /** pending | delivered | failed */
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    httpStatus: integer('http_status'),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index('webhook_deliveries_webhook_idx').on(t.webhookId),
    index('webhook_deliveries_status_idx').on(t.status),
  ],
);

/** Key/value organization settings (BRD 68). */
export const settings = pgTable(
  'settings',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: varchar('key', { length: 96 }).notNull(),
    group: varchar('group', { length: 48 }).notNull().default('general'),
    value: jsonb('value').notNull(),
    label: varchar('label', { length: 200 }).notNull(),
    description: text('description'),
    /** number | percent | boolean | string | json | duration_days | duration_minutes */
    valueType: varchar('value_type', { length: 24 }).notNull().default('string'),
    isSystem: boolean('is_system').notNull().default(false),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    unique('settings_org_key_uq').on(t.organizationId, t.key),
    index('settings_group_idx').on(t.group),
  ],
);

/** Configurable business rules (BRD 39, 128). */
export const businessRuleConfigs = pgTable(
  'business_rule_configs',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    ruleCode: varchar('rule_code', { length: 24 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    isEnabled: boolean('is_enabled').notNull().default(true),
    /** enforced | warning | disabled — enforcement mode for the rule. */
    enforcement: varchar('enforcement', { length: 16 }).notNull().default('enforced'),
    parameters: jsonb('parameters').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [unique('business_rule_configs_uq').on(t.organizationId, t.ruleCode)],
);

/** KPI dictionary (BRD 120). Formulas live in code; metadata lives here. */
export const kpiDefinitions = pgTable(
  'kpi_definitions',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: varchar('key', { length: 64 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    nameAr: varchar('name_ar', { length: 160 }),
    definition: text('definition').notNull(),
    formula: text('formula').notNull(),
    dataSource: varchar('data_source', { length: 160 }).notNull(),
    /** currency | percent | number | days | ratio | area */
    displayFormat: varchar('display_format', { length: 24 }).notNull().default('number'),
    /** portfolio | region | city | district | property | building | unit | leasing | collections | maintenance | marketing */
    scope: jsonb('scope').$type<string[]>().notNull().default([]),
    reportingFrequency: varchar('reporting_frequency', { length: 24 }).notNull().default('monthly'),
    responsibleDepartment: varchar('responsible_department', { length: 96 }),
    /** true when a higher value is better — drives trend colouring. */
    higherIsBetter: boolean('higher_is_better').notNull().default(true),
    ...timestamps,
  },
  (t) => [unique('kpi_definitions_org_key_uq').on(t.organizationId, t.key)],
);

/** Green / amber / red thresholds (BRD 75). */
export const kpiThresholds = pgTable(
  'kpi_thresholds',
  {
    id: pk(),
    kpiDefinitionId: uuid('kpi_definition_id')
      .notNull()
      .references(() => kpiDefinitions.id, { onDelete: 'cascade' }),
    scopeType: varchar('scope_type', { length: 24 }).notNull().default('portfolio'),
    scopeId: uuid('scope_id'),
    greenMin: integer('green_min_x100'),
    amberMin: integer('amber_min_x100'),
    redMax: integer('red_max_x100'),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [unique('kpi_thresholds_uq').on(t.kpiDefinitionId, t.scopeType, t.scopeId)],
);

/** Saved views and advanced filters (BRD 133). */
export const savedViews = pgTable(
  'saved_views',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** properties | units | leads | contracts | collections | maintenance | tenants */
    module: varchar('module', { length: 48 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    filters: jsonb('filters').$type<Record<string, unknown>>().notNull().default({}),
    columns: jsonb('columns').$type<string[]>(),
    sortBy: varchar('sort_by', { length: 64 }),
    sortDirection: varchar('sort_direction', { length: 8 }).notNull().default('desc'),
    isShared: boolean('is_shared').notNull().default(false),
    isDefault: boolean('is_default').notNull().default(false),
    isSystem: boolean('is_system').notNull().default(false),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    index('saved_views_user_module_idx').on(t.userId, t.module),
    index('saved_views_org_module_idx').on(t.organizationId, t.module),
  ],
);

/** Bulk import batches with validation and rollback support (BRD 135). */
export const importBatches = pgTable(
  'import_batches',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    entityType: varchar('entity_type', { length: 48 }).notNull(),
    fileName: varchar('file_name', { length: 260 }).notNull(),
    /** uploaded | validated | imported | failed | rolled_back */
    status: varchar('status', { length: 24 }).notNull().default('uploaded'),
    totalRows: integer('total_rows').notNull().default(0),
    validRows: integer('valid_rows').notNull().default(0),
    invalidRows: integer('invalid_rows').notNull().default(0),
    duplicateRows: integer('duplicate_rows').notNull().default(0),
    importedRows: integer('imported_rows').notNull().default(0),
    /** IDs created by this batch, enabling rollback. */
    createdEntityIds: jsonb('created_entity_ids').$type<string[]>().notNull().default([]),
    importedAt: timestamp('imported_at', { withTimezone: true }),
    rolledBackAt: timestamp('rolled_back_at', { withTimezone: true }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index('import_batches_org_idx').on(t.organizationId)],
);

export const importErrors = pgTable(
  'import_errors',
  {
    id: pk(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => importBatches.id, { onDelete: 'cascade' }),
    rowNumber: integer('row_number').notNull(),
    field: varchar('field', { length: 96 }),
    errorCode: varchar('error_code', { length: 48 }).notNull(),
    message: text('message').notNull(),
    rowData: jsonb('row_data').$type<Record<string, unknown>>(),
    createdAt: timestamps.createdAt,
  },
  (t) => [index('import_errors_batch_idx').on(t.batchId)],
);

/** Generated management reports with an immutable data snapshot (BRD 118). */
export const reportRuns = pgTable(
  'report_runs',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    reference: varchar('reference', { length: 40 }).notNull(),
    reportType: varchar('report_type', { length: 64 }).notNull(),
    title: varchar('title', { length: 240 }).notNull(),
    scopeType: varchar('scope_type', { length: 24 }).notNull().default('portfolio'),
    scopeId: uuid('scope_id'),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    format: varchar('format', { length: 16 }).notNull().default('pdf'),
    /** Frozen data used to render the report. */
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    executiveCommentary: text('executive_commentary'),
    documentId: uuid('document_id'),
    storageKey: text('storage_key'),
    generatedByUserId: uuid('generated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    isDemo: isDemo(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    unique('report_runs_org_ref_uq').on(t.organizationId, t.reference),
    index('report_runs_type_idx').on(t.reportType),
    index('report_runs_created_idx').on(t.createdAt),
  ],
);

/**
 * Recurring report schedules (BRD 117). A schedule captures WHAT to generate
 * (report type + frozen filter config) and WHEN (frequency in the org timezone).
 * It executes with the creating user's live permissions and data scope, so a
 * schedule can never surface data the creator could not generate manually.
 */
export const reportSchedules = pgTable(
  'report_schedules',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }).notNull(),
    reportType: varchar('report_type', { length: 64 }).notNull(),
    /** daily | weekly | monthly */
    frequency: varchar('frequency', { length: 16 }).notNull().default('monthly'),
    /** Local hour of day (0-23) in the schedule timezone. */
    hour: integer('hour').notNull().default(3),
    /** 0-6 (Sun-Sat) for weekly; null otherwise. */
    dayOfWeek: integer('day_of_week'),
    /** 1-28 for monthly; null otherwise. */
    dayOfMonth: integer('day_of_month'),
    timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Riyadh'),
    isActive: boolean('is_active').notNull().default(true),
    /** Frozen generation config: { period, propertyId?, commentary? }. */
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    format: varchar('format', { length: 16 }).notNull().default('pdf'),
    /** in_app now; email/sms/whatsapp are future delivery methods. */
    deliveryMethod: varchar('delivery_method', { length: 16 }).notNull().default('in_app'),
    /** Recipient config for future external delivery (unused in-app). */
    recipients: jsonb('recipients').$type<string[]>().notNull().default([]),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastStatus: varchar('last_status', { length: 16 }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    index('report_schedules_org_idx').on(t.organizationId),
    index('report_schedules_due_idx').on(t.isActive, t.nextRunAt),
  ],
);

/** Execution history for scheduled (and manual) report runs (BRD 117). Records
 *  successes AND failures, so operators can see and diagnose scheduled runs. */
export const reportScheduleRuns = pgTable(
  'report_schedule_runs',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    scheduleId: uuid('schedule_id')
      .notNull()
      .references(() => reportSchedules.id, { onDelete: 'cascade' }),
    reportType: varchar('report_type', { length: 64 }).notNull(),
    /** success | failed */
    status: varchar('status', { length: 16 }).notNull(),
    format: varchar('format', { length: 16 }).notNull().default('pdf'),
    durationMs: integer('duration_ms'),
    /** Link to the generated report_runs row on success (null on failure). */
    reportRunId: uuid('report_run_id'),
    failureMessage: text('failure_message'),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index('report_schedule_runs_schedule_idx').on(t.scheduleId, t.createdAt),
    index('report_schedule_runs_org_idx').on(t.organizationId),
  ],
);

/**
 * Denormalised website listing projection (BRD 88, BR-009). The publishing
 * service rewrites rows here whenever unit status or pricing changes, so the
 * corporate website reads one table instead of joining the operational model.
 */
export const websiteListings = pgTable(
  'website_listings',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    unitId: uuid('unit_id').notNull().unique(),
    propertyId: uuid('property_id').notNull(),
    slug: varchar('slug', { length: 200 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    isPublished: boolean('is_published').notNull().default(false),
    isFeatured: boolean('is_featured').notNull().default(false),
    availableFrom: date('available_from'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    unpublishedAt: timestamp('unpublished_at', { withTimezone: true }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    unique('website_listings_slug_uq').on(t.organizationId, t.slug),
    index('website_listings_published_idx').on(t.isPublished),
    index('website_listings_property_idx').on(t.propertyId),
  ],
);
