import { requireApiPermission } from '@/lib/api/guard';
import { apiError, apiSuccess } from '@/lib/api/response';
import { loadSessionUser } from '@/lib/auth/session';
import { AppError } from '@/lib/errors';
import { runScheduleNow } from '@/services/report-schedule-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/report-schedules/:id/run — run a schedule immediately. The report
 * is generated with the caller's own live permissions and data scope; it does
 * not change the schedule's next scheduled occurrence.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireApiPermission('reports:create');
    if (!principal.userId) throw new AppError('FORBIDDEN', 'A user session is required.');
    const caller = await loadSessionUser(principal.userId);
    if (!caller) throw new AppError('UNAUTHENTICATED', 'Session could not be resolved.');
    const { id } = await context.params;
    const result = await runScheduleNow(caller, id);
    return apiSuccess(result);
  } catch (error) {
    return apiError(error);
  }
}
