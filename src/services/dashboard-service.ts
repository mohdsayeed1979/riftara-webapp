import 'server-only';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  contracts,
  customers,
  leadSources,
  leadStages,
  leads,
  properties,
  renewals,
  tenants,
  units,
  users,
  workOrders,
  maintenanceCategories,
} from '@/db/schema';
import { resolveScopedPropertyIds, resolveScopedUnitIds, type MetricScope } from './metrics-service';

/** True when the scope narrows below property level (a building or a unit). */
function isUnitScoped(scope: MetricScope): boolean {
  return Boolean(scope.buildingId || scope.unitId);
}

/**
 * List queries backing the dashboard panels. Kept separate from the KPI
 * aggregates so a panel can be streamed independently.
 */

export interface RecentLeadRow {
  id: string;
  code: string;
  customerName: string;
  sourceName: string | null;
  propertyName: string | null;
  stageName: string;
  stageColor: string;
  createdAt: Date;
  assignedTo: string | null;
}

export async function getRecentLeads(scope: MetricScope, limit = 6): Promise<RecentLeadRow[]> {
  const db = await getDb();
  const propertyIds = await resolveScopedPropertyIds(scope);
  if (propertyIds.length === 0) return [];

  const rows = await db
    .select({
      id: leads.id,
      code: leads.code,
      customerName: customers.fullNameEn,
      sourceName: leadSources.nameEn,
      propertyName: properties.nameEn,
      stageName: leadStages.nameEn,
      stageColor: leadStages.colorToken,
      createdAt: leads.createdAt,
      assignedTo: users.fullName,
    })
    .from(leads)
    .innerJoin(customers, eq(customers.id, leads.customerId))
    .innerJoin(leadStages, eq(leadStages.id, leads.stageId))
    .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
    .leftJoin(properties, eq(properties.id, leads.requestedPropertyId))
    .leftJoin(users, eq(users.id, leads.assignedUserId))
    .where(
      and(
        eq(leads.organizationId, scope.organizationId),
        isNull(leads.deletedAt),
        // Leads are not building-scoped; narrow only to a specifically selected unit.
        scope.unitId ? eq(leads.requestedUnitId, scope.unitId) : undefined,
      ),
    )
    .orderBy(desc(leads.createdAt))
    .limit(limit);

  return rows;
}

export interface UpcomingRenewalRow {
  contractId: string;
  contractNumber: string;
  tenantName: string;
  propertyName: string;
  unitCode: string;
  endDate: string;
  annualRent: number;
  daysLeft: number;
  renewalStatus: string;
}

export async function getUpcomingRenewals(
  scope: MetricScope,
  windowDays = 180,
  limit = 6,
): Promise<UpcomingRenewalRow[]> {
  const db = await getDb();
  const propertyIds = await resolveScopedPropertyIds(scope);
  if (propertyIds.length === 0) return [];
  const unitIds = await resolveScopedUnitIds(scope, propertyIds);
  if (isUnitScoped(scope) && unitIds.length === 0) return [];

  const horizon = new Date();
  horizon.setUTCDate(horizon.getUTCDate() + windowDays);

  const rows = await db
    .select({
      contractId: contracts.id,
      contractNumber: contracts.contractNumber,
      tenantName: tenants.displayName,
      propertyName: properties.nameEn,
      unitCode: units.unitNumber,
      endDate: contracts.endDate,
      annualRent: contracts.annualRent,
      renewalStatus: contracts.renewalStatus,
    })
    .from(contracts)
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .innerJoin(properties, eq(properties.id, contracts.propertyId))
    .innerJoin(units, eq(units.id, contracts.unitId))
    .where(
      and(
        isUnitScoped(scope) ? inArray(contracts.unitId, unitIds) : inArray(contracts.propertyId, propertyIds),
        eq(contracts.isActive, true),
        lte(contracts.endDate, horizon.toISOString().slice(0, 10)),
      ),
    )
    .orderBy(asc(contracts.endDate))
    .limit(limit);

  const now = Date.now();
  return rows.map((row) => ({
    ...row,
    annualRent: Number(row.annualRent),
    daysLeft: Math.max(0, Math.ceil((new Date(row.endDate).getTime() - now) / 86_400_000)),
  }));
}

export interface MaintenanceRequestRow {
  id: string;
  code: string;
  title: string;
  unitCode: string | null;
  propertyName: string;
  categoryName: string | null;
  status: string;
  priority: string;
  createdAt: Date;
}

export async function getRecentWorkOrders(
  scope: MetricScope,
  limit = 6,
): Promise<MaintenanceRequestRow[]> {
  const db = await getDb();
  const propertyIds = await resolveScopedPropertyIds(scope);
  if (propertyIds.length === 0) return [];
  const unitIds = await resolveScopedUnitIds(scope, propertyIds);
  if (isUnitScoped(scope) && unitIds.length === 0) return [];

  const rows = await db
    .select({
      id: workOrders.id,
      code: workOrders.code,
      title: workOrders.title,
      unitCode: units.unitNumber,
      propertyName: properties.nameEn,
      categoryName: maintenanceCategories.nameEn,
      status: workOrders.status,
      priority: workOrders.priority,
      createdAt: workOrders.createdAt,
    })
    .from(workOrders)
    .innerJoin(properties, eq(properties.id, workOrders.propertyId))
    .leftJoin(units, eq(units.id, workOrders.unitId))
    .leftJoin(maintenanceCategories, eq(maintenanceCategories.id, workOrders.categoryId))
    .where(
      and(
        isUnitScoped(scope) ? inArray(workOrders.unitId, unitIds) : inArray(workOrders.propertyId, propertyIds),
        isNull(workOrders.deletedAt),
      ),
    )
    .orderBy(desc(workOrders.createdAt))
    .limit(limit);

  return rows;
}

