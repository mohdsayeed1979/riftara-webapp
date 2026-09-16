import { apiError, apiSuccess } from '@/lib/api/response';
import { requireApiPermission } from '@/lib/api/guard';
import { processPendingEvents } from '@/integrations/erp/erp-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/integrations/erp/process
 *
 * Manual/admin-triggered outbox processing. In production this would be
 * called by a dedicated scheduled worker once a processing frequency is
 * approved (see docs/PHASE_18_ERP_INTEGRATION.md §21) — it is deliberately
 * NOT wired into the daily notification cron, since ERP delivery latency
 * requirements differ. This endpoint makes the same logic available for
 * local testing and manual operator use today.
 */
export async function POST() {
  try {
    const principal = await requireApiPermission('erp_integration:manage');
    const result = await processPendingEvents({ id: principal.userId, organizationId: principal.organizationId, fullName: principal.label });
    return apiSuccess(result);
  } catch (error) {
    return apiError(error);
  }
}
