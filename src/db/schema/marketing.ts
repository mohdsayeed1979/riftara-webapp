import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { isDemo, money, pk, timestamps } from './_shared';
import { customers, leads } from './crm';
import { organizations } from './org';
import { properties, units } from './property';

/** Advertising platforms available for connection (BRD 93). */
export const marketingPlatforms = pgTable(
  'marketing_platforms',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: varchar('key', { length: 48 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    /** social | search | analytics | portal | other */
    category: varchar('category', { length: 24 }).notNull().default('social'),
    brandColor: varchar('brand_color', { length: 16 }),
    supportsLeadForms: boolean('supports_lead_forms').notNull().default(false),
    supportsConversionUpload: boolean('supports_conversion_upload').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [unique('marketing_platforms_org_key_uq').on(t.organizationId, t.key)],
);

export const campaigns = pgTable(
  'campaigns',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    platformId: uuid('platform_id')
      .notNull()
      .references(() => marketingPlatforms.id, { onDelete: 'restrict' }),
    externalCampaignId: varchar('external_campaign_id', { length: 120 }),
    name: varchar('name', { length: 200 }).notNull(),
    objective: varchar('objective', { length: 64 }),
    /** draft | active | paused | completed */
    status: varchar('status', { length: 24 }).notNull().default('active'),
    startDate: date('start_date').notNull(),
    endDate: date('end_date'),
    budget: money('budget').notNull().default(0),
    // Campaign-to-asset mapping (BRD 100)
    portfolioId: uuid('portfolio_id'),
    cityId: uuid('city_id'),
    districtId: uuid('district_id'),
    propertyId: uuid('property_id').references(() => properties.id, { onDelete: 'set null' }),
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
    targetUnitType: varchar('target_unit_type', { length: 64 }),
    utmCampaign: varchar('utm_campaign', { length: 160 }),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    index('campaigns_platform_idx').on(t.platformId),
    index('campaigns_property_idx').on(t.propertyId),
    index('campaigns_status_idx').on(t.status),
    index('campaigns_dates_idx').on(t.startDate, t.endDate),
  ],
);

/** Daily campaign metrics pulled from platform APIs (BRD 95). */
export const campaignMetrics = pgTable(
  'campaign_metrics',
  {
    id: pk(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    metricDate: date('metric_date').notNull(),
    adGroup: varchar('ad_group', { length: 160 }),
    adId: varchar('ad_id', { length: 120 }),
    creative: varchar('creative', { length: 200 }),
    spend: money('spend').notNull().default(0),
    impressions: bigint('impressions', { mode: 'number' }).notNull().default(0),
    reach: bigint('reach', { mode: 'number' }).notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    leadCount: integer('lead_count').notNull().default(0),
    /** Denormalised conversion counters maintained by the attribution service. */
    qualifiedLeadCount: integer('qualified_lead_count').notNull().default(0),
    viewingCount: integer('viewing_count').notNull().default(0),
    proposalCount: integer('proposal_count').notNull().default(0),
    reservationCount: integer('reservation_count').notNull().default(0),
    contractCount: integer('contract_count').notNull().default(0),
    contractValue: money('contract_value').notNull().default(0),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    unique('campaign_metrics_uq').on(t.campaignId, t.metricDate, t.adId),
    index('campaign_metrics_campaign_idx').on(t.campaignId),
    index('campaign_metrics_date_idx').on(t.metricDate),
  ],
);

/** Multi-touch attribution records (BRD 96). */
export const marketingAttributions = pgTable(
  'marketing_attributions',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    platformId: uuid('platform_id').references(() => marketingPlatforms.id, { onDelete: 'set null' }),
    /** first_touch | last_touch | assisted */
    touchType: varchar('touch_type', { length: 16 }).notNull(),
    touchedAt: timestamp('touched_at', { withTimezone: true }).notNull().defaultNow(),
    utmSource: varchar('utm_source', { length: 120 }),
    utmMedium: varchar('utm_medium', { length: 120 }),
    utmCampaign: varchar('utm_campaign', { length: 160 }),
    utmContent: varchar('utm_content', { length: 160 }),
    utmTerm: varchar('utm_term', { length: 160 }),
    clickId: varchar('click_id', { length: 160 }),
    landingPage: text('landing_page'),
    /** Fractional credit for multi-touch models, 0-1 scaled by 10000. */
    creditBps: integer('credit_bps').notNull().default(10000),
    isDemo: isDemo(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index('marketing_attributions_lead_idx').on(t.leadId),
    index('marketing_attributions_campaign_idx').on(t.campaignId),
  ],
);

/** Marketing consent + privacy preferences (BRD 103). */
export const consents = pgTable(
  'consents',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    /** marketing | communication | cookies | data_processing */
    consentType: varchar('consent_type', { length: 32 }).notNull(),
    granted: boolean('granted').notNull(),
    channel: varchar('channel', { length: 32 }),
    source: varchar('source', { length: 120 }),
    ipAddress: varchar('ip_address', { length: 64 }),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    isDemo: isDemo(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index('consents_customer_idx').on(t.customerId),
    index('consents_type_idx').on(t.consentType),
  ],
);

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  platform: one(marketingPlatforms, {
    fields: [campaigns.platformId],
    references: [marketingPlatforms.id],
  }),
  property: one(properties, { fields: [campaigns.propertyId], references: [properties.id] }),
  metrics: many(campaignMetrics),
}));

export const campaignMetricsRelations = relations(campaignMetrics, ({ one }) => ({
  campaign: one(campaigns, { fields: [campaignMetrics.campaignId], references: [campaigns.id] }),
}));

export const marketingPlatformsRelations = relations(marketingPlatforms, ({ many }) => ({
  campaigns: many(campaigns),
}));
