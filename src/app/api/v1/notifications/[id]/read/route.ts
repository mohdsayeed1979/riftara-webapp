import { and, eq, inArray, or } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { notifications } from '@/db/schema';
import { authenticateRequest } from '@/lib/api/guard';
import { apiError, apiSuccess } from '@/lib/api/response';
import { notFound } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/** POST /api/v1/notifications/:id/read */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await authenticateRequest();
    const { id } = await context.params;
    if (!principal.userId) throw notFound('Notification', id);

    const db = await getDb();
    const audience = principal.permissions.length
      ? or(
          eq(notifications.userId, principal.userId),
          inArray(notifications.requiredPermission, principal.permissions),
        )
      : eq(notifications.userId, principal.userId);

    const [updated] = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.organizationId, principal.organizationId),
          audience,
        ),
      )
      .returning({ id: notifications.id });

    if (!updated) throw notFound('Notification', id);
    return apiSuccess({ id: updated.id, read: true });
  } catch (error) {
    return apiError(error);
  }
}
