'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/guard';
import { actionFailure, actionSuccess, type ActionResult } from '@/lib/errors';
import { notifyHandoverCompleted, notifyHandoverReady } from '@/services/notification-service';
import {
  approveHandover,
  completeHandover,
  getHandover,
  initiateHandover,
  updateHandoverChecklist,
  updateHandoverCondition,
} from '@/services/handover-service';

function opt(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t === '' ? undefined : t;
}
function bool(value: FormDataEntryValue | null): boolean {
  return value === 'on' || value === 'true';
}
function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const fe: Record<string, string[]> = {};
  for (const issue of error.issues) (fe[String(issue.path[0] ?? '_form')] ??= []).push(issue.message);
  return fe;
}

export async function startHandoverAction(
  contractId: string,
  handoverType: 'handover' | 'move_out',
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission('handovers:create');
    const result = await initiateHandover(user, { contractId, handoverType });
    revalidatePath('/handovers');
    revalidatePath(`/contracts/${contractId}`);
    return actionSuccess({ id: result.id });
  } catch (error) {
    return actionFailure(error);
  }
}

const checklistSchema = z.object({
  contractSigned: z.coerce.boolean().optional(),
  paymentReceived: z.coerce.boolean().optional(),
  depositReceived: z.coerce.boolean().optional(),
  unitReady: z.coerce.boolean().optional(),
  keysHandedOver: z.coerce.number().int().min(0).optional(),
  accessCards: z.coerce.number().int().min(0).optional(),
  parkingCards: z.coerce.number().int().min(0).optional(),
  electricityMeterReading: z.string().trim().max(32).optional(),
  waterMeterReading: z.string().trim().max(32).optional(),
});

export async function updateHandoverChecklistAction(
  handoverId: string,
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const user = await requirePermission('handovers:edit');
    const parsed = checklistSchema.safeParse({
      contractSigned: bool(formData.get('contractSigned')),
      paymentReceived: bool(formData.get('paymentReceived')),
      depositReceived: bool(formData.get('depositReceived')),
      unitReady: bool(formData.get('unitReady')),
      keysHandedOver: opt(formData.get('keysHandedOver')),
      accessCards: opt(formData.get('accessCards')),
      parkingCards: opt(formData.get('parkingCards')),
      electricityMeterReading: opt(formData.get('electricityMeterReading')),
      waterMeterReading: opt(formData.get('waterMeterReading')),
    });
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    }
    await updateHandoverChecklist(user, handoverId, parsed.data);
    revalidatePath(`/handovers/${handoverId}`);
    return actionSuccess(null);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateHandoverConditionAction(
  handoverId: string,
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const user = await requirePermission('handovers:edit');
    await updateHandoverCondition(user, handoverId, {
      unitCondition: opt(formData.get('unitCondition')),
      notes: opt(formData.get('notes')),
    });
    revalidatePath(`/handovers/${handoverId}`);
    return actionSuccess(null);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function approveHandoverAction(handoverId: string, notes?: string): Promise<ActionResult<null>> {
  try {
    const user = await requirePermission('handovers:approve');
    await approveHandover(user, handoverId, notes);
    const handover = await getHandover(user.organizationId, handoverId);
    if (handover) await notifyHandoverReady(user.organizationId, handoverId, handover.contractNumber);
    revalidatePath(`/handovers/${handoverId}`);
    return actionSuccess(null);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function completeHandoverAction(handoverId: string): Promise<ActionResult<{ unitReleased: boolean }>> {
  try {
    const user = await requirePermission('handovers:edit');
    const result = await completeHandover(user, handoverId);
    const handover = await getHandover(user.organizationId, handoverId);
    if (handover) await notifyHandoverCompleted(user.organizationId, handoverId, handover.contractNumber);
    revalidatePath(`/handovers/${handoverId}`);
    revalidatePath('/handovers');
    revalidatePath('/units');
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}
