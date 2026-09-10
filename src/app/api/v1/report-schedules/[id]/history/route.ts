import { requireApiPermission } from '@/lib/api/guard';
import { apiError, apiSuccess } from '@/lib/api/response';
import { listScheduleHistory } from '@/services/report-schedule-service';

export const dynamic = 'force-dynamic';

/** GET /api/v1/report-schedules/:id/history — execution history (success & failure). */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireApiPermission('reports:view');
    const { id } = await context.params;
    const history = await listScheduleHistory(principal.organizationId, id);
    return apiSuccess({ history });
  } catch (error) {
    return apiError(error);
  }
}
