import { requireApiPermission, enforceRateLimit } from '@/lib/api/guard';
import { apiError, apiSuccess } from '@/lib/api/response';
import { generateSlaBreachNotifications } from '@/services/maintenance-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/maintenance/sla/run
 *
 * Idempotent runtime generation of maintenance SLA-breach notifications: one
 * `maintenance_sla_breach` notification per open work order past its resolution
 * SLA, never duplicated. Designed to be driven by a scheduler.
 *
 * Deployment: RIFTARA runs on Vercel (no always-on process). Wire a Vercel Cron
 * job to POST this endpoint with an API key holding `maintenance:edit`. No
 * in-process timer is created; repeated calls are safe.
 */
export async function POST() {
  try {
    const principal = await requireApiPermission('maintenance:edit');
    await enforceRateLimit(principal);
    const result = await generateSlaBreachNotifications({ organizationId: principal.organizationId });
    return apiSuccess(result);
  } catch (error) {
    return apiError(error);
  }
}
