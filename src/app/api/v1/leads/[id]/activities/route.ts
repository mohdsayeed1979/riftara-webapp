import { z } from 'zod';
import { requireApiPermission } from '@/lib/api/guard';
import { apiCreated, apiError } from '@/lib/api/response';
import { loadSessionUser } from '@/lib/auth/session';
import { AppError, validationError } from '@/lib/errors';
import { logLeadActivity } from '@/services/lead-service';

export const dynamic = 'force-dynamic';

const schema = z.object({
  activityType: z.enum(['call', 'whatsapp', 'email', 'meeting', 'viewing', 'note', 'task', 'reminder']),
  subject: z.string().min(1).max(200),
  body: z.string().max(4000).optional(),
  outcome: z.string().max(120).optional(),
  direction: z.enum(['inbound', 'outbound', 'internal']).optional(),
  nextAction: z.string().max(200).optional(),
  nextFollowUpAt: z.string().datetime().optional(),
});

/** POST /api/v1/leads/:id/activities — logs a follow-up (BRD 26-27). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireApiPermission('leasing:edit');
    const { id } = await context.params;
    if (!principal.userId) throw new AppError('FORBIDDEN', 'A user session is required.');
    const actor = await loadSessionUser(principal.userId);
    if (!actor) throw new AppError('UNAUTHENTICATED', 'Session could not be resolved.');

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) throw validationError('Invalid activity.', parsed.error.issues);

    const result = await logLeadActivity(actor, {
      leadId: id,
      ...parsed.data,
      nextFollowUpAt: parsed.data.nextFollowUpAt ? new Date(parsed.data.nextFollowUpAt) : undefined,
    });

    return apiCreated(result);
  } catch (error) {
    return apiError(error);
  }
}
