import { apiError, apiSuccess } from '@/lib/api/response';
import { requireApiPermission } from '@/lib/api/guard';
import { AppError } from '@/lib/errors';
import { retryEvent } from '@/integrations/erp/erp-service';
import { isUuid } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/** POST /api/v1/integrations/erp/events/[id]/retry */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireApiPermission('erp_integration:retry');
    const { id } = await params;
    if (!isUuid(id)) throw new AppError('NOT_FOUND', 'ERP integration event was not found.');
    await retryEvent({ id: principal.userId, organizationId: principal.organizationId, fullName: principal.label }, id);
    return apiSuccess({ id, status: 'pending' });
  } catch (error) {
    return apiError(error);
  }
}
