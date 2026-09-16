import 'server-only';
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  auditLogs,
  maintenanceCategories,
  maintenanceChecklistTemplates,
  maintenanceCosts,
  notifications,
  preventiveMaintenanceOccurrences,
  preventiveMaintenanceSchedules,
  properties,
  tenants,
  units,
  users,
  vendors,
  workOrderChecklistResults,
  workOrders,
} from '@/db/schema';
import type { DbExecutor } from '@/db/types';
import { recordAudit } from '@/lib/audit';
import { conflict, forbidden, notFound, validationError } from '@/lib/errors';
import { getPolicy } from '@/lib/settings';
import { round2 } from '@/lib/utils';
import type { SessionUser } from '@/lib/auth/session';
import type { PermissionKey } from '@/lib/permissions/catalog';

/**
 * Minimal actor shape accepted by the preventive-generation and work-order
 * creation helpers — satisfied by both an interactive `SessionUser` and an
 * API/cron `ApiPrincipal` (whose `userId` may be null for a bare API key).
 */
export interface MaintenanceActor {
  id: string | null;
  organizationId: string;
  fullName: string;
  permissions: PermissionKey[];
}

/**
 * Allowed work-order status transitions (BRD 52). Terminal states are empty.
 *
 * Phase 19 extends this with a fuller lifecycle (draft/submitted/approved/
 * on_hold/verified/closed) while keeping every legacy value and edge exactly
 * as before, so the 635 pre-existing seeded work orders and any code built
 * against the original 6-state machine keep working unchanged. New work
 * orders may opt into the fuller lifecycle by starting at "draft".
 */
const STATUS_TRANSITIONS: Record<string, string[]> = {
  // Legacy lifecycle (unchanged).
  open: ['assigned', 'in_progress', 'cancelled'],
  assigned: ['in_progress', 'pending', 'on_hold', 'cancelled'],
  in_progress: ['pending', 'on_hold', 'completed', 'cancelled'],
  pending: ['in_progress', 'completed', 'cancelled'],
  completed: ['verified'],
  cancelled: [],
  // Phase 19 extended lifecycle.
  draft: ['submitted', 'cancelled'],
  submitted: ['approved', 'cancelled'],
  approved: ['assigned', 'cancelled'],
  on_hold: ['in_progress', 'completed', 'cancelled'],
  verified: ['closed'],
  closed: [],
};

export type WorkOrderStatus =
  | 'open'
  | 'assigned'
  | 'in_progress'
  | 'pending'
  | 'completed'
  | 'cancelled'
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'on_hold'
  | 'verified'
  | 'closed';

function hoursBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 3_600_000));
}

/** Pure SLA state derived from stored values (no second SLA engine). */
const SLA_WARNING_THRESHOLD_RATIO = 0.2;

export function workOrderSlaState(
  wo: { createdAt: Date; resolutionSlaHours: number; status: string; resolutionSlaMet: boolean | null },
  now: Date = new Date(),
): { dueAt: Date; remainingHours: number; breached: boolean; state: 'met' | 'breached' | 'on_track' | 'warning' | 'closed' } {
  const dueAt = new Date(wo.createdAt.getTime() + wo.resolutionSlaHours * 3_600_000);
  if (wo.status === 'completed' || wo.status === 'verified' || wo.status === 'closed') {
    return { dueAt, remainingHours: 0, breached: wo.resolutionSlaMet === false, state: wo.resolutionSlaMet === false ? 'breached' : 'met' };
  }
  if (wo.status === 'cancelled') {
    return { dueAt, remainingHours: 0, breached: false, state: 'closed' };
  }
  const remainingHours = Math.round((dueAt.getTime() - now.getTime()) / 3_600_000);
  const breached = now.getTime() > dueAt.getTime();
  const warning = !breached && remainingHours <= wo.resolutionSlaHours * SLA_WARNING_THRESHOLD_RATIO;
  return { dueAt, remainingHours, breached, state: breached ? 'breached' : warning ? 'warning' : 'on_track' };
}

/** Validates optional work-order references against org-scoped data. */
async function validateWorkOrderRefs(
  tx: DbExecutor,
  organizationId: string,
  input: { propertyId?: string; unitId?: string | null; categoryId?: string | null; vendorId?: string | null; assignedUserId?: string | null; tenantId?: string | null; expectedPropertyId?: string },
): Promise<void> {
  const propertyId = input.propertyId ?? input.expectedPropertyId;
  if (input.propertyId) {
    const [p] = await tx
      .select({ id: properties.id })
      .from(properties)
      .where(and(eq(properties.id, input.propertyId), eq(properties.organizationId, organizationId), isNull(properties.deletedAt)))
      .limit(1);
    if (!p) throw validationError('The selected property is not valid for this organization.');
  }
  if (input.unitId) {
    const [u] = await tx
      .select({ id: units.id, propertyId: units.propertyId })
      .from(units)
      .where(and(eq(units.id, input.unitId), eq(units.organizationId, organizationId), isNull(units.deletedAt)))
      .limit(1);
    if (!u) throw validationError('The selected unit is not valid for this organization.');
    if (propertyId && u.propertyId !== propertyId) throw validationError('The selected unit does not belong to the selected property.');
  }
  if (input.categoryId) {
    const [c] = await tx.select({ id: maintenanceCategories.id }).from(maintenanceCategories).where(and(eq(maintenanceCategories.id, input.categoryId), eq(maintenanceCategories.organizationId, organizationId))).limit(1);
    if (!c) throw validationError('The selected category is not valid for this organization.');
  }
  if (input.vendorId) {
    const [v] = await tx.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.id, input.vendorId), eq(vendors.organizationId, organizationId))).limit(1);
    if (!v) throw validationError('The selected vendor is not valid for this organization.');
  }
  if (input.assignedUserId) {
    const [u] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, input.assignedUserId), eq(users.organizationId, organizationId), eq(users.isActive, true), isNull(users.deletedAt))).limit(1);
    if (!u) throw validationError('The assigned user is not valid for this organization.');
  }
  if (input.tenantId) {
    const [t] = await tx.select({ id: tenants.id }).from(tenants).where(and(eq(tenants.id, input.tenantId), eq(tenants.organizationId, organizationId), isNull(tenants.deletedAt))).limit(1);
    if (!t) throw validationError('The selected tenant is not valid for this organization.');
  }
}

