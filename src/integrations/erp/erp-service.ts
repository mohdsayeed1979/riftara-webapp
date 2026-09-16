import 'server-only';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { erpEntityMappings, erpIntegrationEvents, organizations } from '@/db/schema';
import { recordAudit } from '@/lib/audit';
import { notFound, validationError } from '@/lib/errors';
import { notifyErpIntegrationFailure } from '@/services/notification-service';
import { DynamicsAx2012Adapter } from './adapters/dynamics-ax2012/dynamics-ax2012-adapter';
import type {
  ErpAdapter,
  ErpEntityType,
  ErpEventStatus,
  ErpEventType,
  ErpMappingStatus,
  ErpSystem,
} from './erp-types';
import type { DbExecutor } from '@/db/types';

/**
 * ERP integration outbox service (Phase 18).
 *
 * Business transactions never depend on this — a caller queues an event
 * (queueErpEvent) inside its own transaction and moves on; delivery happens
 * later via processPendingEvents, called from a manual/admin endpoint today
 * and, in production, from a dedicated worker/cron once approved (this is
 * deliberately NOT folded into the daily notification cron — see
 * docs/PHASE_18_ERP_INTEGRATION.md §21).
 */

type Actor = { id: string | null; organizationId: string; fullName: string };

const MAX_ATTEMPTS = 5;
/** Exponential backoff in minutes, capped. */
function backoffMinutes(attemptCount: number): number {
  return Math.min(60, 2 ** attemptCount);
}

const DEFAULT_ADAPTER: ErpAdapter = new DynamicsAx2012Adapter();

// ---------------------------------------------------------------------------
// Master-data mapping
// ---------------------------------------------------------------------------

export interface UpsertMappingInput {
  system: ErpSystem;
  entityType: ErpEntityType;
  localEntityId: string;
  externalEntityId?: string | null;
  status?: ErpMappingStatus;
  metadata?: Record<string, unknown>;
}

/** Idempotent: a second call for the same (org, system, entityType, localEntityId) updates the same row. */
export async function upsertMapping(actor: Actor, input: UpsertMappingInput) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(erpEntityMappings)
      .where(
        and(
          eq(erpEntityMappings.organizationId, actor.organizationId),
          eq(erpEntityMappings.system, input.system),
          eq(erpEntityMappings.entityType, input.entityType),
          eq(erpEntityMappings.localEntityId, input.localEntityId),
        ),
      )
      .limit(1);

    const status = input.status ?? (input.externalEntityId ? 'mapped' : 'pending');

    if (existing) {
      await tx
        .update(erpEntityMappings)
        .set({
          externalEntityId: input.externalEntityId ?? existing.externalEntityId,
          status,
          lastSyncedAt: input.externalEntityId ? new Date() : existing.lastSyncedAt,
          metadata: { ...existing.metadata, ...(input.metadata ?? {}) },
          updatedAt: new Date(),
        })
        .where(eq(erpEntityMappings.id, existing.id));

      await recordAudit(tx, {
        organizationId: actor.organizationId,
        action: 'update',
        entityType: 'erp_entity_mapping',
        entityId: existing.id,
        newValue: { externalEntityId: input.externalEntityId, status },
        actor: actor.id ? { id: actor.id, fullName: actor.fullName } : undefined,
      });
      return { id: existing.id, created: false };
    }

    const [created] = await tx
      .insert(erpEntityMappings)
      .values({
        organizationId: actor.organizationId,
        system: input.system,
        entityType: input.entityType,
        localEntityId: input.localEntityId,
        externalEntityId: input.externalEntityId ?? null,
        status,
        lastSyncedAt: input.externalEntityId ? new Date() : null,
        metadata: input.metadata ?? {},
      })
      .returning({ id: erpEntityMappings.id });

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'create',
      entityType: 'erp_entity_mapping',
      entityId: created.id,
      newValue: { system: input.system, entityType: input.entityType, localEntityId: input.localEntityId },
      actor: actor.id ? { id: actor.id, fullName: actor.fullName } : undefined,
    });
    return { id: created.id, created: true };
  });
}

export async function listMappings(organizationId: string, filters: { system?: ErpSystem; entityType?: ErpEntityType } = {}) {
  const db = await getDb();
  const conditions = [eq(erpEntityMappings.organizationId, organizationId)];
  if (filters.system) conditions.push(eq(erpEntityMappings.system, filters.system));
  if (filters.entityType) conditions.push(eq(erpEntityMappings.entityType, filters.entityType));
  return db.select().from(erpEntityMappings).where(and(...conditions)).orderBy(desc(erpEntityMappings.updatedAt));
}

