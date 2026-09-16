import { apiError, apiSuccess } from '@/lib/api/response';
import { requireApiPermission } from '@/lib/api/guard';
import { listIntegrations } from '@/services/integration-service';
import { getQueueSummary } from '@/integrations/erp/erp-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/integrations/erp
 *
 * ERP connection status (never fabricated — derived the same way as every
 * other Integration Hub connector) plus the outbox queue summary.
 */
export async function GET() {
  try {
    const principal = await requireApiPermission('erp_integration:view');
    const integrations = await listIntegrations(principal.organizationId);
    const erp = integrations.find((i) => i.key === 'dynamics_ax2012') ?? null;
    const queue = await getQueueSummary(principal.organizationId);
    return apiSuccess({ integration: erp, queue });
  } catch (error) {
    return apiError(error);
  }
}