/**
 * Maintenance service (BRD 50-55).
 *
 * BR-014: recording a maintenance cost rolls it up into property OPEX and
 *         therefore NOI (via the shared metrics service).
 */

export interface WorkOrderListFilters {
  organizationId: string;
  allowedPropertyIds?: string[] | null;
  propertyId?: string;
  status?: string;
  priority?: string;
  maintenanceType?: string;
  slaBreached?: boolean;
  search?: string;
  page: number;
  pageSize: number;
}

export interface WorkOrderListItem {
  id: string;
  code: string;
  title: string;
  propertyName: string;
  unitNumber: string | null;
  categoryName: string | null;
  vendorName: string | null;
  maintenanceType: string;
  priority: string;
  status: string;
  actualCost: number;
  createdAt: Date;
  resolutionSlaMet: boolean | null;
}

export async function listWorkOrders(
  filters: WorkOrderListFilters,
): Promise<{ items: WorkOrderListItem[]; total: number }> {
  const db = await getDb();
  const conditions: SQL[] = [eq(workOrders.organizationId, filters.organizationId), isNull(workOrders.deletedAt)];
  if (filters.allowedPropertyIds?.length) conditions.push(inArray(workOrders.propertyId, filters.allowedPropertyIds));
  if (filters.propertyId) conditions.push(eq(workOrders.propertyId, filters.propertyId));
  if (filters.status) conditions.push(eq(workOrders.status, filters.status as typeof workOrders.$inferSelect.status));
  if (filters.priority) conditions.push(eq(workOrders.priority, filters.priority as typeof workOrders.$inferSelect.priority));
  if (filters.maintenanceType) conditions.push(eq(workOrders.maintenanceType, filters.maintenanceType as typeof workOrders.$inferSelect.maintenanceType));
  if (filters.slaBreached) conditions.push(eq(workOrders.resolutionSlaMet, false));
  if (filters.search) conditions.push(or(ilike(workOrders.code, `%${filters.search}%`), ilike(workOrders.title, `%${filters.search}%`)) as SQL);

  const where = and(...conditions) as SQL;

  const rows = await db
    .select({
      id: workOrders.id,
      code: workOrders.code,
      title: workOrders.title,
      propertyName: properties.nameEn,
      unitNumber: units.unitNumber,
      categoryName: maintenanceCategories.nameEn,
      vendorName: vendors.nameEn,
      maintenanceType: workOrders.maintenanceType,
      priority: workOrders.priority,
      status: workOrders.status,
      actualCost: workOrders.actualCost,
      createdAt: workOrders.createdAt,
      resolutionSlaMet: workOrders.resolutionSlaMet,
    })
    .from(workOrders)
    .innerJoin(properties, eq(properties.id, workOrders.propertyId))
    .leftJoin(units, eq(units.id, workOrders.unitId))
    .leftJoin(maintenanceCategories, eq(maintenanceCategories.id, workOrders.categoryId))
    .leftJoin(vendors, eq(vendors.id, workOrders.vendorId))
    .where(where)
    .orderBy(desc(workOrders.createdAt))
    .limit(filters.pageSize)
    .offset((filters.page - 1) * filters.pageSize);

  const [{ total }] = await db.select({ total: count() }).from(workOrders).where(where);

  return {
    items: rows.map((row) => ({ ...row, actualCost: round2(Number(row.actualCost)) })),
    total: Number(total),
  };
}

export async function getWorkOrderDetail(organizationId: string, workOrderId: string) {
  const db = await getDb();
  const [workOrder] = await db
    .select({
      id: workOrders.id,
      code: workOrders.code,
      title: workOrders.title,
      description: workOrders.description,
      maintenanceType: workOrders.maintenanceType,
      propertyId: workOrders.propertyId,
      propertyName: properties.nameEn,
      unitId: workOrders.unitId,
      unitNumber: units.unitNumber,
      categoryId: workOrders.categoryId,
      categoryName: maintenanceCategories.nameEn,
      vendorId: workOrders.vendorId,
      vendorName: vendors.nameEn,
      assignedUserId: workOrders.assignedUserId,
      assignedUserName: users.fullName,
      tenantId: workOrders.tenantId,
      tenantName: tenants.displayName,
      priority: workOrders.priority,
      status: workOrders.status,
      responseSlaHours: workOrders.responseSlaHours,
      resolutionSlaHours: workOrders.resolutionSlaHours,
      actualResponseHours: workOrders.actualResponseHours,
      actualResolutionHours: workOrders.actualResolutionHours,
      responseSlaMet: workOrders.responseSlaMet,
      resolutionSlaMet: workOrders.resolutionSlaMet,
      estimatedCost: workOrders.estimatedCost,
      actualCost: workOrders.actualCost,
      resolutionNotes: workOrders.resolutionNotes,
      respondedAt: workOrders.respondedAt,
      createdAt: workOrders.createdAt,
      completedAt: workOrders.completedAt,
      cancelledAt: workOrders.cancelledAt,
    })
    .from(workOrders)
    .innerJoin(properties, eq(properties.id, workOrders.propertyId))
    .leftJoin(units, eq(units.id, workOrders.unitId))
    .leftJoin(maintenanceCategories, eq(maintenanceCategories.id, workOrders.categoryId))
    .leftJoin(vendors, eq(vendors.id, workOrders.vendorId))
    .leftJoin(users, eq(users.id, workOrders.assignedUserId))
    .leftJoin(tenants, eq(tenants.id, workOrders.tenantId))
    .where(and(eq(workOrders.id, workOrderId), eq(workOrders.organizationId, organizationId), isNull(workOrders.deletedAt)))
    .limit(1);

  if (!workOrder) return null;

  const costs = await db
    .select()
    .from(maintenanceCosts)
    .where(eq(maintenanceCosts.workOrderId, workOrderId))
    .orderBy(desc(maintenanceCosts.incurredOn));

  return { workOrder, costs };
}

