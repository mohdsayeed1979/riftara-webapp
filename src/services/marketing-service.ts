import 'server-only';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { campaignMetrics, campaigns, marketingPlatforms, properties } from '@/db/schema';
import { round2, safeDivide } from '@/lib/utils';

/**
 * Marketing analytics service (BRD 93-99). Aggregates campaign metrics into
 * platform comparisons and marketing KPIs (CPL, ROAS, conversion funnel).
 */

export interface PlatformSummary {
  platformId: string;
  key: string;
  name: string;
  brandColor: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  qualifiedLeads: number;
  contracts: number;
  contractValue: number;
  cpl: number;
  roas: number;
}

function periodStart(months: number): string {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString().slice(0, 10);
}

export async function getPlatformSummaries(
  organizationId: string,
  months = 6,
): Promise<PlatformSummary[]> {
  const db = await getDb();
  const start = periodStart(months);

  const rows = await db
    .select({
      platformId: marketingPlatforms.id,
      key: marketingPlatforms.key,
      name: marketingPlatforms.name,
      brandColor: marketingPlatforms.brandColor,
      spend: sql<number>`coalesce(sum(${campaignMetrics.spend}), 0)::float8`,
      impressions: sql<number>`coalesce(sum(${campaignMetrics.impressions}), 0)::float8`,
      clicks: sql<number>`coalesce(sum(${campaignMetrics.clicks}), 0)::float8`,
      leads: sql<number>`coalesce(sum(${campaignMetrics.leadCount}), 0)::float8`,
      qualifiedLeads: sql<number>`coalesce(sum(${campaignMetrics.qualifiedLeadCount}), 0)::float8`,
      contracts: sql<number>`coalesce(sum(${campaignMetrics.contractCount}), 0)::float8`,
      contractValue: sql<number>`coalesce(sum(${campaignMetrics.contractValue}), 0)::float8`,
    })
    .from(marketingPlatforms)
    .leftJoin(campaigns, eq(campaigns.platformId, marketingPlatforms.id))
    .leftJoin(
      campaignMetrics,
      and(eq(campaignMetrics.campaignId, campaigns.id), gte(campaignMetrics.metricDate, start)),
    )
    .where(and(eq(marketingPlatforms.organizationId, organizationId), eq(marketingPlatforms.isActive, true)))
    .groupBy(marketingPlatforms.id, marketingPlatforms.key, marketingPlatforms.name, marketingPlatforms.brandColor)
    .orderBy(desc(sql`coalesce(sum(${campaignMetrics.leadCount}), 0)`));

  return rows
    .filter((row) => row.key !== 'website')
    .map((row) => {
      const spend = round2(Number(row.spend));
      const leads = Number(row.leads);
      const contractValue = round2(Number(row.contractValue));
      return {
        platformId: row.platformId,
        key: row.key,
        name: row.name,
        brandColor: row.brandColor,
        spend,
        impressions: Number(row.impressions),
        clicks: Number(row.clicks),
        leads,
        qualifiedLeads: Number(row.qualifiedLeads),
        contracts: Number(row.contracts),
        contractValue,
        cpl: round2(safeDivide(spend, leads)),
        roas: round2(safeDivide(contractValue, spend)),
      };
    });
}

export interface MarketingTotals {
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  qualifiedLeads: number;
  contracts: number;
  contractValue: number;
  cpl: number;
  roas: number;
  roi: number;
}

