'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/guard';
import { actionFailure, actionSuccess, type ActionResult } from '@/lib/errors';
import { generateAllNotifications, type AutomationSummary } from '@/services/notification-service';

/**
 * Admin-triggered run of the notification automation for the caller's
 * organization. Mirrors the scheduled cron job; idempotent and safe to repeat.
 */
export async function runNotificationsAction(): Promise<ActionResult<AutomationSummary>> {
  try {
    const user = await requirePermission('settings:manage');
    const result = await generateAllNotifications({ id: user.id, organizationId: user.organizationId, fullName: user.fullName });
    try { revalidatePath('/notifications'); } catch { /* cache hint */ }
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}