export interface LeasingFunnelStage {
  key: string;
  label: string;
  colorToken: string;
  count: number;
  pipelineOrder: number;
}

export async function getLeasingFunnel(scope: MetricScope): Promise<LeasingFunnelStage[]> {
  const db = await getDb();
  const rows = await db
    .select({
      key: leadStages.key,
      label: leadStages.nameEn,
      colorToken: leadStages.colorToken,
      pipelineOrder: leadStages.pipelineOrder,
      count: sql<number>`count(${leads.id})::int`,
    })
    .from(leadStages)
    .leftJoin(
      leads,
      and(
        eq(leads.stageId, leadStages.id),
        eq(leads.organizationId, scope.organizationId),
        isNull(leads.deletedAt),
      ),
    )
    .where(eq(leadStages.organizationId, scope.organizationId))
    .groupBy(leadStages.key, leadStages.nameEn, leadStages.colorToken, leadStages.pipelineOrder)
    .orderBy(asc(leadStages.pipelineOrder));

  return rows.map((row) => ({ ...row, count: Number(row.count) }));
}

export interface LeasingActivitySummary {
  totalLeads: number;
  newThisMonth: number;
  qualifiedLeads: number;
  viewingsThisMonth: number;
  proposalsThisMonth: number;
  reservationsActive: number;
  contractsSignedThisMonth: number;
  slaCompliance: number;
  uncontactedLeads: number;
  averageFirstResponseMinutes: number;
}

export async function getLeasingActivity(scope: MetricScope): Promise<LeasingActivitySummary> {
  const db = await getDb();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const { viewings, proposals, reservations } = await import('@/db/schema');

  const [leadRow] = await db
    .select({
      total: sql<number>`count(*)::int`,
      newThisMonth: sql<number>`count(*) filter (where ${leads.createdAt} >= ${monthStart})::int`,
      qualified: sql<number>`count(*) filter (where ${leads.qualification} = 'qualified')::int`,
      uncontacted: sql<number>`count(*) filter (where ${leads.firstResponseAt} is null and ${leads.closedAt} is null)::int`,
      slaMet: sql<number>`count(*) filter (where ${leads.slaBreached} = false and ${leads.firstResponseAt} is not null)::int`,
      slaEvaluated: sql<number>`count(*) filter (where ${leads.firstResponseAt} is not null)::int`,
      avgResponse: sql<number>`coalesce(avg(${leads.firstResponseMinutes}), 0)::float8`,
    })
    .from(leads)
    .where(and(eq(leads.organizationId, scope.organizationId), isNull(leads.deletedAt)));

  const [viewingRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(viewings)
    .where(
      and(eq(viewings.organizationId, scope.organizationId), gte(viewings.createdAt, monthStart)),
    );

  const [proposalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(proposals)
    .where(
      and(eq(proposals.organizationId, scope.organizationId), gte(proposals.createdAt, monthStart)),
    );

  const [reservationRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reservations)
    .where(
      and(eq(reservations.organizationId, scope.organizationId), eq(reservations.status, 'active')),
    );

  const [signedRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contracts)
    .where(
      and(eq(contracts.organizationId, scope.organizationId), gte(contracts.signedAt, monthStart)),
    );

  const slaEvaluated = Number(leadRow?.slaEvaluated ?? 0);

  return {
    totalLeads: Number(leadRow?.total ?? 0),
    newThisMonth: Number(leadRow?.newThisMonth ?? 0),
    qualifiedLeads: Number(leadRow?.qualified ?? 0),
    viewingsThisMonth: Number(viewingRow?.count ?? 0),
    proposalsThisMonth: Number(proposalRow?.count ?? 0),
    reservationsActive: Number(reservationRow?.count ?? 0),
    contractsSignedThisMonth: Number(signedRow?.count ?? 0),
    slaCompliance:
      slaEvaluated > 0 ? Math.round((Number(leadRow?.slaMet ?? 0) / slaEvaluated) * 100) : 0,
    uncontactedLeads: Number(leadRow?.uncontacted ?? 0),
    averageFirstResponseMinutes: Math.round(Number(leadRow?.avgResponse ?? 0)),
  };
}

export interface RenewalPipelineSummary {
  contractsToRenew: number;
  inDiscussion: number;
  offersSent: number;
  renewed: number;
  notRenewed: number;
  renewalRate: number;
}

export async function getRenewalPipeline(scope: MetricScope): Promise<RenewalPipelineSummary> {
  const db = await getDb();
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      inDiscussion: sql<number>`count(*) filter (where ${renewals.status} = 'in_discussion')::int`,
      offersSent: sql<number>`count(*) filter (where ${renewals.status} = 'offer_sent')::int`,
      renewed: sql<number>`count(*) filter (where ${renewals.status} = 'renewed')::int`,
      notRenewed: sql<number>`count(*) filter (where ${renewals.status} = 'not_renewed')::int`,
    })
    .from(renewals)
    .where(eq(renewals.organizationId, scope.organizationId));

  const renewed = Number(row?.renewed ?? 0);
  const notRenewed = Number(row?.notRenewed ?? 0);
  const decided = renewed + notRenewed;

  return {
    contractsToRenew: Number(row?.total ?? 0),
    inDiscussion: Number(row?.inDiscussion ?? 0),
    offersSent: Number(row?.offersSent ?? 0),
    renewed,
    notRenewed,
    renewalRate: decided > 0 ? Math.round((renewed / decided) * 100) : 0,
  };
}
