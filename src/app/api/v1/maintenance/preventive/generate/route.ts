import { requireApiPermission, enforceRateLimit } from '@/lib/api/guard';
import { apiError, apiSuccess } from '@/lib/api/response';
import { generateDuePreventiveWorkOrders } from '@/services/maintenance-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/maintenance/preventive/generate
 *
 * Idempotent runtime generation of work orders for due preventive-maintenance
 * occurrences. Safe to call repeatedly or concurrently: a `(scheduleId,
 * occurrenceDate)` unique constraint guarantees exactly one work order per
 * occurrence no matter how many times this endpoint runs.
 *
 * Deployment: RIFTARA runs on Vercel (no always-on process). This endpoint is
 * designed to be driven by a scheduler (e.g. Vercel Cron) with an API key
 * holding `maintenance:manage`; no in-process timer is created here.
 */
export async function POST() {
  try {
    const principal = await requireApiPermission('maintenance:manage');
    await enforceRateLimit(principal);
    const result = await generateDuePreventiveWorkOrders({
      id: principal.userId,
      organizationId: principal.organizationId,
      fullName: principal.label,
      permissions: principal.permissions,
    });
    return apiSuccess(result);
  } catch (error) {
    return apiError(error);
  }
}
