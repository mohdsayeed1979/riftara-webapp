import 'server-only';
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  customers,
  leadActivities,
  leads,
  leadSources,
  leadStages,
  properties,
  units,
  users,
} from '@/db/schema';
import { recordAudit } from '@/lib/audit';
import { businessRuleViolation, notFound, validationError } from '@/lib/errors';
import { getPolicy } from '@/lib/settings';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Leasing CRM service (BRD 19-27).
 *
 * BR-006: a lost lead requires a loss reason.
 * A qualified/active lead must always carry a next action (policy-gated).
 */

export interface PipelineColumn {
  stageKey: string;
  label: string;
  colorToken: string;
  pipelineOrder: number;
  stageType: string;
  count: number;
  cards: PipelineCard[];
}

export interface PipelineCard {
  id: string;
  code: string;
  customerName: string;
  companyName: string | null;
  propertyName: string | null;
  unitNumber: string | null;
  usageType: string | null;
  sourceName: string | null;
  assignedInitials: string | null;
  priority: string;
  createdAt: Date;
  nextFollowUpAt: Date | null;
}

interface LeadScope {
  organizationId: string;
  allowedPropertyIds?: string[] | null;
  assignedUserId?: string;
  sourceId?: string;
  search?: string;
}

function leadBaseWhere(scope: LeadScope): SQL {
  const conditions: SQL[] = [eq(leads.organizationId, scope.organizationId), isNull(leads.deletedAt)];
  if (scope.allowedPropertyIds?.length) {
    conditions.push(
      or(
        inArray(leads.requestedPropertyId, scope.allowedPropertyIds),
        isNull(leads.requestedPropertyId),
      ) as SQL,
    );
  }
  if (scope.assignedUserId) conditions.push(eq(leads.assignedUserId, scope.assignedUserId));
  if (scope.sourceId) conditions.push(eq(leads.sourceId, scope.sourceId));
  return and(...conditions) as SQL;
}

/** Kanban pipeline: every stage with a capped set of cards (BRD 19). */
export async function getPipeline(scope: LeadScope, cardsPerColumn = 25): Promise<PipelineColumn[]> {
  const db = await getDb();

  const stages = await db
    .select({
      id: leadStages.id,
      key: leadStages.key,
      label: leadStages.nameEn,
      colorToken: leadStages.colorToken,
      pipelineOrder: leadStages.pipelineOrder,
      stageType: leadStages.stageType,
    })
    .from(leadStages)
    .where(and(eq(leadStages.organizationId, scope.organizationId), eq(leadStages.isActive, true)))
    .orderBy(asc(leadStages.pipelineOrder));

  // Open pipeline columns only; won/lost are terminal and shown in list view.
  const openStages = stages.filter((stage) => stage.stageType === 'open');

  const cardRows = await db
    .select({
      id: leads.id,
      code: leads.code,
      stageId: leads.stageId,
      customerName: customers.fullNameEn,
      companyName: customers.companyName,
      propertyName: properties.nameEn,
      unitNumber: units.unitNumber,
      usageType: units.usageType,
      sourceName: leadSources.nameEn,
      assignedName: users.fullName,
      priority: leads.priority,
      createdAt: leads.createdAt,
      nextFollowUpAt: leads.nextFollowUpAt,
    })
    .from(leads)
    .innerJoin(customers, eq(customers.id, leads.customerId))
    .leftJoin(properties, eq(properties.id, leads.requestedPropertyId))
    .leftJoin(units, eq(units.id, leads.requestedUnitId))
    .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
    .leftJoin(users, eq(users.id, leads.assignedUserId))
    .where(and(leadBaseWhere(scope), inArray(leads.stageId, openStages.map((s) => s.id)), isNull(leads.closedAt)))
    .orderBy(desc(leads.createdAt))
    .limit(cardsPerColumn * openStages.length * 2);

  const counts = await db
    .select({ stageId: leads.stageId, total: count() })
    .from(leads)
    .where(and(leadBaseWhere(scope), isNull(leads.closedAt)))
    .groupBy(leads.stageId);
  const countByStage = new Map(counts.map((row) => [row.stageId, Number(row.total)]));

  const cardsByStage = new Map<string, PipelineCard[]>();
  for (const row of cardRows) {
    const bucket = cardsByStage.get(row.stageId) ?? [];
    if (bucket.length < cardsPerColumn) {
      bucket.push({
        id: row.id,
        code: row.code,
        customerName: row.customerName,
        companyName: row.companyName,
        propertyName: row.propertyName,
        unitNumber: row.unitNumber,
        usageType: row.usageType,
        sourceName: row.sourceName,
        assignedInitials: row.assignedName
          ? row.assignedName.split(' ').slice(0, 2).map((p) => p[0]).join('')
          : null,
        priority: row.priority,
        createdAt: row.createdAt,
        nextFollowUpAt: row.nextFollowUpAt,
      });
    }
    cardsByStage.set(row.stageId, bucket);
  }

  return openStages.map((stage) => ({
    stageKey: stage.key,
    label: stage.label,
    colorToken: stage.colorToken,
    pipelineOrder: stage.pipelineOrder,
    stageType: stage.stageType,
    count: countByStage.get(stage.id) ?? 0,
    cards: cardsByStage.get(stage.id) ?? [],
  }));
}