export interface VendorPerformanceRow {
  id: string;
  name: string;
  workOrders: number;
  slaCompliance: number;
  rating: number;
}

export async function getVendorPerformance(
  organizationId: string,
  limit = 6,
): Promise<VendorPerformanceRow[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: vendors.id,
      name: vendors.nameEn,
      slaCompliance: vendors.slaCompliancePercent,
      rating: vendors.rating,
      workOrders: sql<number>`count(${workOrders.id})::int`,
    })
    .from(vendors)
    .leftJoin(workOrders, eq(workOrders.vendorId, vendors.id))
    .where(and(eq(vendors.organizationId, organizationId), eq(vendors.isActive, true)))
    .groupBy(vendors.id, vendors.nameEn, vendors.slaCompliancePercent, vendors.rating)
    .orderBy(desc(sql`count(${workOrders.id})`))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    workOrders: Number(row.workOrders),
    slaCompliance: Number(row.slaCompliance),
    rating: Number(row.rating) / 10,
  }));
}

export async function getUpcomingPreventiveMaintenance(
  organizationId: string,
  allowedPropertyIds: string[] | null,
  limit = 8,
) {
  const db = await getDb();
  const conditions: SQL[] = [
    eq(preventiveMaintenanceSchedules.organizationId, organizationId),
    eq(preventiveMaintenanceSchedules.isActive, true),
  ];
  if (allowedPropertyIds?.length) conditions.push(inArray(preventiveMaintenanceSchedules.propertyId, allowedPropertyIds));

  return db
    .select({
      id: preventiveMaintenanceSchedules.id,
      name: preventiveMaintenanceSchedules.nameEn,
      propertyName: properties.nameEn,
      categoryName: maintenanceCategories.nameEn,
      nextDueDate: preventiveMaintenanceSchedules.nextDueDate,
      status: preventiveMaintenanceSchedules.status,
      frequency: preventiveMaintenanceSchedules.frequency,
    })
    .from(preventiveMaintenanceSchedules)
    .innerJoin(properties, eq(properties.id, preventiveMaintenanceSchedules.propertyId))
    .leftJoin(maintenanceCategories, eq(maintenanceCategories.id, preventiveMaintenanceSchedules.categoryId))
    .where(and(...conditions))
    .orderBy(asc(preventiveMaintenanceSchedules.nextDueDate))
    .limit(limit);
}

export interface CreateWorkOrderInput {
  title: string;
  description?: string;
  maintenanceType: 'preventive' | 'corrective' | 'emergency' | 'inspection' | 'renovation' | 'unit_turnaround';
  categoryId?: string;
  propertyId: string;
  buildingId?: string;
  unitId?: string;
  assetId?: string;
  tenantId?: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  vendorId?: string;
  assignedUserId?: string;
  estimatedCost?: number;
}

/** Core work-order insert, usable both standalone and nested inside a caller's
 *  already-open transaction (e.g. idempotent preventive generation) — never
 *  opens its own `getDb()`/transaction, per the PGlite single-connection rule. */
async function createWorkOrderInTx(
  tx: DbExecutor,
  actor: MaintenanceActor,
  input: CreateWorkOrderInput,
  sla: { responseHours: number; resolutionHours: number },
): Promise<{ id: string; code: string }> {
  await validateWorkOrderRefs(tx, actor.organizationId, {
    propertyId: input.propertyId,
    unitId: input.unitId ?? null,
    categoryId: input.categoryId ?? null,
    vendorId: input.vendorId ?? null,
    assignedUserId: input.assignedUserId ?? null,
    tenantId: input.tenantId ?? null,
  });

  // Derive the next code from the highest existing code (zero-padded, so
  // lexical max equals numeric max) rather than the row count — this avoids
  // colliding with non-contiguous seeded codes.
  const [{ maxCode }] = await tx
    .select({ maxCode: sql<string | null>`max(${workOrders.code})` })
    .from(workOrders)
    .where(eq(workOrders.organizationId, actor.organizationId));
  const nextNumber = maxCode ? Number(maxCode.replace(/\D/g, '')) + 1 : 1;
  const code = `WO-${String(nextNumber).padStart(5, '0')}`;

  // An initial vendor/user assignment moves the order to "assigned" and starts
  // the response-SLA clock immediately.
  const now = new Date();
  const assigned = Boolean(input.vendorId || input.assignedUserId);

  const [created] = await tx
    .insert(workOrders)
    .values({
      organizationId: actor.organizationId,
      code,
      title: input.title,
      description: input.description ?? null,
      maintenanceType: input.maintenanceType,
      categoryId: input.categoryId ?? null,
      propertyId: input.propertyId,
      buildingId: input.buildingId ?? null,
      unitId: input.unitId ?? null,
      assetId: input.assetId ?? null,
      tenantId: input.tenantId ?? null,
      priority: input.priority,
      status: assigned ? 'assigned' : 'open',
      vendorId: input.vendorId ?? null,
      assignedUserId: input.assignedUserId ?? null,
      respondedAt: assigned ? now : null,
      actualResponseHours: assigned ? 0 : null,
      responseSlaMet: assigned ? true : null,
      responseSlaHours: sla.responseHours,
      resolutionSlaHours: sla.resolutionHours,
      estimatedCost: round2(input.estimatedCost ?? 0),
    })
    .returning({ id: workOrders.id });

  await recordAudit(tx, {
    organizationId: actor.organizationId,
    action: 'create',
    entityType: 'work_order',
    entityId: created.id,
    entityLabel: code,
    newValue: { title: input.title, priority: input.priority, status: assigned ? 'assigned' : 'open' },
    actor: actor.id ? { id: actor.id, fullName: actor.fullName } : null,
  });

  return { id: created.id, code };
}

