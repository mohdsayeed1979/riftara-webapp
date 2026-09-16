import { apiError, apiSuccess } from '@/lib/api/response';
import { requireApiPermission } from '@/lib/api/guard';
import { AppError } from '@/lib/errors';
import { getErpEvent } from '@/integrations/erp/erp-service';
import { isUuid } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/** GET /api/v1/integrations/erp/events/[id] */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireApiPermission('erp_integration:view');
    const { id } = await params;
    if (!isUuid(id)) throw new AppError('NOT_FOUND', 'ERP integration event was not found.');
    const event = await getErpEvent(principal.organizationId, id);
    if (!event) throw new AppError('NOT_FOUND', 'ERP integration event was not found.');
    return apiSuccess(event);
  } catch (error) {
    return apiError(error);
  }
}
