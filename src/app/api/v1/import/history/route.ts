import { authenticateRequest, enforceRateLimit } from '@/lib/api/guard';
import { apiError, apiSuccess } from '@/lib/api/response';
import { AppError } from '@/lib/errors';
import { listImportBatches } from '@/services/import-service';

export const dynamic = 'force-dynamic';

/** GET /api/v1/import/history — recent bulk-import batches for this organization.
 *  Visible to anyone holding either properties:manage or units:manage. */
export async function GET() {
  try {
    const principal = await authenticateRequest();
    if (!principal.permissions.includes('properties:manage') && !principal.permissions.includes('units:manage')) {
      throw new AppError('FORBIDDEN', 'Missing required permission: properties:manage or units:manage');
    }
    await enforceRateLimit(principal);
    const batches = await listImportBatches(principal.organizationId);
    return apiSuccess({ items: batches });
  } catch (error) {
    return apiError(error);
  }
}
