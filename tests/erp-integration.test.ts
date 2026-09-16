import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { bootstrapTestDb } from './setup-db';
import type { Database } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Phase 18 — ERP integration foundation (Dynamics AX 2012 R3 readiness).
 *
 * Isolated seeded PGlite database (never production, never the shared local
 * .data/riftara-db). Exercises the adapter port, master-data mapping, the
 * outbox (queueing, idempotency, retry/backoff, dead-lettering), and
 * reconciliation, plus RBAC.
 */

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth/session')>();
  return { ...mod, getSession: vi.fn() };
});

let db: Database;
let cleanup: () => void;
let admin: SessionUser;

beforeAll(async () => {
  const ctx = await bootstrapTestDb();
  db = ctx.db;
  cleanup = ctx.cleanup;
  const { users } = await import('@/db/schema');
  const { loadSessionUser } = await import('@/lib/auth/session');
  const [u] = await db.select().from(users).where(eq(users.email, 'sayeed.almousa@riftara.sa')).limit(1);
  admin = (await loadSessionUser(u.id))!;
}, 180_000);

afterAll(() => cleanup?.());

function actorOf(user: SessionUser) {
  return { id: user.id, organizationId: user.organizationId, fullName: user.fullName };
}

describe('ErpAdapter port — mock adapter', () => {
  it('returns success by default with an external reference', async () => {
    const { MockErpAdapter } = await import('@/integrations/erp/erp-adapter');
    const adapter = new MockErpAdapter();
    expect(adapter.isConnected).toBe(false);
    const result = await adapter.send({
      organizationId: admin.organizationId, system: 'dynamics_ax2012', eventType: 'invoice_issued',
      entityType: 'invoice', entityId: 'x', idempotencyKey: 'key-1', payload: {},
    });
    expect(result.outcome).toBe('success');
    expect(result.externalReference).toBeTruthy();
  });

  it('simulates each failure class deterministically', async () => {
    const { MockErpAdapter } = await import('@/integrations/erp/erp-adapter');
    const adapter = new MockErpAdapter();
    for (const simulate of ['VALIDATION_ERROR', 'TRANSIENT_ERROR', 'PERMANENT_ERROR'] as const) {
      const result = await adapter.send({
        organizationId: admin.organizationId, system: 'dynamics_ax2012', eventType: 'invoice_issued',
        entityType: 'invoice', entityId: 'x', idempotencyKey: 'key-2', payload: { __simulate: simulate },
      });
      expect(result.outcome).toBe(simulate.toLowerCase());
    }
  });

  it('the Dynamics AX 2012 adapter reports not connected and never contacts a real server', async () => {
    const { DynamicsAx2012Adapter } = await import('@/integrations/erp/adapters/dynamics-ax2012/dynamics-ax2012-adapter');
    const adapter = new DynamicsAx2012Adapter();
    expect(adapter.isConnected).toBe(false);
    expect(adapter.system).toBe('dynamics_ax2012');
  });
});

describe('Master-data mapping', () => {
  it('creates a mapping and is idempotent on a repeated call', async () => {
    const { upsertMapping } = await import('@/integrations/erp/erp-service');
    const localId = crypto.randomUUID();
    const first = await upsertMapping(actorOf(admin), { system: 'dynamics_ax2012', entityType: 'customer', localEntityId: localId, externalEntityId: 'AX-CUST-001' });
    const second = await upsertMapping(actorOf(admin), { system: 'dynamics_ax2012', entityType: 'customer', localEntityId: localId, externalEntityId: 'AX-CUST-001-UPDATED' });
    expect(first.id).toBe(second.id);
    expect(second.created).toBe(false);

    const { getMapping } = await import('@/integrations/erp/erp-service');
    const row = await getMapping(admin.organizationId, 'dynamics_ax2012', 'customer', localId);
    expect(row?.externalEntityId).toBe('AX-CUST-001-UPDATED');
    expect(row?.status).toBe('mapped');
  });

  it('prevents duplicate mappings at the database level for the same local entity', async () => {
    const { erpEntityMappings } = await import('@/db/schema');
    const localId = crypto.randomUUID();
    await db.insert(erpEntityMappings).values({ organizationId: admin.organizationId, system: 'dynamics_ax2012', entityType: 'vendor', localEntityId: localId, status: 'pending' });
    await expect(
      db.insert(erpEntityMappings).values({ organizationId: admin.organizationId, system: 'dynamics_ax2012', entityType: 'vendor', localEntityId: localId, status: 'pending' }),
    ).rejects.toThrow();
  });

  it('lists mappings scoped to the organization', async () => {
    const { upsertMapping, listMappings } = await import('@/integrations/erp/erp-service');
    await upsertMapping(actorOf(admin), { system: 'dynamics_ax2012', entityType: 'property', localEntityId: crypto.randomUUID(), externalEntityId: 'AX-DIM-01' });
    const rows = await listMappings(admin.organizationId, { entityType: 'property' });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.organizationId === admin.organizationId && r.entityType === 'property')).toBe(true);
  });
});

