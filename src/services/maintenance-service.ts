import 'server-only';
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  maintenanceCategories,
  maintenanceCosts,
  preventiveMaintenanceSchedules,
  properties,
  units,
  vendors,
  workOrders,
} from '@/db/schema';
import { recordAudit } from '@/lib/audit';
import { notFound } from '@/lib/errors';
import { round2 } from '@/lib/utils';
import type { SessionUser } from '@/lib/auth/session';

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
      categoryName: maintenanceCategories.nameEn,
      vendorName: vendors.nameEn,
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
      createdAt: workOrders.createdAt,
      completedAt: workOrders.completedAt,
    })
    .from(workOrders)
    .innerJoin(properties, eq(properties.id, workOrders.propertyId))
    .leftJoin(units, eq(units.id, workOrders.unitId))
    .leftJoin(maintenanceCategories, eq(maintenanceCategories.id, workOrders.categoryId))
    .leftJoin(vendors, eq(vendors.id, workOrders.vendorId))
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
  unitId?: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  vendorId?: string;
  estimatedCost?: number;
}

export async function createWorkOrder(
  actor: SessionUser,
  input: CreateWorkOrderInput,
): Promise<{ id: string; code: string }> {
  const db = await getDb();
  const { getPolicy } = await import('@/lib/settings');
  const policy = await getPolicy(actor.organizationId);
  const sla = policy.maintenanceSlaByPriority[input.priority] ?? { responseHours: 24, resolutionHours: 72 };

  return db.transaction(async (tx) => {
    const [{ total }] = await tx
      .select({ total: count() })
      .from(workOrders)
      .where(eq(workOrders.organizationId, actor.organizationId));
    const code = `WO-${String(Number(total) + 1).padStart(5, '0')}`;

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
        unitId: input.unitId ?? null,
        priority: input.priority,
        status: 'open',
        vendorId: input.vendorId ?? null,
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
      newValue: { title: input.title, priority: input.priority },
      actor: { id: actor.id, fullName: actor.fullName },
    });

    return { id: created.id, code };
  });
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
  },
): Promise<{ id: string }> {
  const db = await getDb();
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
      newValue: { amount: input.amount },
      actor: { id: actor.id, fullName: actor.fullName },
    });

    return { id: cost.id };
  });
}