export async function getMapping(organizationId: string, system: ErpSystem, entityType: ErpEntityType, localEntityId: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(erpEntityMappings)
    .where(
      and(
        eq(erpEntityMappings.organizationId, organizationId),
        eq(erpEntityMappings.system, system),
        eq(erpEntityMappings.entityType, entityType),
        eq(erpEntityMappings.localEntityId, localEntityId),
      ),
    )
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

export interface QueueErpEventInput {
  system?: ErpSystem;
  eventType: ErpEventType;
  entityType: ErpEntityType;
  entityId: string;
  /** Bumping this lets the same entity be re-queued for a materially different event (e.g. a correction). */
  version?: number;
  payload: Record<string, unknown>;
}

function buildIdempotencyKey(organizationId: string, input: Required<Pick<QueueErpEventInput, 'system' | 'eventType' | 'entityType' | 'entityId'>> & { version: number }): string {
  return [organizationId, input.system, input.entityType, input.entityId, input.eventType, input.version].join(':');
}

/**
 * Queues an event for later delivery. Call this from inside the SAME
 * transaction as the business mutation it represents (pass `executor`), so
 * "invoice committed" and "ERP event queued" either both happen or neither
 * does. Idempotent: the same (org, system, entityType, entityId, eventType,
 * version) tuple is enforced unique at the database level — a duplicate call
 * returns the existing row instead of erroring or double-queueing.
 */
export async function queueErpEvent(
  actor: Actor,
  input: QueueErpEventInput,
  executor?: DbExecutor,
): Promise<{ id: string; created: boolean }> {
  const db = executor ?? (await getDb());
  const system = input.system ?? 'dynamics_ax2012';
  const version = input.version ?? 1;
  const idempotencyKey = buildIdempotencyKey(actor.organizationId, { system, eventType: input.eventType, entityType: input.entityType, entityId: input.entityId, version });

  const [existing] = await db
    .select({ id: erpIntegrationEvents.id })
    .from(erpIntegrationEvents)
    .where(and(eq(erpIntegrationEvents.organizationId, actor.organizationId), eq(erpIntegrationEvents.idempotencyKey, idempotencyKey)))
    .limit(1);
  if (existing) return { id: existing.id, created: false };

  const [created] = await db
    .insert(erpIntegrationEvents)
    .values({
      organizationId: actor.organizationId,
      system,
      eventType: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId,
      idempotencyKey,
      payload: input.payload,
      status: 'pending',
    })
    .returning({ id: erpIntegrationEvents.id });

  await recordAudit(db, {
    organizationId: actor.organizationId,
    action: 'create',
    entityType: 'erp_integration_event',
    entityId: created.id,
    entityLabel: input.eventType,
    newValue: { eventType: input.eventType, entityType: input.entityType, entityId: input.entityId },
    actor: actor.id ? { id: actor.id, fullName: actor.fullName } : undefined,
  });

  return { id: created.id, created: true };
}

export interface ErpEventListFilters {
  organizationId: string;
  status?: ErpEventStatus;
  page?: number;
  pageSize?: number;
}

export async function listErpEvents(filters: ErpEventListFilters) {
  const db = await getDb();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
  const conditions = [eq(erpIntegrationEvents.organizationId, filters.organizationId)];
  if (filters.status) conditions.push(eq(erpIntegrationEvents.status, filters.status));
  const where = and(...conditions);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(erpIntegrationEvents)
      .where(where)
      .orderBy(desc(erpIntegrationEvents.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(erpIntegrationEvents).where(where),
  ]);

  return { items: rows, total: Number(total), page, pageSize };
}

export async function getErpEvent(organizationId: string, eventId: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(erpIntegrationEvents)
    .where(and(eq(erpIntegrationEvents.id, eventId), eq(erpIntegrationEvents.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export interface QueueSummary {
  pending: number;
  processing: number;
  succeeded: number;
  failed: number;
  retrying: number;
  dead_letter: number;
}

export async function getQueueSummary(organizationId: string): Promise<QueueSummary> {
  const db = await getDb();
  const rows = await db
    .select({ status: erpIntegrationEvents.status, count: sql<number>`count(*)::int` })
    .from(erpIntegrationEvents)
    .where(eq(erpIntegrationEvents.organizationId, organizationId))
    .groupBy(erpIntegrationEvents.status);

  const summary: QueueSummary = { pending: 0, processing: 0, succeeded: 0, failed: 0, retrying: 0, dead_letter: 0 };
  for (const row of rows) {
    if (row.status in summary) summary[row.status as ErpEventStatus] = Number(row.count);
  }
  return summary;
}

/**
 * Processes due events (pending, or retrying whose nextRetryAt has passed).
 * Safe to call repeatedly and concurrently is NOT assumed — this is meant to
 * be invoked by a single worker/cron/manual trigger at a time (see the API
 * route). Each event is handled independently so one failure never blocks
 * the batch.
 */
export async function processPendingEvents(actor: Actor, adapter: ErpAdapter = DEFAULT_ADAPTER, limit = 25): Promise<{ processed: number; succeeded: number; failed: number }> {
  const db = await getDb();
  const now = new Date();
  const due = await db
    .select()
    .from(erpIntegrationEvents)
    .where(
      and(
        eq(erpIntegrationEvents.organizationId, actor.organizationId),
        sql`(${erpIntegrationEvents.status} = 'pending' or (${erpIntegrationEvents.status} = 'retrying' and (${erpIntegrationEvents.nextRetryAt} is null or ${erpIntegrationEvents.nextRetryAt} <= ${now})))`,
      ),
    )
    .orderBy(asc(erpIntegrationEvents.createdAt))
    .limit(limit);

  let succeeded = 0;
  let failed = 0;

  for (const event of due) {
    await db.update(erpIntegrationEvents).set({ status: 'processing', lastAttemptAt: now, updatedAt: new Date() }).where(eq(erpIntegrationEvents.id, event.id));

    const result = await adapter.send({
      organizationId: actor.organizationId,
      system: event.system as ErpSystem,
      eventType: event.eventType as ErpEventType,
      entityType: event.entityType as ErpEntityType,
      entityId: event.entityId,
      idempotencyKey: event.idempotencyKey,
      payload: event.payload,
    });

    const attemptCount = event.attemptCount + 1;

    if (result.outcome === 'success') {
      await db
        .update(erpIntegrationEvents)
        .set({
          status: 'succeeded',
          attemptCount,
          externalReference: result.externalReference ?? null,
          responseMetadata: result.responseMetadata ?? null,
          errorCode: null,
          errorMessage: null,
          nextRetryAt: null,
          updatedAt: new Date(),
        })
        .where(eq(erpIntegrationEvents.id, event.id));
      await recordAudit(db, {
        organizationId: actor.organizationId,
        action: 'update',
        entityType: 'erp_integration_event',
        entityId: event.id,
        newValue: { status: 'succeeded', externalReference: result.externalReference },
        actor: actor.id ? { id: actor.id, fullName: actor.fullName } : undefined,
      });
      succeeded += 1;
      continue;
    }

    // validation_error is a data problem, not a transport problem — never retried.
    // permanent_error means the ERP definitively rejected it — also never retried.
    // transient_error is retried with backoff up to MAX_ATTEMPTS.
    const terminal = result.outcome === 'validation_error' || result.outcome === 'permanent_error' || attemptCount >= MAX_ATTEMPTS;
    const nextStatus: ErpEventStatus = result.outcome === 'validation_error' ? 'failed' : terminal ? 'dead_letter' : 'retrying';
    const nextRetryAt = nextStatus === 'retrying' ? new Date(Date.now() + backoffMinutes(attemptCount) * 60_000) : null;

    await db
      .update(erpIntegrationEvents)
      .set({
        status: nextStatus,
        attemptCount,
        errorCode: result.errorCode ?? null,
        errorMessage: result.errorMessage ?? null,
        responseMetadata: result.responseMetadata ?? null,
        nextRetryAt,
        updatedAt: new Date(),
      })
      .where(eq(erpIntegrationEvents.id, event.id));

    await recordAudit(db, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'erp_integration_event',
      entityId: event.id,
      newValue: { status: nextStatus, errorCode: result.errorCode },
      reason: result.errorMessage,
      actor: actor.id ? { id: actor.id, fullName: actor.fullName } : undefined,
    });

    if (nextStatus === 'dead_letter' || nextStatus === 'failed') {
      await notifyErpIntegrationFailure(actor.organizationId, event.id, event.eventType, result.errorMessage ?? 'Integration event failed.');
    }

    failed += 1;
  }

  return { processed: due.length, succeeded, failed };
}

/** Manually re-queues one event (operator action from the UI/API). Not for validation errors — those need a corrected payload, not a retry. */
export async function retryEvent(actor: Actor, eventId: string): Promise<void> {
  const db = await getDb();
  const [event] = await db
    .select()
    .from(erpIntegrationEvents)
    .where(and(eq(erpIntegrationEvents.id, eventId), eq(erpIntegrationEvents.organizationId, actor.organizationId)))
    .limit(1);
  if (!event) throw notFound('ERP integration event', eventId);
  if (event.status === 'succeeded') throw validationError('This event has already succeeded.');
  if (event.status === 'failed') throw validationError('This event failed validation and cannot be retried as-is; it needs a corrected payload.');

  await db
    .update(erpIntegrationEvents)
    .set({ status: 'pending', nextRetryAt: null, updatedAt: new Date() })
    .where(eq(erpIntegrationEvents.id, eventId));

  await recordAudit(db, {
    organizationId: actor.organizationId,
    action: 'update',
    entityType: 'erp_integration_event',
    entityId: eventId,
    newValue: { status: 'pending' },
    reason: 'Manual retry requested.',
    actor: actor.id ? { id: actor.id, fullName: actor.fullName } : undefined,
  });
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export interface ReconciliationReport {
  totalEvents: number;
  sent: number; // succeeded + failed + dead_letter (an attempt was actually made)
  accepted: number; // succeeded
  rejected: number; // failed (validation) + dead_letter (permanent)
  unmatched: number; // pending + processing + retrying — nothing conclusive yet
  byEventType: Array<{ eventType: string; succeeded: number; failed: number; pending: number }>;
}

/** Reads the outbox's own recorded state — never invents an AX-side result. */
export async function reconcile(actor: Actor): Promise<ReconciliationReport> {
  const db = await getDb();
  const rows = await db
    .select({ eventType: erpIntegrationEvents.eventType, status: erpIntegrationEvents.status, count: sql<number>`count(*)::int` })
    .from(erpIntegrationEvents)
    .where(eq(erpIntegrationEvents.organizationId, actor.organizationId))
    .groupBy(erpIntegrationEvents.eventType, erpIntegrationEvents.status);

  let sent = 0;
  let accepted = 0;
  let rejected = 0;
  let unmatched = 0;
  const byType = new Map<string, { succeeded: number; failed: number; pending: number }>();

  for (const row of rows) {
    const count = Number(row.count);
    const entry = byType.get(row.eventType) ?? { succeeded: 0, failed: 0, pending: 0 };
    if (row.status === 'succeeded') {
      accepted += count;
      sent += count;
      entry.succeeded += count;
    } else if (row.status === 'failed' || row.status === 'dead_letter') {
      rejected += count;
      sent += count;
      entry.failed += count;
    } else {
      unmatched += count;
      entry.pending += count;
    }
    byType.set(row.eventType, entry);
  }

  const totalEvents = sent + unmatched;

  await recordAudit(db, {
    organizationId: actor.organizationId,
    action: 'export',
    entityType: 'erp_reconciliation',
    entityLabel: 'dynamics_ax2012',
    newValue: { totalEvents, sent, accepted, rejected, unmatched },
    actor: actor.id ? { id: actor.id, fullName: actor.fullName } : undefined,
  });

  return {
    totalEvents,
    sent,
    accepted,
    rejected,
    unmatched,
    byEventType: Array.from(byType.entries()).map(([eventType, v]) => ({ eventType, ...v })),
  };
}

/** Processes due events for every organization. Used by the scheduled cron job (see /api/cron/erp),
 *  which has no principal/organization context; each organization is processed with a system actor. */
export async function processPendingEventsForAllOrganizations(): Promise<{ organizations: number; processed: number; succeeded: number; failed: number }> {
  const db = await getDb();
  const orgs = await db.select({ id: organizations.id }).from(organizations).where(isNull(organizations.deletedAt));

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  for (const org of orgs) {
    const result = await processPendingEvents({ id: null, organizationId: org.id, fullName: 'Automation' });
    processed += result.processed;
    succeeded += result.succeeded;
    failed += result.failed;
  }
  return { organizations: orgs.length, processed, succeeded, failed };
}
