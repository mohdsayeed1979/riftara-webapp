import { requireApiPermission } from '@/lib/api/guard';
import { apiCreated, apiError, apiSuccess } from '@/lib/api/response';
import { AppError, validationError } from '@/lib/errors';
import { createScheduleSchema } from '@/lib/reports/schedule-input';
import { createSchedule, listSchedules } from '@/services/report-schedule-service';

export const dynamic = 'force-dynamic';

/** GET /api/v1/report-schedules — schedules for the caller's organization. */
export async function GET() {
  try {
    const principal = await requireApiPermission('reports:view');
    const schedules = await listSchedules(principal.organizationId);
    return apiSuccess({ schedules });
  } catch (error) {
    return apiError(error);
  }
}

/** POST /api/v1/report-schedules — create a scheduled report (BRD 117). */
export async function POST(request: Request) {
  try {
    const principal = await requireApiPermission('reports:create');
    if (!principal.userId) throw new AppError('FORBIDDEN', 'A user session is required to own a schedule.');

    const parsed = createScheduleSchema.safeParse(await request.json());
    if (!parsed.success) throw validationError('Invalid schedule request.', parsed.error.issues);

    const result = await createSchedule(
      { organizationId: principal.organizationId, id: principal.userId, fullName: principal.label },
      {
        ...parsed.data,
        config: {
          period: parsed.data.config.period,
          propertyId: parsed.data.config.propertyId ?? null,
          commentary: parsed.data.config.commentary ?? null,
        },
      },
    );
    return apiCreated(result);
  } catch (error) {
    return apiError(error);
  }
}
