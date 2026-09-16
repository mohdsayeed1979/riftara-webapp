import { apiError, apiSuccess } from '@/lib/api/response';
import { requireApiPermission } from '@/lib/api/guard';
import { reconcile } from '@/integrations/erp/erp-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/integrations/erp/reconcile
 *
 * Reads the outbox's own recorded state (sent / accepted / rejected /
 * unmatched) — never fabricates an AX-side result.
 */
export async function POST() {
  try {
    const principal = await requireApiPermission('erp_integration:reconcile');
    const report = await reconcile({ id: principal.userId, organizationId: principal.organizationId, fullName: principal.label });
    return apiSuccess(report);
  } catch (error) {
    return apiError(error);
  }
}
