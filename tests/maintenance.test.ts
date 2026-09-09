import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { bootstrapTestDb } from './setup-db';
import type { Database } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';
import { isUuid } from '@/lib/utils';

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth/session')>();
  return { ...mod, getSession: vi.fn() };
});

const FOREIGN_ORG = '00000000-0000-4000-8000-000000000000';

let db: Database;
let cleanup: () => void;
let admin: SessionUser;
let getSessionMock: ReturnType<typeof vi.fn>;
let propertyId = '';
let unitId = '';
let vendorId = '';
let categoryId = '';

beforeAll(async () => {
  const ctx = await bootstrapTestDb();
  db = ctx.db;
  cleanup = ctx.cleanup;

  const { users, properties, units, vendors, maintenanceCategories } = await import('@/db/schema');
  const { loadSessionUser, getSession } = await import('@/lib/auth/session');
  getSessionMock = getSession as unknown as ReturnType<typeof vi.fn>;

  const [u] = await db.select().from(users).where(eq(users.email, 'sayeed.almousa@riftara.sa')).limit(1);
  const loaded = await loadSessionUser(u.id);
  if (!loaded) throw new Error('admin actor not found');
  admin = loaded;

  const [prop] = await db.select({ id: properties.id }).from(properties).where(isNull(properties.deletedAt)).limit(1);
  propertyId = prop.id;
  const [unit] = await db.select({ id: units.id }).from(units).where(and(eq(units.propertyId, propertyId), isNull(units.deletedAt))).limit(1);
  unitId = unit.id;
  const [vendor] = await db.select({ id: vendors.id }).from(vendors).where(eq(vendors.organizationId, admin.organizationId)).limit(1);
  vendorId = vendor.id;
  const [cat] = await db.select({ id: maintenanceCategories.id }).from(maintenanceCategories).where(eq(maintenanceCategories.organizationId, admin.organizationId)).limit(1);
  categoryId = cat.id;
}, 180_000);

afterAll(() => cleanup?.());

async function makeWorkOrder(overrides: Record<string, unknown> = {}) {
  const { createWorkOrder } = await import('@/services/maintenance-service');
  return createWorkOrder(admin, {
    title: 'Test WO',
    maintenanceType: 'corrective',
    propertyId,
    priority: 'medium',
    ...overrides,
  } as Parameters<typeof createWorkOrder>[1]);
}