export async function createWorkOrder(
  actor: SessionUser,
  input: CreateWorkOrderInput,
): Promise<{ id: string; code: string }> {
  const db = await getDb();
  // Policy is read outside the transaction (PGlite single-connection safety).
  const policy = await getPolicy(actor.organizationId);
  const sla = policy.maintenanceSlaByPriority[input.priority] ?? { responseHours: 24, resolutionHours: 72 };
  return db.transaction((tx) => createWorkOrderInTx(tx, actor, input, sla));
}

/**
 * Records an actual maintenance cost against a work order (BR-014). The cost
 * rolls up into property OPEX automatically because the metrics service reads
 * the same maintenance_costs table.
 */
export async function recordMaintenanceCost(
  actor: SessionUser,
  input: {
    workOrderId: string;
    amount: number;
    description: string;
    incurredOn: string;
    costType?: string;
    invoiceNumber?: string;
    /** Itemized materials/spare-parts capture (Phase 19), typically paired with costType='parts'. */
    quantity?: number;
    unit?: string;
  },
): Promise<{ id: string }> {
  if (input.amount <= 0) throw validationError('Cost amount must be greater than zero.');
  const db = await getDb();
  // Spend-approval gate (no persisted approval state exists in the schema): a
  // cost at or above the configured threshold may only be recorded by a user
  // holding maintenance:approve. Policy is read outside the transaction.
  const policy = await getPolicy(actor.organizationId);
  if (input.amount >= policy.maintenanceSpendApprovalThreshold && !actor.permissions.includes('maintenance:approve')) {
    throw forbidden(
      `This cost is at or above the ${policy.maintenanceSpendApprovalThreshold.toLocaleString()} SAR approval threshold and must be recorded by a user with maintenance approval permission.`,
    );
  }
  return db.transaction(async (tx) => {
    const [workOrder] = await tx
      .select({ id: workOrders.id, propertyId: workOrders.propertyId, unitId: workOrders.unitId, vendorId: workOrders.vendorId, actualCost: workOrders.actualCost })
      .from(workOrders)
      .where(and(eq(workOrders.id, input.workOrderId), eq(workOrders.organizationId, actor.organizationId)))
      .limit(1);
    if (!workOrder) throw notFound('Work order', input.workOrderId);

    const [cost] = await tx
      .insert(maintenanceCosts)
      .values({
        organizationId: actor.organizationId,
        workOrderId: input.workOrderId,
        propertyId: workOrder.propertyId,
        unitId: workOrder.unitId,
        vendorId: workOrder.vendorId,
        costType: input.costType ?? 'vendor_invoice',
        description: input.description,
        amount: round2(input.amount),
        vatAmount: round2(input.amount * 0.15),
        invoiceNumber: input.invoiceNumber ?? null,
        incurredOn: input.incurredOn,
        quantity: input.quantity !== undefined ? String(input.quantity) : null,
        unit: input.unit ?? null,
        recordedByUserId: actor.id,
      })
      .returning({ id: maintenanceCosts.id });

    // Keep the work order's actual cost aggregate in sync.
    await tx
      .update(workOrders)
      .set({ actualCost: round2(Number(workOrder.actualCost) + input.amount) })
      .where(eq(workOrders.id, input.workOrderId));

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'create',
      entityType: 'maintenance_cost',
      entityId: cost.id,
      entityLabel: input.description,
      newValue: { amount: input.amount, workOrderId: input.workOrderId },
      actor: { id: actor.id, fullName: actor.fullName },
    });

    return { id: cost.id };
  });
}

/* -------------------------------------------------------------------------- */
/* Edit, assignment and status transitions (BRD 52)                            */
/* -------------------------------------------------------------------------- */

export interface UpdateWorkOrderInput {
  title: string;
  description?: string;
  maintenanceType: 'preventive' | 'corrective' | 'emergency' | 'inspection' | 'renovation' | 'unit_turnaround';
  categoryId?: string;
  unitId?: string;
  tenantId?: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  estimatedCost?: number;
  resolutionNotes?: string;
}

/** Updates editable work-order fields. Property, status and cost history are
 *  intentionally immutable here; closed orders cannot be edited. */
export async function updateWorkOrder(
  actor: SessionUser,
  workOrderId: string,
  input: UpdateWorkOrderInput,
): Promise<{ id: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: workOrders.id, code: workOrders.code, status: workOrders.status, propertyId: workOrders.propertyId })
      .from(workOrders)
      .where(and(eq(workOrders.id, workOrderId), eq(workOrders.organizationId, actor.organizationId), isNull(workOrders.deletedAt)))
      .limit(1);
    if (!existing) throw notFound('Work order', workOrderId);
    if (existing.status === 'completed' || existing.status === 'cancelled') {
      throw conflict('A completed or cancelled work order can no longer be edited.');
    }

    await validateWorkOrderRefs(tx, actor.organizationId, {
      expectedPropertyId: existing.propertyId,
      unitId: input.unitId ?? null,
      categoryId: input.categoryId ?? null,
      tenantId: input.tenantId ?? null,
    });

    await tx
      .update(workOrders)
      .set({
        title: input.title,
        description: input.description ?? null,
        maintenanceType: input.maintenanceType,
        categoryId: input.categoryId ?? null,
        unitId: input.unitId ?? null,
        tenantId: input.tenantId ?? null,
        priority: input.priority,
        estimatedCost: round2(input.estimatedCost ?? 0),
        resolutionNotes: input.resolutionNotes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(workOrders.id, workOrderId));

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'work_order',
      entityId: workOrderId,
      entityLabel: existing.code,
      newValue: { title: input.title, priority: input.priority },
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: workOrderId };
  });
}

