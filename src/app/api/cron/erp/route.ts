import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/api/response';
import { AppError } from '@/lib/errors';
import { processPendingEventsForAllOrganizations } from '@/integrations/erp/erp-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/erp — scheduled ERP outbox processing.
 *
 * Same `CRON_SECRET` bearer-auth pattern as /api/cron/notifications — fails
 * closed if the secret is unset or doesn't match. Deliberately a SEPARATE
 * route from the daily notification cron: ERP delivery latency requirements
 * are different from once-a-day notification generation, and coupling them
 * would force both onto the same schedule. This route is NOT yet registered
 * in vercel.json — the processing frequency (and whether the hosting plan
 * even supports sub-daily cron) is an open production decision. See
 * docs/PHASE_18_ERP_INTEGRATION.md §21. Until it's wired up, use
 * POST /api/v1/integrations/erp/process for manual/local processing.
 */
function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  try {
    if (!authorized(request)) throw new AppError('UNAUTHENTICATED', 'Invalid or missing cron credentials.', { status: 401 });
    const result = await processPendingEventsForAllOrganizations();
    return apiSuccess(result);
  } catch (error) {
    return apiError(error);
  }
}
