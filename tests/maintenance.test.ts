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
describe('Phase 19: extended lifecycle', () => {
  it('walks the full draft→submitted→approved→assigned→in_progress→on_hold→completed→verified→closed lifecycle', async () => {
    const { createWorkOrder, transitionWorkOrderStatus } = await import('@/services/maintenance-service');
    const { workOrders } = await import('@/db/schema');
    const created = await createWorkOrder(admin, { title: 'Full lifecycle', maintenanceType: 'corrective', propertyId, priority: 'medium' });
    // createWorkOrder always starts at "open" for backward compatibility; force it to "draft" to exercise the new lifecycle.
    await db.update(workOrders).set({ status: 'draft' }).where(eq(workOrders.id, created.id));

    const path: Array<import('@/services/maintenance-service').WorkOrderStatus> = [
      'submitted', 'approved', 'assigned', 'in_progress', 'on_hold', 'in_progress', 'completed', 'verified', 'closed',
    ];
    for (const status of path) {
      const result = await transitionWorkOrderStatus(admin, created.id, status);
      expect(result.status).toBe(status);
    }
  });

  it('still rejects an invalid jump in the extended lifecycle', async () => {
    const { transitionWorkOrderStatus } = await import('@/services/maintenance-service');
    const { workOrders } = await import('@/db/schema');
    const wo = await makeWorkOrder({ title: 'Invalid extended jump' });
    await db.update(workOrders).set({ status: 'draft' }).where(eq(workOrders.id, wo.id));
    await expect(transitionWorkOrderStatus(admin, wo.id, 'closed')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('computes an SLA "warning" state as the deadline approaches', async () => {
    const { workOrderSlaState } = await import('@/services/maintenance-service');
    const soon = workOrderSlaState({ createdAt: new Date(Date.now() - 1000 * 3600 * 20), resolutionSlaHours: 24, status: 'in_progress', resolutionSlaMet: null });
    expect(soon.state).toBe('warning');
  });
});

/* -------------------------------------------------------------------------- */
describe('Phase 19: idempotent preventive generation & bulk automation', () => {
  it('never creates a second work order for the same schedule + occurrence date, even across the bulk generator', async () => {
    const { generateWorkOrderFromPreventive, generateDuePreventiveWorkOrders } = await import('@/services/maintenance-service');
    const { preventiveMaintenanceSchedules, preventiveMaintenanceOccurrences, workOrders } = await import('@/db/schema');
    const [schedule] = await db
      .select({ id: preventiveMaintenanceSchedules.id, nextDueDate: preventiveMaintenanceSchedules.nextDueDate })
      .from(preventiveMaintenanceSchedules)
      .where(eq(preventiveMaintenanceSchedules.organizationId, admin.organizationId))
      .limit(1);
    // Force it due today so the bulk generator picks it up.
    await db.update(preventiveMaintenanceSchedules).set({ nextDueDate: new Date().toISOString().slice(0, 10), isActive: true }).where(eq(preventiveMaintenanceSchedules.id, schedule.id));
    const [due] = await db.select({ nextDueDate: preventiveMaintenanceSchedules.nextDueDate }).from(preventiveMaintenanceSchedules).where(eq(preventiveMaintenanceSchedules.id, schedule.id));

    const direct1 = await generateWorkOrderFromPreventive(admin, schedule.id, due.nextDueDate);
    const direct2 = await generateWorkOrderFromPreventive(admin, schedule.id, due.nextDueDate);
    expect(direct2.id).toBe(direct1.id);
    expect(direct2.alreadyExisted).toBe(true);

    // Running the bulk generator afterwards must not create a second occurrence
    // (or work order) for this same schedule + occurrence date, even though it
    // may generate work orders for other due schedules in the same run.
    await generateDuePreventiveWorkOrders(admin);

    const occurrences = await db
      .select({ id: preventiveMaintenanceOccurrences.id, workOrderId: preventiveMaintenanceOccurrences.workOrderId })
      .from(preventiveMaintenanceOccurrences)
      .where(and(eq(preventiveMaintenanceOccurrences.scheduleId, schedule.id), eq(preventiveMaintenanceOccurrences.occurrenceDate, due.nextDueDate)));
    expect(occurrences.length).toBe(1);
    expect(occurrences[0].workOrderId).toBe(direct1.id);

    const matchingWorkOrders = await db.select({ id: workOrders.id }).from(workOrders).where(eq(workOrders.id, direct1.id));
    expect(matchingWorkOrders.length).toBe(1);
  });

  it('advances a schedule and generates exactly one new work order per call of the bulk generator', async () => {
    const { generateDuePreventiveWorkOrders } = await import('@/services/maintenance-service');
    const { preventiveMaintenanceSchedules, properties, maintenanceCategories } = await import('@/db/schema');
    const [prop] = await db.select({ id: properties.id }).from(properties).where(eq(properties.organizationId, admin.organizationId)).limit(1);
    const [cat] = await db.select({ id: maintenanceCategories.id }).from(maintenanceCategories).where(eq(maintenanceCategories.organizationId, admin.organizationId)).limit(1);
    const [fresh] = await db
      .insert(preventiveMaintenanceSchedules)
      .values({
        organizationId: admin.organizationId,
        nameEn: 'Fresh PM schedule',
        propertyId: prop.id,
        categoryId: cat.id,
        frequency: 'monthly',
        intervalMonths: 1,
        nextDueDate: new Date().toISOString().slice(0, 10),
        isActive: true,
      })
      .returning({ id: preventiveMaintenanceSchedules.id, nextDueDate: preventiveMaintenanceSchedules.nextDueDate });

    const first = await generateDuePreventiveWorkOrders(admin);
    expect(first.generated).toBeGreaterThanOrEqual(1);

    const [after] = await db.select({ nextDueDate: preventiveMaintenanceSchedules.nextDueDate }).from(preventiveMaintenanceSchedules).where(eq(preventiveMaintenanceSchedules.id, fresh.id));
    expect(after.nextDueDate).not.toBe(fresh.nextDueDate);

    // Calling it again immediately (nothing newly due) must not generate again for this schedule.
    const second = await generateDuePreventiveWorkOrders(admin);
    expect(second.generated).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
describe('Phase 19: itemized maintenance checklists', () => {
  it('executes checklist items, is idempotent on re-submission, and creates exactly one corrective work order on failure', async () => {
    const { createChecklistTemplate, executeChecklistItem, getWorkOrderChecklistResults } = await import('@/services/maintenance-service');
    const { workOrderChecklistResults } = await import('@/db/schema');
    const wo = await makeWorkOrder({ title: 'Checklist WO', categoryId });
    const template = await createChecklistTemplate(admin, {
      code: `CHK-${Date.now()}`,
      nameEn: 'Elevator quarterly inspection',
      categoryId,
      items: [
        { key: 'brakes', labelEn: 'Brakes engage correctly', required: true, createsCorrectiveOnFail: true },
        { key: 'lighting', labelEn: 'Cabin lighting works', required: false },
      ],
    });

    const pass = await executeChecklistItem(admin, { workOrderId: wo.id, templateId: template.id, itemKey: 'lighting', result: 'pass' });
    expect(pass.correctiveWorkOrderId).toBeNull();

    const fail1 = await executeChecklistItem(admin, { workOrderId: wo.id, templateId: template.id, itemKey: 'brakes', result: 'fail', notes: 'Slipping' });
    expect(fail1.correctiveWorkOrderId).toBeTruthy();

    // Re-submitting the same failed item must not spawn a second corrective work order, nor duplicate the result row.
    const fail2 = await executeChecklistItem(admin, { workOrderId: wo.id, templateId: template.id, itemKey: 'brakes', result: 'fail', notes: 'Still slipping' });
    expect(fail2.correctiveWorkOrderId).toBe(fail1.correctiveWorkOrderId);

    const rows = await db.select({ id: workOrderChecklistResults.id }).from(workOrderChecklistResults).where(and(eq(workOrderChecklistResults.workOrderId, wo.id), eq(workOrderChecklistResults.itemKey, 'brakes')));
    expect(rows.length).toBe(1);

    const results = await getWorkOrderChecklistResults(admin.organizationId, wo.id);
    expect(results.length).toBe(2);
  });

  it('rejects a duplicate template code and an unknown checklist item key', async () => {
    const { createChecklistTemplate, executeChecklistItem } = await import('@/services/maintenance-service');
    const code = `CHK-DUP-${Date.now()}`;
    await createChecklistTemplate(admin, { code, nameEn: 'Dup test', items: [{ key: 'a', labelEn: 'A' }] });
    await expect(createChecklistTemplate(admin, { code, nameEn: 'Dup test 2', items: [{ key: 'a', labelEn: 'A' }] })).rejects.toMatchObject({ code: 'CONFLICT' });

    const template = await createChecklistTemplate(admin, { code: `CHK-${Date.now()}-x`, nameEn: 'Item test', items: [{ key: 'only', labelEn: 'Only item' }] });
    const wo = await makeWorkOrder({ title: 'Bad item key' });
    await expect(executeChecklistItem(admin, { workOrderId: wo.id, templateId: template.id, itemKey: 'missing', result: 'pass' })).rejects.toMatchObject({ code: 'VALIDATION' });
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
