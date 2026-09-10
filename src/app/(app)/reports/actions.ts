'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/guard';
import { actionFailure, actionSuccess, type ActionResult } from '@/lib/errors';
import { createScheduleSchema, updateScheduleSchema } from '@/lib/reports/schedule-input';
import { isUuid } from '@/lib/utils';
import type { SessionUser } from '@/lib/auth/session';
import {
  createSchedule,
  deleteSchedule,
  listScheduleHistory,
  runScheduleNow,
  setScheduleActive,
  updateSchedule,
  type ScheduleActor,
} from '@/services/report-schedule-service';

function toActor(user: SessionUser): ScheduleActor {
  return { organizationId: user.organizationId, id: user.id, fullName: user.fullName };
}

export async function createScheduleAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission('reports:create');
    const parsed = createScheduleSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' } };
    const result = await createSchedule(toActor(user), {
      ...parsed.data,
      config: {
        period: parsed.data.config.period,
        propertyId: parsed.data.config.propertyId ?? null,
        commentary: parsed.data.config.commentary ?? null,
      },
    });
    revalidatePath('/reports');
    return actionSuccess({ id: result.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateScheduleAction(id: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    if (!isUuid(id)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Schedule not found.' } };
    const user = await requirePermission('reports:create');
    const parsed = updateScheduleSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' } };
    const { config, ...rest } = parsed.data;
    const result = await updateSchedule(toActor(user), id, {
      ...rest,
      config: config
        ? { period: config.period, propertyId: config.propertyId ?? null, commentary: config.commentary ?? null }
        : undefined,
    });
    revalidatePath('/reports');
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function setScheduleActiveAction(id: string, isActive: boolean): Promise<ActionResult<{ id: string; isActive: boolean }>> {
  try {
    if (!isUuid(id)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Schedule not found.' } };
    const user = await requirePermission('reports:create');
    const result = await setScheduleActive(toActor(user), id, isActive);
    revalidatePath('/reports');
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function deleteScheduleAction(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    if (!isUuid(id)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Schedule not found.' } };
    const user = await requirePermission('reports:create');
    const result = await deleteSchedule(toActor(user), id);
    revalidatePath('/reports');
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function runScheduleNowAction(id: string): Promise<ActionResult<{ status: 'success' | 'failed'; reportRunId: string | null }>> {
  try {
    if (!isUuid(id)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Schedule not found.' } };
    const user = await requirePermission('reports:create');
    const result = await runScheduleNow(user, id);
    revalidatePath('/reports');
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function getScheduleHistoryAction(id: string): Promise<ActionResult<Awaited<ReturnType<typeof listScheduleHistory>>>> {
  try {
    if (!isUuid(id)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Schedule not found.' } };
    const user = await requirePermission('reports:view');
    const history = await listScheduleHistory(user.organizationId, id);
    return actionSuccess(history);
  } catch (error) {
    return actionFailure(error);
  }
}
