import type { NextRequest } from 'next/server';
import { apiError, apiSuccess, pageMeta, readPagination } from '@/lib/api/response';
import { requireApiPermission } from '@/lib/api/guard';
import { AppError } from '@/lib/errors';
import { listErpEvents, type ErpEventListFilters } from '@/integrations/erp/erp-service';
import type { ErpEventStatus } from '@/integrations/erp/erp-types';

export const dynamic = 'force-dynamic';

const VALID_STATUSES: ErpEventStatus[] = ['pending', 'processing', 'succeeded', 'failed', 'retrying', 'dead_letter'];

/** GET /api/v1/integrations/erp/events?status=&page=&pageSize= */
export async function GET(request: NextRequest) {
  try {
    const principal = await requireApiPermission('erp_integration:view');
    const { page, pageSize } = readPagination(request.nextUrl.searchParams, { pageSize: 25, maxPageSize: 100 });
    const statusParam = request.nextUrl.searchParams.get('status');
    if (statusParam && !VALID_STATUSES.includes(statusParam as ErpEventStatus)) {
      throw new AppError('VALIDATION', 'Unknown event status filter.', { status: 400 });
    }

    const filters: ErpEventListFilters = {
      organizationId: principal.organizationId,
      status: (statusParam as ErpEventStatus | null) ?? undefined,
      page,
      pageSize,
    };
    const result = await listErpEvents(filters);
    return apiSuccess(result.items, { ...pageMeta(result.page, result.pageSize, result.total) });
  } catch (error) {
    return apiError(error);
  }
}
