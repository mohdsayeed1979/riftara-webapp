import { requireApiPermission, enforceRateLimit } from '@/lib/api/guard';
import { apiError, apiSuccess } from '@/lib/api/response';
import { generateAllNotifications } from '@/services/notification-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/notifications/run
 *
 * Runs every runtime notification generator (contract/reservation expiry,
 * preventive-maintenance due, lead follow-up/uncontacted, renewal, overdue
 * invoices, SLA breach) plus the reservation-expiry job (BR-011) for the
 * authenticated organization. All generators are idempotent, so repeated calls
 * are safe.
 *
 * Authentication: the standard API model — requires an API key (or session)
 * holding `settings:manage`. There is no public/unauthenticated path.
 *
 * Deployment: RIFTARA runs on Vercel (no always-on process). A Vercel Cron job
 * POSTs this endpoint hourly with an API key that holds `settings:manage`
 * (see `vercel.json`). The API key value is configured in the deployment
 * environment and is never committed to source control.
 */
export async function POST() {
  try {
    const principal = await requireApiPermission('settings:manage');
    await enforceRateLimit(principal);
    const result = await generateAllNotifications({
      id: principal.userId,
      organizationId: principal.organizationId,
      fullName: principal.label,
    });
    return apiSuccess(result);
  } catch (error) {
    return apiError(error);
  }
}
