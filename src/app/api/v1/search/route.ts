import type { NextRequest } from 'next/server';
import { authenticateRequest, enforceRateLimit } from '@/lib/api/guard';
import { apiError, apiSuccess } from '@/lib/api/response';
import { AppError } from '@/lib/errors';
import { globalSearch, isSearchEntityType, searchFlat, MAX_QUERY_LENGTH } from '@/services/search-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/search?q=...
 *   default            → grouped results (backward compatible with the search bar)
 *   &format=flat       → normalized, ranked, paginated results (results page/API)
 *                        supports &type=<entity> &page=<n> &limit=<n>
 *
 * Every result is authorized server-side (organization, RBAC, data scope, and
 * document confidentiality). Query parameters are validated and bounded.
 */
export async function GET(request: NextRequest) {
  try {
    const principal = await authenticateRequest();
    await enforceRateLimit(principal);

    const params = request.nextUrl.searchParams;
    const query = params.get('q') ?? '';
    if (query.length > MAX_QUERY_LENGTH) {
      throw new AppError('VALIDATION', `Search query must be ${MAX_QUERY_LENGTH} characters or fewer.`, { status: 400 });
    }

    const context = {
      organizationId: principal.organizationId,
      permissions: principal.permissions,
      allowedPropertyIds: principal.scopedPropertyIds.length > 0 ? principal.scopedPropertyIds : null,
    };

    if (params.get('format') === 'flat') {
      const typeParam = params.get('type');
      if (typeParam && !isSearchEntityType(typeParam)) {
        throw new AppError('VALIDATION', 'Unknown search filter.', { status: 400 });
      }
      const result = await searchFlat(query, context, {
        type: typeParam && isSearchEntityType(typeParam) ? typeParam : null,
        page: Number(params.get('page')) || 1,
        pageSize: Number(params.get('limit')) || 20,
      });
      return apiSuccess(result);
    }

    const groups = await globalSearch(query, context, {
      limitPerGroup: Number(params.get('limit')) || 5,
    });
    return apiSuccess(groups, { query, groupCount: groups.length });
  } catch (error) {
    return apiError(error);
  }
}