/** Assigns a vendor and/or internal user. Both must belong to the caller's
 *  organization. Assigning an open order moves it to "assigned". */
export async function assignWorkOrder(
  actor: SessionUser,
  workOrderId: string,
  input: { vendorId?: string | null; assignedUserId?: string | null },
): Promise<{ id: string; status: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [wo] = await tx
      .select({ id: workOrders.id, code: workOrders.code, status: workOrders.status, createdAt: workOrders.createdAt, respondedAt: workOrders.respondedAt, responseSlaHours: workOrders.responseSlaHours })
      .from(workOrders)
      .where(and(eq(workOrders.id, workOrderId), eq(workOrders.organizationId, actor.organizationId), isNull(workOrders.deletedAt)))
      .limit(1);
    if (!wo) throw notFound('Work order', workOrderId);
    if (wo.status === 'completed' || wo.status === 'cancelled') throw conflict('A closed work order cannot be reassigned.');

    await validateWorkOrderRefs(tx, actor.organizationId, {
      vendorId: input.vendorId ?? null,
      assignedUserId: input.assignedUserId ?? null,
    });

    const now = new Date();
    const patch: Record<string, unknown> = { updatedAt: now };
    if (input.vendorId !== undefined) patch.vendorId = input.vendorId;
    if (input.assignedUserId !== undefined) patch.assignedUserId = input.assignedUserId;

    let status = wo.status;
    if (wo.status === 'open' && (input.vendorId || input.assignedUserId)) {
      status = 'assigned';
      patch.status = 'assigned';
      if (!wo.respondedAt) {
        patch.respondedAt = now;
        const response = hoursBetween(wo.createdAt, now);
        patch.actualResponseHours = response;
        patch.responseSlaMet = response <= wo.responseSlaHours;
      }
    }

    await tx.update(workOrders).set(patch).where(eq(workOrders.id, workOrderId));
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'work_order',
      entityId: workOrderId,
      entityLabel: wo.code,
      newValue: { vendorId: input.vendorId ?? null, assignedUserId: input.assignedUserId ?? null, status },
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: workOrderId, status };
  });
}

/** Moves a work order along the allowed status lifecycle. Invalid jumps are
 *  rejected; SLA response/resolution flags are stamped on the right edges. */
export async function transitionWorkOrderStatus(
  actor: SessionUser,
  workOrderId: string,
  toStatus: WorkOrderStatus,
): Promise<{ id: string; status: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [wo] = await tx
      .select({
        id: workOrders.id,
        code: workOrders.code,
        status: workOrders.status,
        createdAt: workOrders.createdAt,
        respondedAt: workOrders.respondedAt,
        responseSlaHours: workOrders.responseSlaHours,
        resolutionSlaHours: workOrders.resolutionSlaHours,
      })
      .from(workOrders)
      .where(and(eq(workOrders.id, workOrderId), eq(workOrders.organizationId, actor.organizationId), isNull(workOrders.deletedAt)))
      .limit(1);
    if (!wo) throw notFound('Work order', workOrderId);

    const allowed = STATUS_TRANSITIONS[wo.status] ?? [];
    if (!allowed.includes(toStatus)) {
      throw conflict(`A work order cannot move from "${wo.status.replace(/_/g, ' ')}" to "${toStatus.replace(/_/g, ' ')}".`);
    }

    const now = new Date();
    const patch: Record<string, unknown> = { status: toStatus, updatedAt: now };
    // First movement out of "open" (other than cancelling) starts response SLA.
    if (!wo.respondedAt && toStatus !== 'cancelled') {
      patch.respondedAt = now;
      const response = hoursBetween(wo.createdAt, now);
      patch.actualResponseHours = response;
      patch.responseSlaMet = response <= wo.responseSlaHours;
    }
    if (toStatus === 'completed') {
      patch.completedAt = now;
      const resolution = hoursBetween(wo.createdAt, now);
      patch.actualResolutionHours = resolution;
      patch.resolutionSlaMet = resolution <= wo.resolutionSlaHours;
    }
    if (toStatus === 'cancelled') patch.cancelledAt = now;

    await tx.update(workOrders).set(patch).where(eq(workOrders.id, workOrderId));
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'work_order',
      entityId: workOrderId,
      entityLabel: wo.code,
      previousValue: { status: wo.status },
      newValue: { status: toStatus },
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: workOrderId, status: toStatus };
  });
}

/* -------------------------------------------------------------------------- */
/* Preventive maintenance → work order generation                              */
/* -------------------------------------------------------------------------- */

/**
 * Generates a work order from a preventive-maintenance schedule for one
 * scheduled occurrence date. Idempotent by a real per-occurrence identity: a
 * `(scheduleId, occurrenceDate)` unique constraint on
 * `preventive_maintenance_occurrences` guarantees that no matter how many
 * times — or how concurrently — this is invoked for the same schedule and
 * occurrence, exactly one work order is ever generated. Running the generator
 * twice for the same occurrence returns the same work order the second time.
 */
