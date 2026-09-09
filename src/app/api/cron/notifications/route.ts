import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/api/response';
import { AppError } from '@/lib/errors';
import { generateAllNotificationsForAllOrganizations } from '@/services/notification-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/notifications — scheduled automation entry point.
 *
 * Invoked by Vercel Cron (see `vercel.json`). Vercel Cron sends a GET request
 * and, when `CRON_SECRET` is configured, includes it as `Authorization: Bearer
 * <CRON_SECRET>`. This handler authenticates against that secret and runs the
 * idempotent notification generators for every organization.
 *
 * The endpoint is NOT public: it fails closed if `CRON_SECRET` is unset or the
 * bearer token does not match. The secret is provided by the deployment
 * environment and is never committed to source control.
 */
function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed — no secret configured
  const header = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  try {
    if (!authorized(request)) throw new AppError('UNAUTHENTICATED', 'Invalid or missing cron credentials.', { status: 401 });
    const result = await generateAllNotificationsForAllOrganizations();
    return apiSuccess(result);
  } catch (error) {
    return apiError(error);
  }
}
