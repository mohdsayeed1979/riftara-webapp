'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/guard';
import { actionFailure, actionSuccess, type ActionResult } from '@/lib/errors';
import { isUuid } from '@/lib/utils';
import {
  assignWorkOrder,
  createWorkOrder,
  generateSlaBreachNotifications,
  generateWorkOrderFromPreventive,
  recordMaintenanceCost,
  transitionWorkOrderStatus,
  updateWorkOrder,
  type WorkOrderStatus,
} from '@/services/maintenance-service';

const MAINTENANCE_TYPES = ['preventive', 'corrective', 'emergency', 'inspection', 'renovation', 'unit_turnaround'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
const STATUSES = ['open', 'assigned', 'in_progress', 'pending', 'completed', 'cancelled'] as const;

function opt(v: FormDataEntryValue | null): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

const optUuid = z.string().uuid('Select a valid option.').optional();

const writeSchema = z.object({
  title: z.string().trim().min(1, 'Enter a title.').max(200),
  description: z.string().trim().max(5000).optional(),
  maintenanceType: z.enum(MAINTENANCE_TYPES),
  categoryId: optUuid,
  propertyId: z.string().uuid('Select a property.'),
  unitId: optUuid,
  tenantId: optUuid,
  priority: z.enum(PRIORITIES),
  vendorId: optUuid,
  assignedUserId: optUuid,
  estimatedCost: z.coerce.number().nonnegative('Must be zero or more.').optional(),
});

export interface WorkOrderActionResult {
  id: string;
  code?: string;
}

function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const fe: Record<string, string[]> = {};
  for (const issue of error.issues) (fe[String(issue.path[0] ?? '_form')] ??= []).push(issue.message);
  return fe;
}

function readWriteForm(formData: FormData) {
  const g = (k: string) => opt(formData.get(k));
  return {
    title: g('title'),
    description: g('description'),
    maintenanceType: g('maintenanceType'),
    categoryId: g('categoryId'),
    propertyId: g('propertyId'),
    unitId: g('unitId'),
    tenantId: g('tenantId'),
    priority: g('priority'),
    vendorId: g('vendorId'),
    assignedUserId: g('assignedUserId'),
    estimatedCost: g('estimatedCost'),
  };
}

export async function createWorkOrderAction(
  _prev: ActionResult<WorkOrderActionResult> | null,
  formData: FormData,
): Promise<ActionResult<WorkOrderActionResult>> {
  try {
    const user = await requirePermission('maintenance:create');
    const parsed = writeSchema.safeParse(readWriteForm(formData));
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    }
    const result = await createWorkOrder(user, parsed.data);
    try { revalidatePath('/maintenance'); revalidatePath('/dashboard'); } catch { /* cache hint */ }
    return actionSuccess({ id: result.id, code: result.code });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateWorkOrderAction(
  workOrderId: string,
  _prev: ActionResult<WorkOrderActionResult> | null,
  formData: FormData,
): Promise<ActionResult<WorkOrderActionResult>> {
  try {
    if (!isUuid(workOrderId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Work order not found.' } };
    const user = await requirePermission('maintenance:edit');
    const parsed = writeSchema
      .omit({ propertyId: true, vendorId: true, assignedUserId: true })
      .extend({ resolutionNotes: z.string().trim().max(5000).optional() })
      .safeParse({ ...readWriteForm(formData), resolutionNotes: opt(formData.get('resolutionNotes')) });
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    }
    const result = await updateWorkOrder(user, workOrderId, parsed.data);
    try { revalidatePath('/maintenance'); revalidatePath(`/maintenance/${workOrderId}`); } catch { /* cache hint */ }
    return actionSuccess({ id: result.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function assignWorkOrderAction(
  workOrderId: string,
  input: { vendorId?: string | null; assignedUserId?: string | null },
): Promise<ActionResult<{ id: string; status: string }>> {
  try {
    if (!isUuid(workOrderId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Work order not found.' } };
    const user = await requirePermission('maintenance:edit');
    const vendorId = input.vendorId && isUuid(input.vendorId) ? input.vendorId : input.vendorId === null || input.vendorId === '' ? null : undefined;
    const assignedUserId = input.assignedUserId && isUuid(input.assignedUserId) ? input.assignedUserId : input.assignedUserId === null || input.assignedUserId === '' ? null : undefined;
    const result = await assignWorkOrder(user, workOrderId, { vendorId, assignedUserId });
    try { revalidatePath(`/maintenance/${workOrderId}`); revalidatePath('/maintenance'); } catch { /* cache hint */ }
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function transitionWorkOrderStatusAction(
  workOrderId: string,
  toStatus: string,
): Promise<ActionResult<{ id: string; status: string }>> {
  try {
    if (!isUuid(workOrderId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Work order not found.' } };
    if (!STATUSES.includes(toStatus as (typeof STATUSES)[number])) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Invalid status.' } };
    }
    const user = await requirePermission('maintenance:edit');
    const result = await transitionWorkOrderStatus(user, workOrderId, toStatus as WorkOrderStatus);
    try { revalidatePath(`/maintenance/${workOrderId}`); revalidatePath('/maintenance'); revalidatePath('/dashboard'); } catch { /* cache hint */ }
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

const costSchema = z.object({
  workOrderId: z.string().uuid('Select a work order.'),
  amount: z.coerce.number().positive('Enter an amount greater than zero.'),
  description: z.string().trim().min(1, 'Enter a description.').max(240),
  incurredOn: z.string().min(1, 'Select a date.'),
  costType: z.string().trim().max(24).optional(),
  invoiceNumber: z.string().trim().max(60).optional(),
});

export async function recordMaintenanceCostAction(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission('maintenance:create');
    const parsed = costSchema.safeParse({
      workOrderId: opt(formData.get('workOrderId')),
      amount: opt(formData.get('amount')),
      description: opt(formData.get('description')),
      incurredOn: opt(formData.get('incurredOn')),
      costType: opt(formData.get('costType')),
      invoiceNumber: opt(formData.get('invoiceNumber')),
    });
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    }
    const result = await recordMaintenanceCost(user, parsed.data);
    try { revalidatePath(`/maintenance/${parsed.data.workOrderId}`); revalidatePath('/maintenance'); revalidatePath('/financials'); revalidatePath('/dashboard'); } catch { /* cache hint */ }
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function generateWorkOrderFromPreventiveAction(
  scheduleId: string,
): Promise<ActionResult<{ id: string; code: string; alreadyExisted: boolean }>> {
  try {
    if (!isUuid(scheduleId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Schedule not found.' } };
    const user = await requirePermission('maintenance:create');
    const result = await generateWorkOrderFromPreventive(user, scheduleId);
    try { revalidatePath('/maintenance'); } catch { /* cache hint */ }
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

/** In-app trigger for the idempotent SLA-breach notification run (also exposed
 *  as POST /api/v1/maintenance/sla/run for scheduled invocation). */
export async function runSlaBreachNotificationsAction(): Promise<ActionResult<{ scanned: number; notificationsCreated: number }>> {
  try {
    const user = await requirePermission('maintenance:edit');
    const result = await generateSlaBreachNotifications({ organizationId: user.organizationId });
    try { revalidatePath('/maintenance'); } catch { /* cache hint */ }
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}
