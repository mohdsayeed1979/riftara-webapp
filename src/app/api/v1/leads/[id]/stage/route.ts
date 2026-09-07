import { z } from 'zod';
import { requireApiPermission } from '@/lib/api/guard';
import { apiError, apiSuccess } from '@/lib/api/response';
import { loadSessionUser } from '@/lib/auth/session';
import { AppError, validationError } from '@/lib/errors';
import { moveLeadToStage } from '@/services/lead-service';

export const dynamic = 'force-dynamic';

const schema = z.object({
  stageKey: z.string().min(1),
  lossReasonId: z.string().uuid().optional(),
  lossNotes: z.string().optional(),
  nextAction: z.string().optional(),
  nextFollowUpAt: z.string().datetime().optional(),
});

/** POST /api/v1/leads/:id/stage — moves a lead between pipeline stages. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireApiPermission('leasing:edit');
    const { id } = await context.params;
    if (!principal.userId) throw new AppError('FORBIDDEN', 'A user session is required.');
    const actor = await loadSessionUser(principal.userId);
    if (!actor) throw new AppError('UNAUTHENTICATED', 'Session could not be resolved.');

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) throw validationError('Invalid stage change request.', parsed.error.issues);

    await moveLeadToStage(actor, {
      leadId: id,
      stageKey: parsed.data.stageKey,
      lossReasonId: parsed.data.lossReasonId,
      lossNotes: parsed.data.lossNotes,
      nextAction: parsed.data.nextAction,
      nextFollowUpAt: parsed.data.nextFollowUpAt ? new Date(parsed.data.nextFollowUpAt) : undefined,
    });

    return apiSuccess({ leadId: id, stageKey: parsed.data.stageKey });
  } catch (error) {
    return apiError(error);
  }
}
