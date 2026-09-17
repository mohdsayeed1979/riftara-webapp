import { authenticateRequest, enforceRateLimit } from '@/lib/api/guard';
import { apiError, apiSuccess } from '@/lib/api/response';
import { AppError } from '@/lib/errors';
import { isUuid } from '@/lib/utils';
import { getImportBatch } from '@/services/import-service';

export const dynamic = 'force-dynamic';

/** GET /api/v1/import/history/[id] — one import batch's detail. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await authenticateRequest();
    if (!principal.permissions.includes('properties:manage') && !principal.permissions.includes('units:manage')) {
      throw new AppError('FORBIDDEN', 'Missing required permission: properties:manage or units:manage');
    }
    await enforceRateLimit(principal);
    const { id } = await params;
    if (!isUuid(id)) throw new AppError('NOT_FOUND', 'Import batch not found.');
    const batch = await getImportBatch(principal.organizationId, id);
    return apiSuccess(batch);
  } catch (error) {
    return apiError(error);
  }
}