export interface LeadListFilters extends LeadScope {
  stageKey?: string;
  qualification?: string;
  page: number;
  pageSize: number;
}

export interface LeadListItem {
  id: string;
  code: string;
  customerName: string;
  mobile: string | null;
  companyName: string | null;
  propertyName: string | null;
  unitNumber: string | null;
  stageLabel: string;
  stageKey: string;
  stageColor: string;
  sourceName: string | null;
  assignedName: string | null;
  qualification: string;
  priority: string;
  nextAction: string | null;
  nextFollowUpAt: Date | null;
  slaBreached: boolean;
  createdAt: Date;
}

export async function listLeads(
  filters: LeadListFilters,
): Promise<{ items: LeadListItem[]; total: number }> {
  const db = await getDb();
  const conditions: SQL[] = [leadBaseWhere(filters)];
  if (filters.search) {
    conditions.push(
      or(ilike(leads.code, `%${filters.search}%`), ilike(customers.fullNameEn, `%${filters.search}%`)) as SQL,
    );
  }
  if (filters.qualification) conditions.push(eq(leads.qualification, filters.qualification));

  const stageJoin = filters.stageKey ? eq(leadStages.key, filters.stageKey) : undefined;
  const where = and(...conditions, stageJoin) as SQL;

  const rows = await db
    .select({
      id: leads.id,
      code: leads.code,
      customerName: customers.fullNameEn,
      mobile: customers.mobile,
      companyName: customers.companyName,
      propertyName: properties.nameEn,
      unitNumber: units.unitNumber,
      stageLabel: leadStages.nameEn,
      stageKey: leadStages.key,
      stageColor: leadStages.colorToken,
      sourceName: leadSources.nameEn,
      assignedName: users.fullName,
      qualification: leads.qualification,
      priority: leads.priority,
      nextAction: leads.nextAction,
      nextFollowUpAt: leads.nextFollowUpAt,
      slaBreached: leads.slaBreached,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .innerJoin(customers, eq(customers.id, leads.customerId))
    .innerJoin(leadStages, eq(leadStages.id, leads.stageId))
    .leftJoin(properties, eq(properties.id, leads.requestedPropertyId))
    .leftJoin(units, eq(units.id, leads.requestedUnitId))
    .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
    .leftJoin(users, eq(users.id, leads.assignedUserId))
    .where(where)
    .orderBy(desc(leads.createdAt))
    .limit(filters.pageSize)
    .offset((filters.page - 1) * filters.pageSize);

  const [{ total }] = await db
    .select({ total: count() })
    .from(leads)
    .innerJoin(customers, eq(customers.id, leads.customerId))
    .innerJoin(leadStages, eq(leadStages.id, leads.stageId))
    .where(where);

  return { items: rows, total: Number(total) };
}

export interface LeasingKpis {
  totalLeads: number;
  newInquiries: number;
  siteViewings: number;
  proposalsSent: number;
  reservations: number;
  contractsSigned: number;
}

export async function getLeasingKpis(scope: LeadScope): Promise<LeasingKpis> {
  const db = await getDb();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const { viewings, proposals, reservations, contracts } = await import('@/db/schema');

  const [leadRow] = await db
    .select({
      total: count(),
      newThisMonth: sql<number>`count(*) filter (where ${leads.createdAt} >= ${monthStart})::int`,
    })
    .from(leads)
    .where(leadBaseWhere(scope));

  const [viewingRow] = await db
    .select({ c: sql<number>`count(*) filter (where ${viewings.createdAt} >= ${monthStart})::int` })
    .from(viewings)
    .where(eq(viewings.organizationId, scope.organizationId));

  const [proposalRow] = await db
    .select({ c: sql<number>`count(*) filter (where ${proposals.sentAt} >= ${monthStart})::int` })
    .from(proposals)
    .where(eq(proposals.organizationId, scope.organizationId));

  const [reservationRow] = await db
    .select({ c: sql<number>`count(*) filter (where ${reservations.status} = 'active')::int` })
    .from(reservations)
    .where(eq(reservations.organizationId, scope.organizationId));

  const [signedRow] = await db
    .select({ c: sql<number>`count(*) filter (where ${contracts.signedAt} >= ${monthStart})::int` })
    .from(contracts)
    .where(eq(contracts.organizationId, scope.organizationId));

  return {
    totalLeads: Number(leadRow?.total ?? 0),
    newInquiries: Number(leadRow?.newThisMonth ?? 0),
    siteViewings: Number(viewingRow?.c ?? 0),
    proposalsSent: Number(proposalRow?.c ?? 0),
    reservations: Number(reservationRow?.c ?? 0),
    contractsSigned: Number(signedRow?.c ?? 0),
  };
}

/**
 * Moves a lead to a new stage (Kanban drag or list action).
 * Enforces BR-006 (loss reason on lost) and the next-action policy.
 */
export async function moveLeadToStage(
  actor: SessionUser,
  input: { leadId: string; stageKey: string; lossReasonId?: string; lossNotes?: string; nextAction?: string; nextFollowUpAt?: Date },
): Promise<void> {
  const db = await getDb();
  const policy = await getPolicy(actor.organizationId);

  await db.transaction(async (tx) => {
    const [lead] = await tx
      .select({ id: leads.id, code: leads.code, stageId: leads.stageId, firstResponseAt: leads.firstResponseAt })
      .from(leads)
      .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, actor.organizationId)))
      .limit(1);
    if (!lead) throw notFound('Lead', input.leadId);

    const [stage] = await tx
      .select({ id: leadStages.id, key: leadStages.key, stageType: leadStages.stageType, requiresLossReason: leadStages.requiresLossReason })
      .from(leadStages)
      .where(and(eq(leadStages.organizationId, actor.organizationId), eq(leadStages.key, input.stageKey)))
      .limit(1);
    if (!stage) throw notFound('Stage', input.stageKey);

    if (stage.stageType === 'lost' && !input.lossReasonId) {
      throw businessRuleViolation('BR-006', 'A loss reason is required to close a lead as lost.');
    }

    const isTerminal = stage.stageType === 'won' || stage.stageType === 'lost';
    if (!isTerminal && policy.requireNextAction && !input.nextAction) {
      throw validationError('An active lead must have a next action.', {
        field: 'nextAction',
      });
    }

    const [previousStage] = await tx
      .select({ key: leadStages.key })
      .from(leadStages)
      .where(eq(leadStages.id, lead.stageId))
      .limit(1);

    await tx
      .update(leads)
      .set({
        stageId: stage.id,
        qualification: stage.stageType === 'lost' ? 'disqualified' : undefined,
        lossReasonId: stage.stageType === 'lost' ? input.lossReasonId : null,
        lossNotes: stage.stageType === 'lost' ? input.lossNotes ?? null : null,
        closedAt: isTerminal ? new Date() : null,
        nextAction: isTerminal ? null : input.nextAction ?? null,
        nextFollowUpAt: isTerminal ? null : input.nextFollowUpAt ?? null,
        // Contacting the lead for the first time records the SLA response time.
        firstResponseAt:
          lead.firstResponseAt ?? (stage.key !== 'new_lead' ? new Date() : null),
        updatedAt: new Date(),
      })
      .where(eq(leads.id, input.leadId));

    await tx.insert(leadActivities).values({
      organizationId: actor.organizationId,
      leadId: input.leadId,
      activityType: 'stage_change',
      subject: `Stage changed to ${stage.key.replace(/_/g, ' ')}`,
      body: previousStage ? `Moved from ${previousStage.key.replace(/_/g, ' ')}.` : null,
      direction: 'internal',
      userId: actor.id,
    });

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'lead',
      entityId: input.leadId,
      entityLabel: lead.code,
      previousValue: { stage: previousStage?.key },
      newValue: { stage: stage.key },
      reason: input.lossNotes,
      actor: { id: actor.id, fullName: actor.fullName },
    });
  });
}