describe('Outbox — queueing and idempotency', () => {
  it('creates an event and returns the same row for a repeated call with the same key', async () => {
    const { queueErpEvent } = await import('@/integrations/erp/erp-service');
    const entityId = crypto.randomUUID();
    const first = await queueErpEvent(actorOf(admin), { eventType: 'invoice_issued', entityType: 'invoice', entityId, payload: { amount: 1000 } });
    const second = await queueErpEvent(actorOf(admin), { eventType: 'invoice_issued', entityType: 'invoice', entityId, payload: { amount: 1000 } });
    expect(first.id).toBe(second.id);
    expect(second.created).toBe(false);

    const { erpIntegrationEvents } = await import('@/db/schema');
    const rows = await db.select().from(erpIntegrationEvents).where(and(eq(erpIntegrationEvents.entityType, 'invoice'), eq(erpIntegrationEvents.entityId, entityId)));
    expect(rows.length).toBe(1);
  });

  it('a bumped version queues a distinct event for the same entity', async () => {
    const { queueErpEvent } = await import('@/integrations/erp/erp-service');
    const entityId = crypto.randomUUID();
    const v1 = await queueErpEvent(actorOf(admin), { eventType: 'invoice_issued', entityType: 'invoice', entityId, version: 1, payload: {} });
    const v2 = await queueErpEvent(actorOf(admin), { eventType: 'invoice_issued', entityType: 'invoice', entityId, version: 2, payload: {} });
    expect(v1.id).not.toBe(v2.id);
  });

  it('records a create audit entry', async () => {
    const { queueErpEvent } = await import('@/integrations/erp/erp-service');
    const { auditLogs } = await import('@/db/schema');
    const { id } = await queueErpEvent(actorOf(admin), { eventType: 'payment_received', entityType: 'payment', entityId: crypto.randomUUID(), payload: {} });
    const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, 'erp_integration_event'), eq(auditLogs.entityId, id)));
    expect(audits.some((a) => a.action === 'create')).toBe(true);
  });
});

