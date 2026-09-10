import { requireApiPermission } from '@/lib/api/guard';
import { apiError, apiSuccess } from '@/lib/api/response';
import { AppError, validationError } from '@/lib/errors';
import { updateScheduleSchema } from '@/lib/reports/schedule-input';
import { deleteSchedule, getSchedule, updateSchedule } from '@/services/report-schedule-service';

export const dynamic = 'force-dynamic';

/** GET /api/v1/report-schedules/:id — one schedule (org-scoped). */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireApiPermission('reports:view');
    const { id } = await context.params;
    const schedule = await getSchedule(principal.organizationId, id);
    return apiSuccess({ schedule });
  } catch (error) {
    return apiError(error);
  }
}

/** PATCH /api/v1/report-schedules/:id — edit or enable/disable a schedule. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireApiPermission('reports:create');
    if (!principal.userId) throw new AppError('FORBIDDEN', 'A user session is required.');
    const { id } = await context.params;

    const parsed = updateScheduleSchema.safeParse(await request.json());
    if (!parsed.success) throw validationError('Invalid schedule update.', parsed.error.issues);

    const { config, ...rest } = parsed.data;
    const result = await updateSchedule(
      { organizationId: principal.organizationId, id: principal.userId, fullName: principal.label },
      id,
      {
        ...rest,
        config: config
          ? { period: config.period, propertyId: config.propertyId ?? null, commentary: config.commentary ?? null }
          : undefined,
      },
    );
    return apiSuccess(result);
  } catch (error) {
    return apiError(error);
  }
}

/** DELETE /api/v1/report-schedules/:id — soft-delete (deactivate) a schedule. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireApiPermission('reports:create');
    if (!principal.userId) throw new AppError('FORBIDDEN', 'A user session is required.');
    const { id } = await context.params;
    const result = await deleteSchedule(
      { organizationId: principal.organizationId, id: principal.userId, fullName: principal.label },
      id,
    );
    return apiSuccess(result);
  } catch (error) {
    return apiError(error);
  }
}