export async function generateWorkOrderFromPreventive(
  actor: MaintenanceActor,
  scheduleId: string,
  occurrenceDate?: string,
): Promise<{ id: string; code: string; alreadyExisted: boolean }> {
  const db = await getDb();
  // Policy is read outside the transaction (PGlite single-connection safety).
  const policy = await getPolicy(actor.organizationId);

  return db.transaction(async (tx) => {
    const [schedule] = await tx
      .select({
        id: preventiveMaintenanceSchedules.id,
        name: preventiveMaintenanceSchedules.nameEn,
        propertyId: preventiveMaintenanceSchedules.propertyId,
        buildingId: preventiveMaintenanceSchedules.buildingId,
        unitId: preventiveMaintenanceSchedules.unitId,
        assetId: preventiveMaintenanceSchedules.assetId,
        categoryId: preventiveMaintenanceSchedules.categoryId,
        vendorId: preventiveMaintenanceSchedules.vendorId,
        estimatedCost: preventiveMaintenanceSchedules.estimatedCost,
        nextDueDate: preventiveMaintenanceSchedules.nextDueDate,
      })
      .from(preventiveMaintenanceSchedules)
      .where(and(eq(preventiveMaintenanceSchedules.id, scheduleId), eq(preventiveMaintenanceSchedules.organizationId, actor.organizationId)))
      .limit(1);
    if (!schedule) throw notFound('Preventive maintenance schedule', scheduleId);

    const occDate = occurrenceDate ?? schedule.nextDueDate;

    // Claim the occurrence: the unique index is the actual idempotency
    // guarantee, not this application-level check.
    const claimed = await tx
      .insert(preventiveMaintenanceOccurrences)
      .values({ organizationId: actor.organizationId, scheduleId, occurrenceDate: occDate })
      .onConflictDoNothing({ target: [preventiveMaintenanceOccurrences.scheduleId, preventiveMaintenanceOccurrences.occurrenceDate] })
      .returning({ id: preventiveMaintenanceOccurrences.id });

    if (claimed.length === 0) {
      // Someone already generated this occurrence — return the existing link.
      const [occ] = await tx
        .select({ workOrderId: preventiveMaintenanceOccurrences.workOrderId })
        .from(preventiveMaintenanceOccurrences)
        .where(and(eq(preventiveMaintenanceOccurrences.scheduleId, scheduleId), eq(preventiveMaintenanceOccurrences.occurrenceDate, occDate)))
        .limit(1);
      if (occ?.workOrderId) {
        const [wo] = await tx.select({ id: workOrders.id, code: workOrders.code }).from(workOrders).where(eq(workOrders.id, occ.workOrderId)).limit(1);
        if (wo) return { ...wo, alreadyExisted: true };
      }
      throw conflict('This preventive maintenance occurrence is already being generated.');
    }

    const sla = policy.maintenanceSlaByPriority.medium ?? { responseHours: 24, resolutionHours: 72 };
    const created = await createWorkOrderInTx(
      tx,
      actor,
      {
        title: schedule.name,
        description: `Preventive maintenance: ${schedule.name}`,
        maintenanceType: 'preventive',
        categoryId: schedule.categoryId ?? undefined,
        propertyId: schedule.propertyId,
        buildingId: schedule.buildingId ?? undefined,
        unitId: schedule.unitId ?? undefined,
        assetId: schedule.assetId ?? undefined,
        priority: 'medium',
        vendorId: schedule.vendorId ?? undefined,
        estimatedCost: Number(schedule.estimatedCost),
      },
      sla,
    );

    await tx.update(preventiveMaintenanceOccurrences).set({ workOrderId: created.id, updatedAt: new Date() }).where(eq(preventiveMaintenanceOccurrences.id, claimed[0].id));

    return { ...created, alreadyExisted: false };
  });
}

/**
 * Scans active preventive-maintenance schedules that are due and generates
 * (idempotently) one work order per due occurrence, advancing each
 * schedule's `nextDueDate` by its configured interval. Safe to call
 * repeatedly — e.g. from an automation/cron endpoint — since a schedule's
 * `nextDueDate` only advances after a genuinely new occurrence was created.
 */
export async function generateDuePreventiveWorkOrders(
  actor: MaintenanceActor,
): Promise<{ scanned: number; generated: number }> {
  const db = await getDb();
  const organizationId = actor.organizationId;
  const dueSchedules = await db
    .select({ id: preventiveMaintenanceSchedules.id, nextDueDate: preventiveMaintenanceSchedules.nextDueDate, intervalMonths: preventiveMaintenanceSchedules.intervalMonths })
    .from(preventiveMaintenanceSchedules)
    .where(and(eq(preventiveMaintenanceSchedules.organizationId, organizationId), eq(preventiveMaintenanceSchedules.isActive, true), sql`${preventiveMaintenanceSchedules.nextDueDate} <= current_date`))
    .limit(500);

  let generated = 0;
  for (const s of dueSchedules) {
    const result = await generateWorkOrderFromPreventive(actor, s.id, s.nextDueDate);
    if (!result.alreadyExisted) {
      generated += 1;
      const next = new Date(s.nextDueDate);
      next.setMonth(next.getMonth() + Math.max(1, s.intervalMonths));
      await db
        .update(preventiveMaintenanceSchedules)
        .set({ nextDueDate: next.toISOString().slice(0, 10), lastCompletedDate: s.nextDueDate, status: 'scheduled', updatedAt: new Date() })
        .where(eq(preventiveMaintenanceSchedules.id, s.id));
    }
  }
  return { scanned: dueSchedules.length, generated };
}

/* -------------------------------------------------------------------------- */
/* SLA breach notifications (idempotent runtime generation)                    */
/* -------------------------------------------------------------------------- */

/** Creates one `maintenance_sla_breach` notification per work order whose
 *  resolution SLA has elapsed while still open. Idempotent: a work order that
 *  already has such a notification is skipped. Intended for scheduled
 *  invocation; performs no unbounded work and no in-process timers. */
