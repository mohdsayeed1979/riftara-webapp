import type { NextRequest } from 'next/server';
import { authenticateRequest, enforceRateLimit } from '@/lib/api/guard';
import { apiError, apiSuccess } from '@/lib/api/response';
import { globalSearch } from '@/services/search-service';

export const dynamic = 'force-dynamic';

/** GET /api/v1/search?q=... — grouped global search (BRD 131). */
export async function GET(request: NextRequest) {
  try {
    const principal = await authenticateRequest();
    await enforceRateLimit(principal);

    const query = request.nextUrl.searchParams.get('q') ?? '';
    const groups = await globalSearch(query, {
      organizationId: principal.organizationId,
      permissions: principal.permissions,
      allowedPropertyIds:
        principal.scopedPropertyIds.length > 0 ? principal.scopedPropertyIds : null,
      limitPerGroup: Number(request.nextUrl.searchParams.get('limit')) || 5,
    });

    return apiSuccess(groups, { query, groupCount: groups.length });
  } catch (error) {
    return apiError(error);
  }
}
