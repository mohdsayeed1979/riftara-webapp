'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DetailList, DetailRow } from '@/components/ui/page';
import { Field, Input, Textarea } from '@/components/ui/input';
import { formatCurrency } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import { useI18n } from '@/i18n/provider';
import {
  approveRenewalAction,
  declineRenewalAction,
  generateRenewedContractAction,
  markNotRenewedAction,
  recordTenantDecisionAction,
  sendRenewalOfferAction,
  updateRenewalProposalAction,
  type GenerateRenewedContractResult,
} from '@/app/(app)/renewals/actions';
import type { ActionResult } from '@/lib/errors';

export function RenewalWorkflowPanel({
  renewalId,
  status,
  currentRent,
  proposedRent,
  marketRent,
  agreedRent,
  probability,
  notes,
  decidedAt,
  requiresApproval,
  canEdit,
  canApprove,
  locale,
}: {
  renewalId: string;
  status: string;
  currentRent: number;
  proposedRent: number | null;
  marketRent: number | null;
  agreedRent: number | null;
  probability: number;
  notes: string | null;
  decidedAt: string | null;
  requiresApproval: boolean;
  canEdit: boolean;
  canApprove: boolean;
  locale: Locale;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const money = (v: number) => formatCurrency(v, { locale });

  const [proposalState, proposalAction, proposalPending] = useActionState<ActionResult<null> | null, FormData>(
    (state, formData) => updateRenewalProposalAction(renewalId, state, formData),
    null,
  );
  const [contractState, contractAction, contractPending] = useActionState<
    ActionResult<GenerateRenewedContractResult> | null,
    FormData
  >((state, formData) => generateRenewedContractAction(renewalId, state, formData), null);

  async function runSimple(fn: () => Promise<ActionResult<unknown>>, successMessage: string) {
    setBusy(true);
    const result = await fn();
    setBusy(false);
    if (result.ok) {
      toast.success(successMessage);
      startTransition(() => router.refresh());
    } else {
      toast.error(result.error.message);
    }
  }

  const terminal = ['renewed', 'not_renewed', 'declined'].includes(status);
  const canSendOffer = (status === 'pending' || status === 'in_discussion') && proposedRent !== null;
  const blockedBySendOfferApproval = canSendOffer && requiresApproval && agreedRent === null;
  const canApproveNow = requiresApproval && agreedRent === null && proposedRent !== null && !terminal;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title={t('renewals.terms')} />
        <CardBody className="pt-0">
          <DetailList>
            <DetailRow label={t('renewals.currentRent')} value={money(currentRent)} />
            <DetailRow label={t('renewals.marketRent')} value={marketRent !== null ? money(marketRent) : '—'} />
            <DetailRow label={t('renewals.proposedRent')} value={proposedRent !== null ? money(proposedRent) : '—'} />
            <DetailRow label={t('renewals.agreedRent')} value={agreedRent !== null ? <span className="text-[var(--color-success)]">{money(agreedRent)}</span> : '—'} />
            <DetailRow label={t('renewals.probability')} value={`${probability}%`} />
          </DetailList>

          {requiresApproval && agreedRent === null ? (
            <p className="mt-3 rounded-[var(--radius-control)] border border-[var(--color-warning-border)] bg-[var(--color-warning-soft)] p-2.5 text-[12.5px] text-[var(--color-warning)]">
              {t('renewals.requiresApproval')}
            </p>
          ) : null}
        </CardBody>
      </Card>

      {canEdit && !terminal && status !== 'offer_sent' ? (
        <Card>
          <CardHeader title={t('renewals.updateProposal')} />
          <CardBody className="pt-0">
            <form action={proposalAction} className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('renewals.proposedRent')} error={proposalState && !proposalState.ok ? proposalState.fieldErrors?.proposedRent?.[0] : undefined}>
                  <Input name="proposedRent" type="number" step="0.01" min="0" defaultValue={proposedRent ?? ''} />
                </Field>
                <Field label={t('renewals.marketRent')}>
                  <Input name="marketRent" type="number" step="0.01" min="0" defaultValue={marketRent ?? ''} />
                </Field>
              </div>
              <Field label={t('renewals.probability')}>
                <Input name="probability" type="number" min="0" max="100" defaultValue={probability} />
              </Field>
              <Field label={t('renewals.notes')}>
                <Textarea name="notes" rows={2} defaultValue={notes ?? ''} />
              </Field>
              <div className="flex justify-end">
                <Button type="submit" variant="secondary" loading={proposalPending}>
                  {t('common.save')}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      ) : null}

      {!terminal && status !== 'offer_sent' ? (
        <Card>
          <CardHeader title={t('common.actions')} />
          <CardBody className="flex flex-wrap gap-2 pt-0">
            {canApprove && canApproveNow ? (
              <Button
                variant="secondary"
                loading={busy}
                onClick={() => void runSimple(() => approveRenewalAction(renewalId), t('renewals.approve'))}
              >
                {t('renewals.approve')}
              </Button>
            ) : null}
            {canEdit ? (
              <Button
                loading={busy}
                disabled={!canSendOffer || blockedBySendOfferApproval}
                onClick={() => void runSimple(() => sendRenewalOfferAction(renewalId), t('renewals.sendOffer'))}
              >
                {t('renewals.sendOffer')}
              </Button>
            ) : null}
            {canEdit ? (
              <Button
                variant="ghost"
                loading={busy}
                onClick={() => void runSimple(() => markNotRenewedAction(renewalId), t('renewals.markNotRenewed'))}
              >
                {t('renewals.markNotRenewed')}
              </Button>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {status === 'offer_sent' && !decidedAt && canEdit ? (
        <Card>
          <CardHeader title={t('renewals.recordDecision')} />
          <CardBody className="flex flex-wrap gap-2 pt-0">
            <Button
              loading={busy}
              onClick={() => void runSimple(() => recordTenantDecisionAction(renewalId, 'accept'), t('renewals.accept'))}
            >
              {t('renewals.accept')}
            </Button>
            <Button
              variant="ghost"
              loading={busy}
              onClick={() => void runSimple(() => declineRenewalAction(renewalId), t('renewals.decline'))}
            >
              {t('renewals.decline')}
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {status === 'offer_sent' && decidedAt && canApprove ? (
        <Card>
          <CardHeader title={t('renewals.generateContract')} />
          <CardBody className="pt-0">
            <form action={contractAction} className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('contracts.startDate')} required error={contractState && !contractState.ok ? contractState.fieldErrors?.startDate?.[0] : undefined}>
                  <Input name="startDate" type="date" />
                </Field>
                <Field label={t('contracts.endDate')} required error={contractState && !contractState.ok ? contractState.fieldErrors?.endDate?.[0] : undefined}>
                  <Input name="endDate" type="date" />
                </Field>
              </div>
              <div className="flex justify-end">
                <Button type="submit" loading={contractPending}>
                  {t('renewals.generateContract')}
                </Button>
              </div>
              {contractState?.ok ? (
                <p className="text-[12.5px] text-[var(--color-success)]">
                  {contractState.data.contractNumber}
                </p>
              ) : null}
            </form>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