/* -------------------------------------------------------------------------- */
describe('Work order creation & edit', () => {
  it('creates a work order scoped to the organization with an audit entry', async () => {
    const { workOrders, auditLogs } = await import('@/db/schema');
    const created = await makeWorkOrder({ title: 'Leaking tap', unitId, categoryId });
    expect(created.code).toMatch(/^WO-/);
    const [row] = await db.select({ organizationId: workOrders.organizationId, status: workOrders.status }).from(workOrders).where(eq(workOrders.id, created.id));
    expect(row.organizationId).toBe(admin.organizationId);
    expect(row.status).toBe('open');
    const audit = await db.select({ action: auditLogs.action }).from(auditLogs).where(and(eq(auditLogs.entityType, 'work_order'), eq(auditLogs.entityId, created.id)));
    expect(audit.some((a) => a.action === 'create')).toBe(true);
  });

  it('rejects a work order for a property in another organization', async () => {
    const { createWorkOrder } = await import('@/services/maintenance-service');
    await expect(createWorkOrder({ ...admin, organizationId: FOREIGN_ORG }, { title: 'X', maintenanceType: 'corrective', propertyId, priority: 'low' })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('edits editable fields and refuses editing a closed order', async () => {
    const { updateWorkOrder, transitionWorkOrderStatus } = await import('@/services/maintenance-service');
    const { workOrders } = await import('@/db/schema');
    const wo = await makeWorkOrder({ title: 'Editable' });
    await updateWorkOrder(admin, wo.id, { title: 'Edited title', maintenanceType: 'inspection', priority: 'high' });
    const [row] = await db.select({ title: workOrders.title, priority: workOrders.priority }).from(workOrders).where(eq(workOrders.id, wo.id));
    expect(row.title).toBe('Edited title');
    expect(row.priority).toBe('high');
    // Close it, then editing must be rejected.
    await transitionWorkOrderStatus(admin, wo.id, 'cancelled');
    await expect(updateWorkOrder(admin, wo.id, { title: 'Nope', maintenanceType: 'inspection', priority: 'low' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('denies creation without maintenance:create (RBAC) and rejects invalid UUID', async () => {
    const { createWorkOrderAction, updateWorkOrderAction } = await import('@/app/(app)/maintenance/actions');
    getSessionMock.mockResolvedValue({ ...admin, permissions: [] });
    const fd = new FormData();
    fd.set('title', 'Blocked'); fd.set('maintenanceType', 'corrective'); fd.set('propertyId', propertyId); fd.set('priority', 'low');
    const denied = await createWorkOrderAction(null, fd);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN');
    const bad = await updateWorkOrderAction('not-a-uuid', null, new FormData());
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('NOT_FOUND');
    expect(isUuid('not-a-uuid')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
describe('Assignment', () => {
  it('assigns a vendor and internal user and moves an open order to assigned', async () => {
    const { assignWorkOrder } = await import('@/services/maintenance-service');
    const { workOrders } = await import('@/db/schema');
    const wo = await makeWorkOrder({ title: 'To assign' });
    const result = await assignWorkOrder(admin, wo.id, { vendorId, assignedUserId: admin.id });
    expect(result.status).toBe('assigned');
    const [row] = await db.select({ vendorId: workOrders.vendorId, assignedUserId: workOrders.assignedUserId, respondedAt: workOrders.respondedAt }).from(workOrders).where(eq(workOrders.id, wo.id));
    expect(row.vendorId).toBe(vendorId);
    expect(row.assignedUserId).toBe(admin.id);
    expect(row.respondedAt).not.toBeNull();
  });

  it('rejects a vendor or user that does not belong to the organization', async () => {
    const { assignWorkOrder } = await import('@/services/maintenance-service');
    const wo = await makeWorkOrder({ title: 'Cross-org assign' });
    await expect(assignWorkOrder(admin, wo.id, { vendorId: FOREIGN_ORG })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(assignWorkOrder(admin, wo.id, { assignedUserId: FOREIGN_ORG })).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

/* -------------------------------------------------------------------------- */
describe('Status workflow', () => {
  it('allows a valid lifecycle and stamps SLA flags on completion', async () => {
    const { transitionWorkOrderStatus } = await import('@/services/maintenance-service');
    const { workOrders } = await import('@/db/schema');
    const wo = await makeWorkOrder({ title: 'Lifecycle' });
    await transitionWorkOrderStatus(admin, wo.id, 'in_progress');
    await transitionWorkOrderStatus(admin, wo.id, 'pending');
    const final = await transitionWorkOrderStatus(admin, wo.id, 'completed');
    expect(final.status).toBe('completed');
    const [row] = await db.select({ completedAt: workOrders.completedAt, respondedAt: workOrders.respondedAt, resolutionSlaMet: workOrders.resolutionSlaMet }).from(workOrders).where(eq(workOrders.id, wo.id));
    expect(row.completedAt).not.toBeNull();
    expect(row.respondedAt).not.toBeNull();
    expect(row.resolutionSlaMet).not.toBeNull();
  });

  it('rejects an invalid status jump', async () => {
    const { transitionWorkOrderStatus } = await import('@/services/maintenance-service');
    const wo = await makeWorkOrder({ title: 'No jump' });
    await expect(transitionWorkOrderStatus(admin, wo.id, 'completed')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('audits every transition', async () => {
    const { transitionWorkOrderStatus } = await import('@/services/maintenance-service');
    const { auditLogs } = await import('@/db/schema');
    const wo = await makeWorkOrder({ title: 'Audited' });
    await transitionWorkOrderStatus(admin, wo.id, 'in_progress');
    const audit = await db.select({ action: auditLogs.action, newValue: auditLogs.newValue }).from(auditLogs).where(and(eq(auditLogs.entityType, 'work_order'), eq(auditLogs.entityId, wo.id)));
    expect(audit.some((a) => a.action === 'update')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
describe('Cost recording, OPEX rollup & spend approval', () => {
  it('records a cost, updates actual cost and rolls up into OPEX (BR-014)', async () => {
    const { recordMaintenanceCost, getWorkOrderDetail } = await import('@/services/maintenance-service');
    const { getMaintenanceSummary, scopeFromSession } = await import('@/services/metrics-service');
    const wo = await makeWorkOrder({ title: 'Cost WO', unitId });
    const before = await getMaintenanceSummary(scopeFromSession(admin));
    await recordMaintenanceCost(admin, { workOrderId: wo.id, amount: 1200, description: 'Parts', incurredOn: new Date().toISOString().slice(0, 10) });
    const detail = await getWorkOrderDetail(admin.organizationId, wo.id);
    expect(detail!.workOrder.actualCost).toBe(1200);
    expect(detail!.costs.length).toBe(1);
    const after = await getMaintenanceSummary(scopeFromSession(admin));
    expect(after.totalCost).toBeGreaterThanOrEqual(before.totalCost + 1200 - 0.01);
  });

  it('blocks a non-approver from recording a cost at/above the approval threshold', async () => {
    const { recordMaintenanceCost } = await import('@/services/maintenance-service');
    const { getPolicy } = await import('@/lib/settings');
    const policy = await getPolicy(admin.organizationId);
    const big = policy.maintenanceSpendApprovalThreshold + 1000;
    const wo = await makeWorkOrder({ title: 'Big cost' });
    const nonApprover = { ...admin, permissions: admin.permissions.filter((p) => p !== 'maintenance:approve') };
    await expect(recordMaintenanceCost(nonApprover, { workOrderId: wo.id, amount: big, description: 'Overhaul', incurredOn: '2025-06-01' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // An approver may record it.
    const ok = await recordMaintenanceCost(admin, { workOrderId: wo.id, amount: big, description: 'Overhaul', incurredOn: '2025-06-01' });
    expect(ok.id).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
describe('Preventive maintenance generation', () => {
  it('generates a work order from a schedule and prevents duplicates', async () => {
    const { generateWorkOrderFromPreventive } = await import('@/services/maintenance-service');
    const { preventiveMaintenanceSchedules } = await import('@/db/schema');
    const [schedule] = await db.select({ id: preventiveMaintenanceSchedules.id }).from(preventiveMaintenanceSchedules).where(eq(preventiveMaintenanceSchedules.organizationId, admin.organizationId)).limit(1);
    const first = await generateWorkOrderFromPreventive(admin, schedule.id);
    expect(first.alreadyExisted).toBe(false);
    expect(first.code).toMatch(/^WO-/);
    const second = await generateWorkOrderFromPreventive(admin, schedule.id);
    expect(second.alreadyExisted).toBe(true);
    expect(second.id).toBe(first.id);
  });

  it('rejects a schedule from another organization', async () => {
    const { generateWorkOrderFromPreventive } = await import('@/services/maintenance-service');
    const { preventiveMaintenanceSchedules } = await import('@/db/schema');
    const [schedule] = await db.select({ id: preventiveMaintenanceSchedules.id }).from(preventiveMaintenanceSchedules).where(eq(preventiveMaintenanceSchedules.organizationId, admin.organizationId)).limit(1);
    await expect(generateWorkOrderFromPreventive({ ...admin, organizationId: FOREIGN_ORG }, schedule.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

/* -------------------------------------------------------------------------- */
describe('SLA calculation & breach notifications', () => {
  it('computes SLA state (on track vs breached)', async () => {
    const { workOrderSlaState } = await import('@/services/maintenance-service');
    const onTrack = workOrderSlaState({ createdAt: new Date(), resolutionSlaHours: 72, status: 'in_progress', resolutionSlaMet: null });
    expect(onTrack.breached).toBe(false);
    const breached = workOrderSlaState({ createdAt: new Date(Date.now() - 1000 * 3600 * 100), resolutionSlaHours: 24, status: 'in_progress', resolutionSlaMet: null });
    expect(breached.breached).toBe(true);
  });

  it('creates one SLA-breach notification per breached order (idempotent, org-scoped)', async () => {
    const { generateSlaBreachNotifications } = await import('@/services/maintenance-service');
    const { workOrders, notifications } = await import('@/db/schema');
    const wo = await makeWorkOrder({ title: 'Breacher' });
    await db.update(workOrders).set({ createdAt: new Date(Date.now() - 1000 * 3600 * 24 * 10), resolutionSlaHours: 24 }).where(eq(workOrders.id, wo.id));

    const first = await generateSlaBreachNotifications({ organizationId: admin.organizationId });
    expect(first.notificationsCreated).toBeGreaterThan(0);
    const created = await db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.organizationId, admin.organizationId), eq(notifications.notificationType, 'maintenance_sla_breach'), eq(notifications.entityId, wo.id)));
    expect(created.length).toBe(1);

    await generateSlaBreachNotifications({ organizationId: admin.organizationId });
    const after = await db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.organizationId, admin.organizationId), eq(notifications.notificationType, 'maintenance_sla_breach'), eq(notifications.entityId, wo.id)));
    expect(after.length).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
describe('Organization isolation & detail', () => {
  it('does not expose a work order to another organization', async () => {
    const { getWorkOrderDetail, transitionWorkOrderStatus } = await import('@/services/maintenance-service');
    const wo = await makeWorkOrder({ title: 'Isolated' });
    expect(await getWorkOrderDetail(FOREIGN_ORG, wo.id)).toBeNull();
    await expect(transitionWorkOrderStatus({ ...admin, organizationId: FOREIGN_ORG }, wo.id, 'in_progress')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
