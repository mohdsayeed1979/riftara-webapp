'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { CheckCircle2, FileSignature, Send, ThumbsUp, Upload, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { acceptProposalAction, decideProposalAction, sendProposalAction, submitProposalAction } from '@/app/(app)/leasing/proposals/actions';

export function ProposalStatusActions({
  proposalId,
  status,
  canEdit,
  canApprove,
  canReserve,
  reservationTarget,
}: {
  proposalId: string;
  status: string;
  canEdit: boolean;
  canApprove: boolean;
  canReserve: boolean;
  reservationTarget: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: { message: string } }>, success: string) {
    start(async () => {
      const result = await fn();
      if (result.ok) { toast.success(success); router.refresh(); }
      else toast.error(result.error?.message ?? 'The action could not be completed.');
    });
  }

  return (
    <>
      {canEdit && status === 'draft' ? (
        <Button loading={pending} onClick={() => run(() => submitProposalAction(proposalId), 'Submitted for approval.')}>
          <Upload />
          Submit for Approval
        </Button>
      ) : null}

      {canApprove && status === 'pending_approval' ? (
        <>
          <Button loading={pending} onClick={() => run(() => decideProposalAction(proposalId, 'approved'), 'Proposal approved.')}>
            <CheckCircle2 />
            Approve
          </Button>
          <Button variant="secondary" loading={pending} onClick={() => run(() => decideProposalAction(proposalId, 'rejected'), 'Proposal rejected.')}>
            <XCircle />
            Reject
          </Button>
        </>
      ) : null}

      {canEdit && status === 'approved' ? (
        <Button variant="secondary" loading={pending} onClick={() => run(() => sendProposalAction(proposalId), 'Proposal marked as sent.')}>
          <Send />
          Mark Sent
        </Button>
      ) : null}

      {canEdit && (status === 'approved' || status === 'sent') ? (
        <Button variant="secondary" loading={pending} onClick={() => run(() => acceptProposalAction(proposalId), 'Proposal accepted.')}>
          <ThumbsUp />
          Mark Accepted
        </Button>
      ) : null}

      {canReserve && (status === 'approved' || status === 'accepted') ? (
        <Button variant="secondary" asChild>
          <Link href={reservationTarget}>
            <FileSignature />
            Create Reservation
          </Link>
        </Button>
      ) : null}
    </>
  );
}