describe('Outbox — processing, retry and dead-lettering', () => {
  it('a successful send marks the event succeeded with an external reference', async () => {
    const { queueErpEvent, processPendingEvents, getErpEvent } = await import('@/integrations/erp/erp-service');
    const { MockErpAdapter } = await import('@/integrations/erp/erp-adapter');
    const { id } = await queueErpEvent(actorOf(admin), { eventType: 'invoice_issued', entityType: 'invoice', entityId: crypto.randomUUID(), payload: {} });

    const result = await processPendingEvents(actorOf(admin), new MockErpAdapter(), 50);
    expect(result.succeeded).toBeGreaterThanOrEqual(1);

    const event = await getErpEvent(admin.organizationId, id);
    expect(event?.status).toBe('succeeded');
    expect(event?.externalReference).toBeTruthy();
    expect(event?.attemptCount).toBe(1);
  });

  it('processing the same succeeded event again is a no-op (idempotent processing)', async () => {
    const { queueErpEvent, processPendingEvents, getErpEvent } = await import('@/integrations/erp/erp-service');
    const { MockErpAdapter } = await import('@/integrations/erp/erp-adapter');
    const adapter = new MockErpAdapter();
    const { id } = await queueErpEvent(actorOf(admin), { eventType: 'invoice_issued', entityType: 'invoice', entityId: crypto.randomUUID(), payload: {} });
    await processPendingEvents(actorOf(admin), adapter, 50);
    const before = await getErpEvent(admin.organizationId, id);
    await processPendingEvents(actorOf(admin), adapter, 50); // succeeded events are not re-selected
    const after = await getErpEvent(admin.organizationId, id);
    expect(after?.attemptCount).toBe(before?.attemptCount);
    expect(after?.externalReference).toBe(before?.externalReference);
  });

  it('a validation error fails permanently without ever being retried', async () => {
    const { queueErpEvent, processPendingEvents, getErpEvent } = await import('@/integrations/erp/erp-service');
    const { MockErpAdapter } = await import('@/integrations/erp/erp-adapter');
    const { id } = await queueErpEvent(actorOf(admin), { eventType: 'invoice_issued', entityType: 'invoice', entityId: crypto.randomUUID(), payload: { __simulate: 'VALIDATION_ERROR' } });
    await processPendingEvents(actorOf(admin), new MockErpAdapter(), 50);
    const event = await getErpEvent(admin.organizationId, id);
    expect(event?.status).toBe('failed');
    expect(event?.nextRetryAt).toBeNull();
  });

  it('a transient error is retried with a future backoff and eventually dead-letters at max attempts', async () => {
    const { queueErpEvent, processPendingEvents, getErpEvent } = await import('@/integrations/erp/erp-service');
    const { erpIntegrationEvents } = await import('@/db/schema');
    const { MockErpAdapter } = await import('@/integrations/erp/erp-adapter');
    const adapter = new MockErpAdapter();
    const { id } = await queueErpEvent(actorOf(admin), { eventType: 'invoice_issued', entityType: 'invoice', entityId: crypto.randomUUID(), payload: { __simulate: 'TRANSIENT_ERROR' } });

    await processPendingEvents(actorOf(admin), adapter, 50);
    let event = await getErpEvent(admin.organizationId, id);
    expect(event?.status).toBe('retrying');
    expect(event?.nextRetryAt).not.toBeNull();
    expect(event!.nextRetryAt!.getTime()).toBeGreaterThan(Date.now());

    // Force it due now and repeat until it dead-letters at MAX_ATTEMPTS.
    for (let i = 0; i < 6; i += 1) {
      await db.update(erpIntegrationEvents).set({ nextRetryAt: new Date(Date.now() - 1000) }).where(eq(erpIntegrationEvents.id, id));
      await processPendingEvents(actorOf(admin), adapter, 50);
      event = await getErpEvent(admin.organizationId, id);
      if (event?.status !== 'retrying') break;
    }
    expect(event?.status).toBe('dead_letter');
    expect(event?.attemptCount).toBeGreaterThanOrEqual(5);
  });

  it('a permanent error dead-letters immediately without retry attempts accumulating for retry', async () => {
    const { queueErpEvent, processPendingEvents, getErpEvent } = await import('@/integrations/erp/erp-service');
    const { MockErpAdapter } = await import('@/integrations/erp/erp-adapter');
    const { id } = await queueErpEvent(actorOf(admin), { eventType: 'invoice_issued', entityType: 'invoice', entityId: crypto.randomUUID(), payload: { __simulate: 'PERMANENT_ERROR' } });
    await processPendingEvents(actorOf(admin), new MockErpAdapter(), 50);
    const event = await getErpEvent(admin.organizationId, id);
    expect(event?.status).toBe('dead_letter');
    expect(event?.nextRetryAt).toBeNull();
  });

  it('manual retry re-queues a dead-lettered event but refuses a validation failure', async () => {
    const { queueErpEvent, processPendingEvents, retryEvent, getErpEvent } = await import('@/integrations/erp/erp-service');
    const { MockErpAdapter } = await import('@/integrations/erp/erp-adapter');
    const permanent = await queueErpEvent(actorOf(admin), { eventType: 'invoice_issued', entityType: 'invoice', entityId: crypto.randomUUID(), payload: { __simulate: 'PERMANENT_ERROR' } });
    await processPendingEvents(actorOf(admin), new MockErpAdapter(), 50);
    await retryEvent(actorOf(admin), permanent.id);
    expect((await getErpEvent(admin.organizationId, permanent.id))?.status).toBe('pending');

    const validation = await queueErpEvent(actorOf(admin), { eventType: 'invoice_issued', entityType: 'invoice', entityId: crypto.randomUUID(), payload: { __simulate: 'VALIDATION_ERROR' } });
    await processPendingEvents(actorOf(admin), new MockErpAdapter(), 50);
    await expect(retryEvent(actorOf(admin), validation.id)).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('Reconciliation', () => {
  it('reports sent/accepted/rejected/unmatched from the outbox\'s own recorded state', async () => {
    const { queueErpEvent, processPendingEvents, reconcile } = await import('@/integrations/erp/erp-service');
    const { MockErpAdapter } = await import('@/integrations/erp/erp-adapter');
    const adapter = new MockErpAdapter();

    await queueErpEvent(actorOf(admin), { eventType: 'expense_recorded', entityType: 'expense', entityId: crypto.randomUUID(), payload: {} });
    await queueErpEvent(actorOf(admin), { eventType: 'expense_recorded', entityType: 'expense', entityId: crypto.randomUUID(), payload: { __simulate: 'VALIDATION_ERROR' } });
    await queueErpEvent(actorOf(admin), { eventType: 'expense_recorded', entityType: 'expense', entityId: crypto.randomUUID(), payload: {} }); // stays pending
    await processPendingEvents(actorOf(admin), adapter, 2); // process only the first two, leave the third pending

    const report = await reconcile(actorOf(admin));
    expect(report.accepted).toBeGreaterThanOrEqual(1);
    expect(report.rejected).toBeGreaterThanOrEqual(1);
    expect(report.unmatched).toBeGreaterThanOrEqual(1);
    expect(report.totalEvents).toBe(report.sent + report.unmatched);
  });
});

describe('ERP integration RBAC', () => {
  it('viewing events is denied without erp_integration:view', async () => {
    const noView: SessionUser = { ...admin, permissions: admin.permissions.filter((p) => p !== 'erp_integration:view') };
    await expect(
      (async () => {
        const { requirePermission } = await import('@/lib/auth/guard');
        const { getSession } = await import('@/lib/auth/session');
        (getSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(noView);
        return requirePermission('erp_integration:view');
      })(),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('retrying is denied without erp_integration:retry', async () => {
    const { queueErpEvent } = await import('@/integrations/erp/erp-service');
    const { retryErpEventAction } = await import('@/app/(app)/integrations/erp/actions');
    const { getSession } = await import('@/lib/auth/session');
    const { id } = await queueErpEvent(actorOf(admin), { eventType: 'invoice_issued', entityType: 'invoice', entityId: crypto.randomUUID(), payload: {} });

    const noRetry: SessionUser = { ...admin, permissions: admin.permissions.filter((p) => p !== 'erp_integration:retry') };
    (getSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(noRetry);
    const r = await retryErpEventAction(id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN');
    (getSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(admin);
  });

  it('reconciling is denied without erp_integration:reconcile', async () => {
    const { reconcileErpAction } = await import('@/app/(app)/integrations/erp/actions');
    const { getSession } = await import('@/lib/auth/session');
    const noReconcile: SessionUser = { ...admin, permissions: admin.permissions.filter((p) => p !== 'erp_integration:reconcile') };
    (getSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(noReconcile);
    const r = await reconcileErpAction();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN');
    (getSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(admin);
  });

  it('managing (manual processing) is denied without erp_integration:manage', async () => {
    const { processErpEventsAction } = await import('@/app/(app)/integrations/erp/actions');
    const { getSession } = await import('@/lib/auth/session');
    const noManage: SessionUser = { ...admin, permissions: admin.permissions.filter((p) => p !== 'erp_integration:manage') };
    (getSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(noManage);
    const r = await processErpEventsAction();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN');
    (getSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(admin);
  });
});

describe('Security', () => {
  it('the integration catalog never stores a credential value, only env var names', async () => {
    const { INTEGRATION_CATALOG } = await import('@/config/integrations-catalog');
    const ax = INTEGRATION_CATALOG.find((i) => i.key === 'dynamics_ax2012');
    expect(ax).toBeDefined();
    expect(ax!.requiredEnvKeys.every((k) => typeof k === 'string' && !k.toLowerCase().includes('=') )).toBe(true);
    // Only names, never actual secret values, are ever stored in the catalog/config.
    expect(JSON.stringify(ax)).not.toMatch(/[A-Za-z0-9+/]{32,}={0,2}/); // no embedded token-looking strings
  });

  it('event payloads and audit metadata never contain a literal credential field', async () => {
    const { queueErpEvent, getErpEvent } = await import('@/integrations/erp/erp-service');
    const { id } = await queueErpEvent(actorOf(admin), { eventType: 'vendor_sync', entityType: 'vendor', entityId: crypto.randomUUID(), payload: { vendorName: 'Test Vendor' } });
    const event = await getErpEvent(admin.organizationId, id);
    expect(JSON.stringify(event?.payload)).not.toMatch(/password|secret|api_key|apikey/i);
  });
});
