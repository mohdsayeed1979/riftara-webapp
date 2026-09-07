import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { notifications } from '@/db/schema';
import { authenticateRequest } from '@/lib/api/guard';
import { apiError, apiSuccess } from '@/lib/api/response';

export const dynamic = 'force-dynamic';

/** POST /api/v1/notifications/read-all — marks the caller's notifications read. */
export async function POST() {
  try {
    const principal = await authenticateRequest();
    if (!principal.userId) return apiSuccess({ updated: 0 });

    const db = await getDb();
    const audience = principal.permissions.length
      ? or(
          eq(notifications.userId, principal.userId),
          inArray(notifications.requiredPermission, principal.permissions),
        )
      : eq(notifications.userId, principal.userId);

    const updated = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.organizationId, principal.organizationId),
          audience,
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id });

    return apiSuccess({ updated: updated.length });
  } catch (error) {
    return apiError(error);
  }
}
