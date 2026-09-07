import { requireApiPermission } from '@/lib/api/guard';
import { apiError, apiSuccess } from '@/lib/api/response';
import { loadSessionUser } from '@/lib/auth/session';
import { AppError } from '@/lib/errors';
import { signContract } from '@/services/contract-service';

export const dynamic = 'force-dynamic';

/** POST /api/v1/contracts/:id/sign — signs and activates a contract (BR-010). */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireApiPermission('contracts:edit');
    const { id } = await context.params;
    if (!principal.userId) throw new AppError('FORBIDDEN', 'A user session is required.');
    const actor = await loadSessionUser(principal.userId);
    if (!actor) throw new AppError('UNAUTHENTICATED', 'Session could not be resolved.');

    const result = await signContract(actor, id);
    return apiSuccess(result);
  } catch (error) {
    return apiError(error);
  }
}
