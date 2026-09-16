import { notFound, redirect } from 'next/navigation';
import { requirePermission } from '@/lib/auth/guard';
import { toErrorPayload } from '@/lib/errors';
import { initiateHandover } from '@/services/handover-service';
import { isUuid } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * Thin initiator: starts (or resumes) a handover for this contract and hands
 * off to the /handovers/[id] workflow. initiateHandover is idempotent per
 * (contract, type), so revisiting this route never creates a duplicate.
 */
export default async function StartHandoverPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission('handovers:create');
  const { id } = await params;
  const { type } = await searchParams;
  if (!isUuid(id)) notFound();
  const handoverType = type === 'move_out' ? 'move_out' : 'handover';

  let handoverId: string;
  try {
    handoverId = (await initiateHandover(user, { contractId: id, handoverType })).id;
  } catch (error) {
    const { payload } = toErrorPayload(error);
    if (payload.code === 'NOT_FOUND') notFound();
    throw error;
  }
  redirect(`/handovers/${handoverId}`);
}
