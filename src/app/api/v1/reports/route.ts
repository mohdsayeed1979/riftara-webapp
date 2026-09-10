import { requireApiPermission } from '@/lib/api/guard';
import { apiError, apiSuccess } from '@/lib/api/response';
import { REPORT_CATALOG, REPORT_FREQUENCIES, REPORT_PERIODS } from '@/lib/reports/catalog';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/reports — the report catalog (BRD 112). Lists the report types the
 * platform can generate and schedule, plus the supported frequencies and
 * reporting periods. Reuses the existing executive report definitions; no
 * duplicate report types are introduced.
 */
export async function GET() {
  try {
    await requireApiPermission('reports:view');
    return apiSuccess({
      reports: REPORT_CATALOG,
      frequencies: REPORT_FREQUENCIES,
      periods: REPORT_PERIODS,
    });
  } catch (error) {
    return apiError(error);
  }
}