export function aggregateMarketing(platforms: PlatformSummary[]): MarketingTotals {
  const totals = platforms.reduce(
    (acc, platform) => ({
      spend: acc.spend + platform.spend,
      impressions: acc.impressions + platform.impressions,
      clicks: acc.clicks + platform.clicks,
      leads: acc.leads + platform.leads,
      qualifiedLeads: acc.qualifiedLeads + platform.qualifiedLeads,
      contracts: acc.contracts + platform.contracts,
      contractValue: acc.contractValue + platform.contractValue,
    }),
    { spend: 0, impressions: 0, clicks: 0, leads: 0, qualifiedLeads: 0, contracts: 0, contractValue: 0 },
  );

  return {
    ...totals,
    spend: round2(totals.spend),
    contractValue: round2(totals.contractValue),
    cpl: round2(safeDivide(totals.spend, totals.leads)),
    roas: round2(safeDivide(totals.contractValue, totals.spend)),
    roi: round2(safeDivide(totals.contractValue - totals.spend, totals.spend) * 100),
  };
}

export async function getLeadsByChannel(organizationId: string, months = 6) {
  const platforms = await getPlatformSummaries(organizationId, months);
  return platforms
    .filter((platform) => platform.leads > 0)
    .map((platform) => ({ label: platform.name, value: platform.leads, color: platform.brandColor ?? 'var(--color-neutral)' }));
}

export async function getMarketingTrend(organizationId: string, months = 6) {
  const db = await getDb();
  const start = periodStart(months);

  const rows = await db
    .select({
      year: sql<number>`extract(year from ${campaignMetrics.metricDate})::int`,
      month: sql<number>`extract(month from ${campaignMetrics.metricDate})::int`,
      leads: sql<number>`coalesce(sum(${campaignMetrics.leadCount}), 0)::float8`,
      contracts: sql<number>`coalesce(sum(${campaignMetrics.contractCount}), 0)::float8`,
    })
    .from(campaignMetrics)
    .innerJoin(campaigns, eq(campaigns.id, campaignMetrics.campaignId))
    .where(and(eq(campaigns.organizationId, organizationId), gte(campaignMetrics.metricDate, start)))
    .groupBy(sql`extract(year from ${campaignMetrics.metricDate})`, sql`extract(month from ${campaignMetrics.metricDate})`)
    .orderBy(sql`extract(year from ${campaignMetrics.metricDate})`, sql`extract(month from ${campaignMetrics.metricDate})`);

  const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return rows.map((row) => ({
    label: monthLabels[row.month - 1],
    Leads: Number(row.leads),
    Contracts: Number(row.contracts),
  }));
}

export async function getTopCampaigns(organizationId: string, months = 6, limit = 8) {
  const db = await getDb();
  const start = periodStart(months);

  const rows = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      platformName: marketingPlatforms.name,
      propertyName: properties.nameEn,
      spend: sql<number>`coalesce(sum(${campaignMetrics.spend}), 0)::float8`,
      leads: sql<number>`coalesce(sum(${campaignMetrics.leadCount}), 0)::float8`,
      contracts: sql<number>`coalesce(sum(${campaignMetrics.contractCount}), 0)::float8`,
      contractValue: sql<number>`coalesce(sum(${campaignMetrics.contractValue}), 0)::float8`,
    })
    .from(campaigns)
    .innerJoin(marketingPlatforms, eq(marketingPlatforms.id, campaigns.platformId))
    .leftJoin(properties, eq(properties.id, campaigns.propertyId))
    .leftJoin(campaignMetrics, and(eq(campaignMetrics.campaignId, campaigns.id), gte(campaignMetrics.metricDate, start)))
    .where(eq(campaigns.organizationId, organizationId))
    .groupBy(campaigns.id, campaigns.name, marketingPlatforms.name, properties.nameEn)
    .orderBy(desc(sql`coalesce(sum(${campaignMetrics.contractValue}), 0)`))
    .limit(limit);

  return rows.map((row) => {
    const spend = round2(Number(row.spend));
    const leads = Number(row.leads);
    return {
      id: row.id,
      name: row.name,
      platformName: row.platformName,
      propertyName: row.propertyName,
      spend,
      leads,
      contracts: Number(row.contracts),
      contractValue: round2(Number(row.contractValue)),
      cpl: round2(safeDivide(spend, leads)),
      roas: round2(safeDivide(Number(row.contractValue), spend)),
    };
  });
}