export async function generateSlaBreachNotifications(
  actor: { organizationId: string },
): Promise<{ scanned: number; notificationsCreated: number }> {
  const db = await getDb();
  const organizationId = actor.organizationId;
  const rows = await db
    .select({
      id: workOrders.id,
      code: workOrders.code,
      title: workOrders.title,
      createdAt: workOrders.createdAt,
      resolutionSlaHours: workOrders.resolutionSlaHours,
    })
    .from(workOrders)
    .where(
      and(
        eq(workOrders.organizationId, organizationId),
        inArray(workOrders.status, ['open', 'assigned', 'in_progress', 'pending']),
        isNull(workOrders.deletedAt),
      ),
    )
    .limit(500);

  const now = Date.now();
  let notificationsCreated = 0;
  for (const wo of rows) {
    const dueAt = wo.createdAt.getTime() + wo.resolutionSlaHours * 3_600_000;
    if (now <= dueAt) continue;
    const [existing] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.organizationId, organizationId),
          eq(notifications.notificationType, 'maintenance_sla_breach'),
          eq(notifications.entityType, 'work_order'),
          eq(notifications.entityId, wo.id),
        ),
      )
      .limit(1);
    if (existing) continue;
    await db.insert(notifications).values({
      organizationId,
      userId: null,
      requiredPermission: 'maintenance:view',
      notificationType: 'maintenance_sla_breach',
      severity: 'error',
      title: `Work order ${wo.code} breached its SLA`,
      body: `${wo.title} is past its resolution SLA target.`,
      linkHref: `/maintenance/${wo.id}`,
      entityType: 'work_order',
      entityId: wo.id,
    });
    notificationsCreated += 1;
  }
  return { scanned: rows.length, notificationsCreated };
}

/* -------------------------------------------------------------------------- */
/* Itemized maintenance checklists (Phase 19)                                  */
/*                                                                              */
/* Distinct from the Phase 17 contract-handover inspection (unitCondition +    */
/* documents): this is a reusable, templated pass/fail/NA checklist executed   */
/* against a work order, with an optional auto-created corrective work order   */
/* when a required item fails.                                                */
/* -------------------------------------------------------------------------- */

export interface ChecklistItemInput {
  key: string;
  labelEn: string;
  labelAr?: string;
  required?: boolean;
  createsCorrectiveOnFail?: boolean;
}

/** Creates a reusable checklist template (e.g. "HVAC quarterly inspection"). */
export async function createChecklistTemplate(
  actor: SessionUser,
  input: { code: string; nameEn: string; nameAr?: string; categoryId?: string; items: ChecklistItemInput[] },
): Promise<{ id: string }> {
  if (input.items.length === 0) throw validationError('A checklist template needs at least one item.');
  const keys = new Set<string>();
  for (const item of input.items) {
    if (!item.key || !item.labelEn) throw validationError('Every checklist item needs a key and a label.');
    if (keys.has(item.key)) throw validationError(`Duplicate checklist item key "${item.key}".`);
    keys.add(item.key);
  }
  const db = await getDb();
  return db.transaction(async (tx) => {
    if (input.categoryId) {
      const [c] = await tx
        .select({ id: maintenanceCategories.id })
        .from(maintenanceCategories)
        .where(and(eq(maintenanceCategories.id, input.categoryId), eq(maintenanceCategories.organizationId, actor.organizationId)))
        .limit(1);
      if (!c) throw validationError('The selected category is not valid for this organization.');
    }
    const [existing] = await tx
      .select({ id: maintenanceChecklistTemplates.id })
      .from(maintenanceChecklistTemplates)
      .where(and(eq(maintenanceChecklistTemplates.organizationId, actor.organizationId), eq(maintenanceChecklistTemplates.code, input.code)))
      .limit(1);
    if (existing) throw conflict(`A checklist template with code "${input.code}" already exists.`);

    const [created] = await tx
      .insert(maintenanceChecklistTemplates)
      .values({
        organizationId: actor.organizationId,
        code: input.code,
        nameEn: input.nameEn,
        nameAr: input.nameAr ?? null,
        categoryId: input.categoryId ?? null,
        items: input.items,
      })
      .returning({ id: maintenanceChecklistTemplates.id });

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'create',
      entityType: 'maintenance_checklist_template',
      entityId: created.id,
      entityLabel: input.nameEn,
      newValue: { code: input.code, itemCount: input.items.length },
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: created.id };
  });
}

export async function listChecklistTemplates(organizationId: string) {
  const db = await getDb();
  return db
    .select()
    .from(maintenanceChecklistTemplates)
    .where(and(eq(maintenanceChecklistTemplates.organizationId, organizationId), eq(maintenanceChecklistTemplates.isActive, true), isNull(maintenanceChecklistTemplates.deletedAt)))
    .orderBy(asc(maintenanceChecklistTemplates.nameEn));
}

export async function getWorkOrderChecklistResults(organizationId: string, workOrderId: string) {
  const db = await getDb();
  return db
    .select()
    .from(workOrderChecklistResults)
    .where(and(eq(workOrderChecklistResults.organizationId, organizationId), eq(workOrderChecklistResults.workOrderId, workOrderId)))
    .orderBy(asc(workOrderChecklistResults.completedAt));
}

/**
 * Records (or updates) one checklist item's result against a work order.
 * Upserted by `(workOrderId, templateId, itemKey)` — re-submitting the same
 * item never creates a duplicate row or a second corrective work order. A
 * failing item whose template definition sets `createsCorrectiveOnFail`
 * spawns exactly one linked corrective work order the first time it fails.
 */
