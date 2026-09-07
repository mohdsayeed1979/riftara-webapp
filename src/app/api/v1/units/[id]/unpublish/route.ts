import { requireApiPermission } from '@/lib/api/guard';
import { apiError, apiSuccess } from '@/lib/api/response';
import { loadSessionUser } from '@/lib/auth/session';
import { AppError } from '@/lib/errors';
import { unpublishUnit } from '@/services/publishing-service';

export const dynamic = 'force-dynamic';

/** POST /api/v1/units/:id/unpublish */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireApiPermission('units:publish');
    const { id } = await context.params;
    if (!principal.userId) throw new AppError('FORBIDDEN', 'A user session is required.');

    const actor = await loadSessionUser(principal.userId);
    if (!actor) throw new AppError('UNAUTHENTICATED', 'Session could not be resolved.');

    await unpublishUnit(actor, id);
    return apiSuccess({ unitId: id, published: false });
  } catch (error) {
    return apiError(error);
  }
}
