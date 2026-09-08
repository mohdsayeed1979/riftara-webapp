import { requireApiPermission, enforceRateLimit } from '@/lib/api/guard';
import { apiError, apiSuccess } from '@/lib/api/response';
import { generateOverdueNotifications } from '@/services/collection-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/collections/notifications/run
 *
 * Idempotent runtime generation of overdue-invoice notifications. Marks newly
 * overdue invoices and creates one `payment_overdue` notification per invoice
 * (never duplicating). Designed to be invoked by a scheduler.
 *
 * Deployment: RIFTARA runs on Vercel, which has no always-on process. Wire a
 * Vercel Cron job (see `vercel.json` / dashboard) to POST this endpoint with an
 * API key that holds `collections:edit`, e.g. daily. No in-process timer is
 * created here; calling it repeatedly is safe.
 */
export async function POST() {
  try {
    const principal = await requireApiPermission('collections:edit');
    await enforceRateLimit(principal);
    const result = await generateOverdueNotifications({
      id: principal.userId,
      organizationId: principal.organizationId,
      fullName: principal.label,
    });
    return apiSuccess(result);
  } catch (error) {
    return apiError(error);
  }
}