export async function executeChecklistItem(
  actor: SessionUser,
  input: { workOrderId: string; templateId: string; itemKey: string; result: 'pass' | 'fail' | 'na'; notes?: string; documentId?: string },
): Promise<{ id: string; correctiveWorkOrderId: string | null }> {
  const db = await getDb();
  // Policy is read outside the transaction (PGlite single-connection safety) —
  // needed only if a corrective work order ends up being created below.
  const policy = await getPolicy(actor.organizationId);

  return db.transaction(async (tx) => {
    const [wo] = await tx
      .select({
        id: workOrders.id,
        code: workOrders.code,
        propertyId: workOrders.propertyId,
        buildingId: workOrders.buildingId,
        unitId: workOrders.unitId,
        assetId: workOrders.assetId,
        categoryId: workOrders.categoryId,
      })
      .from(workOrders)
      .where(and(eq(workOrders.id, input.workOrderId), eq(workOrders.organizationId, actor.organizationId), isNull(workOrders.deletedAt)))
      .limit(1);
    if (!wo) throw notFound('Work order', input.workOrderId);

    const [template] = await tx
      .select({ id: maintenanceChecklistTemplates.id, items: maintenanceChecklistTemplates.items })
      .from(maintenanceChecklistTemplates)
      .where(and(eq(maintenanceChecklistTemplates.id, input.templateId), eq(maintenanceChecklistTemplates.organizationId, actor.organizationId)))
      .limit(1);
    if (!template) throw notFound('Checklist template', input.templateId);
    const itemDef = template.items.find((i) => i.key === input.itemKey);
    if (!itemDef) throw validationError(`Unknown checklist item "${input.itemKey}" for this template.`);

    const [existing] = await tx
      .select({ id: workOrderChecklistResults.id, correctiveWorkOrderId: workOrderChecklistResults.correctiveWorkOrderId })
      .from(workOrderChecklistResults)
      .where(
        and(
          eq(workOrderChecklistResults.workOrderId, input.workOrderId),
          eq(workOrderChecklistResults.templateId, input.templateId),
          eq(workOrderChecklistResults.itemKey, input.itemKey),
        ),
      )
      .limit(1);

    let correctiveWorkOrderId: string | null = existing?.correctiveWorkOrderId ?? null;
    if (input.result === 'fail' && itemDef.createsCorrectiveOnFail && !correctiveWorkOrderId) {
      const sla = policy.maintenanceSlaByPriority.high ?? { responseHours: 8, resolutionHours: 24 };
      const corrective = await createWorkOrderInTx(
        tx,
        actor,
        {
          title: `Corrective: ${itemDef.labelEn} (from ${wo.code})`,
          description: `Auto-created from a failed checklist item "${itemDef.labelEn}" on work order ${wo.code}.`,
          maintenanceType: 'corrective',
          categoryId: wo.categoryId ?? undefined,
          propertyId: wo.propertyId,
          buildingId: wo.buildingId ?? undefined,
          unitId: wo.unitId ?? undefined,
          assetId: wo.assetId ?? undefined,
          priority: 'high',
        },
        sla,
      );
      correctiveWorkOrderId = corrective.id;
    }

    let resultId: string;
    if (existing) {
      await tx
        .update(workOrderChecklistResults)
        .set({
          result: input.result,
          notes: input.notes ?? null,
          documentId: input.documentId ?? null,
          correctiveWorkOrderId,
          completedByUserId: actor.id,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(workOrderChecklistResults.id, existing.id));
      resultId = existing.id;
    } else {
      const [created] = await tx
        .insert(workOrderChecklistResults)
        .values({
          organizationId: actor.organizationId,
          workOrderId: input.workOrderId,
          templateId: input.templateId,
          itemKey: input.itemKey,
          itemLabelEn: itemDef.labelEn,
          result: input.result,
          notes: input.notes ?? null,
          documentId: input.documentId ?? null,
          correctiveWorkOrderId,
          completedByUserId: actor.id,
        })
        .returning({ id: workOrderChecklistResults.id });
      resultId = created.id;
    }

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: existing ? 'update' : 'create',
      entityType: 'work_order_checklist_result',
      entityId: resultId,
      entityLabel: `${wo.code}: ${itemDef.labelEn}`,
      newValue: { result: input.result, correctiveWorkOrderId },
      actor: { id: actor.id, fullName: actor.fullName },
    });

    return { id: resultId, correctiveWorkOrderId };
  });
}

/* -------------------------------------------------------------------------- */
/* Read helpers for the operational UI                                         */
/* -------------------------------------------------------------------------- */

/** Change history for a work order, surfaced from the audit trail. */
export async function getWorkOrderHistory(organizationId: string, workOrderId: string) {
  const db = await getDb();
  return db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      actorLabel: auditLogs.actorLabel,
      previousValue: auditLogs.previousValue,
      newValue: auditLogs.newValue,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.entityType, 'work_order'), eq(auditLogs.entityId, workOrderId)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(50);
}

/** Organization-scoped options for the work-order create/edit/assign forms. */
export async function getWorkOrderFormReferenceData(organizationId: string) {
  const db = await getDb();
  const [propertyRows, unitRows, categoryRows, vendorRows, userRows] = await Promise.all([
    db.select({ id: properties.id, name: properties.nameEn }).from(properties).where(and(eq(properties.organizationId, organizationId), isNull(properties.deletedAt))).orderBy(asc(properties.nameEn)),
    db.select({ id: units.id, unitNumber: units.unitNumber, propertyId: units.propertyId }).from(units).where(and(eq(units.organizationId, organizationId), isNull(units.deletedAt))).orderBy(asc(units.unitNumber)),
    db.select({ id: maintenanceCategories.id, name: maintenanceCategories.nameEn }).from(maintenanceCategories).where(and(eq(maintenanceCategories.organizationId, organizationId), eq(maintenanceCategories.isActive, true))).orderBy(asc(maintenanceCategories.nameEn)),
    db.select({ id: vendors.id, name: vendors.nameEn }).from(vendors).where(and(eq(vendors.organizationId, organizationId), eq(vendors.isActive, true))).orderBy(asc(vendors.nameEn)),
    db.select({ id: users.id, name: users.fullName }).from(users).where(and(eq(users.organizationId, organizationId), eq(users.isActive, true), isNull(users.deletedAt))).orderBy(asc(users.fullName)),
  ]);
  return { properties: propertyRows, units: unitRows, categories: categoryRows, vendors: vendorRows, users: userRows };
}