/** Records a follow-up activity and updates the lead's next action (BRD 26-27). */
export async function logLeadActivity(
  actor: SessionUser,
  input: {
    leadId: string;
    activityType: string;
    subject: string;
    body?: string;
    outcome?: string;
    direction?: string;
    nextAction?: string;
    nextFollowUpAt?: Date;
  },
): Promise<{ id: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [lead] = await tx
      .select({ id: leads.id, customerId: leads.customerId, firstResponseAt: leads.firstResponseAt, createdAt: leads.createdAt })
      .from(leads)
      .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, actor.organizationId)))
      .limit(1);
    if (!lead) throw notFound('Lead', input.leadId);

    const [activity] = await tx
      .insert(leadActivities)
      .values({
        organizationId: actor.organizationId,
        leadId: input.leadId,
        customerId: lead.customerId,
        activityType: input.activityType,
        subject: input.subject,
        body: input.body ?? null,
        outcome: input.outcome ?? null,
        direction: input.direction ?? 'outbound',
        nextAction: input.nextAction ?? null,
        nextFollowUpAt: input.nextFollowUpAt ?? null,
        userId: actor.id,
      })
      .returning({ id: leadActivities.id });

    // First contact sets the SLA response time.
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.nextAction) {
      patch.nextAction = input.nextAction;
      patch.nextFollowUpAt = input.nextFollowUpAt ?? null;
    }
    if (!lead.firstResponseAt && input.direction !== 'internal') {
      const now = new Date();
      patch.firstResponseAt = now;
      patch.firstResponseMinutes = Math.round((now.getTime() - lead.createdAt.getTime()) / 60_000);
    }
    await tx.update(leads).set(patch).where(eq(leads.id, input.leadId));

    return { id: activity.id };
  });
}

export async function getLeadSourcesForOrg(organizationId: string) {
  const db = await getDb();
  return db
    .select({ id: leadSources.id, name: leadSources.nameEn })
    .from(leadSources)
    .where(and(eq(leadSources.organizationId, organizationId), eq(leadSources.isActive, true)))
    .orderBy(leadSources.sortOrder);
}

export async function getAgentsForOrg(organizationId: string) {
  const db = await getDb();
  return db
    .select({ id: users.id, name: users.fullName })
    .from(users)
    .where(and(eq(users.organizationId, organizationId), eq(users.isActive, true), isNull(users.deletedAt)))
    .orderBy(users.fullName);
}
