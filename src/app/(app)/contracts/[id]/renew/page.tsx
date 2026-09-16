import { notFound, redirect } from 'next/navigation';
import { requirePermission } from '@/lib/auth/guard';
import { toErrorPayload } from '@/lib/errors';
import { createRenewalFromContract } from '@/services/renewal-service';
import { isUuid } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * Thin initiator: starts (or resumes) the renewal for this contract and hands
 * off to the /renewals/[id] workflow. createRenewalFromContract is idempotent,
 * so revisiting this route never creates a duplicate renewal.
 */
export default async function StartRenewalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('renewals:create');
  const { id } = await params;
  if (!isUuid(id)) notFound();

  let renewalId: string;
  try {
    renewalId = (await createRenewalFromContract(user, id)).id;
  } catch (error) {
    const { payload } = toErrorPayload(error);
    if (payload.code === 'NOT_FOUND') notFound();
    throw error;
  }
  redirect(`/renewals/${renewalId}`);
}
