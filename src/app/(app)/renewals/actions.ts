'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/guard';
import { actionFailure, actionSuccess, type ActionResult } from '@/lib/errors';
import { notifyRenewalDecisionNeeded } from '@/services/notification-service';
import {
  approveRenewal,
  createRenewalFromContract,
  declineRenewal,
  generateRenewedContract,
  getRenewalById,
  markNotRenewed,
  recordTenantRenewalDecision,
  sendRenewalOffer,
  updateRenewalProposal,
} from '@/services/renewal-service';

function opt(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t === '' ? undefined : t;
}
function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const fe: Record<string, string[]> = {};
  for (const issue of error.issues) (fe[String(issue.path[0] ?? '_form')] ??= []).push(issue.message);
  return fe;
}

export async function startRenewalAction(contractId: string): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission('renewals:create');
    const result = await createRenewalFromContract(user, contractId);
    revalidatePath('/renewals');
    revalidatePath(`/contracts/${contractId}`);
    return actionSuccess({ id: result.id });
  } catch (error) {
    return actionFailure(error);
  }
}

const proposalSchema = z.object({
  proposedRent: z.coerce.number().positive('Proposed rent must be greater than zero.').optional(),
  marketRent: z.coerce.number().nonnegative('Must be zero or more.').optional(),
  probability: z.coerce.number().int().min(0).max(100).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function updateRenewalProposalAction(
  renewalId: string,
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const user = await requirePermission('renewals:edit');
    const parsed = proposalSchema.safeParse({
      proposedRent: opt(formData.get('proposedRent')),
      marketRent: opt(formData.get('marketRent')),
      probability: opt(formData.get('probability')),
      notes: opt(formData.get('notes')),
    });
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    }
    await updateRenewalProposal(user, renewalId, parsed.data);
    revalidatePath(`/renewals/${renewalId}`);
    revalidatePath('/renewals');
    return actionSuccess(null);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function approveRenewalAction(renewalId: string, notes?: string): Promise<ActionResult<null>> {
  try {
    const user = await requirePermission('renewals:approve');
    await approveRenewal(user, renewalId, notes);
    revalidatePath(`/renewals/${renewalId}`);
    return actionSuccess(null);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function sendRenewalOfferAction(renewalId: string): Promise<ActionResult<null>> {
  try {
    const user = await requirePermission('renewals:edit');
    await sendRenewalOffer(user, renewalId);
    const renewal = await getRenewalById(user.organizationId, renewalId);
    if (renewal) {
      await notifyRenewalDecisionNeeded(user.organizationId, renewalId, renewal.contractNumber);
    }
    revalidatePath(`/renewals/${renewalId}`);
    return actionSuccess(null);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function recordTenantDecisionAction(
  renewalId: string,
  decision: 'accept' | 'decline',
  reason?: string,
): Promise<ActionResult<null>> {
  try {
    const user = await requirePermission('renewals:edit');
    await recordTenantRenewalDecision(user, renewalId, decision, reason);
    revalidatePath(`/renewals/${renewalId}`);
    return actionSuccess(null);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function declineRenewalAction(renewalId: string, reason?: string): Promise<ActionResult<null>> {
  try {
    const user = await requirePermission('renewals:edit');
    await declineRenewal(user, renewalId, reason);
    revalidatePath(`/renewals/${renewalId}`);
    return actionSuccess(null);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function markNotRenewedAction(renewalId: string, reason?: string): Promise<ActionResult<null>> {
  try {
    const user = await requirePermission('renewals:edit');
    await markNotRenewed(user, renewalId, reason);
    revalidatePath(`/renewals/${renewalId}`);
    return actionSuccess(null);
  } catch (error) {
    return actionFailure(error);
  }
}

const generateSchema = z
  .object({
    startDate: z.string().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)), { message: 'Enter a valid start date.' }),
    endDate: z.string().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)), { message: 'Enter a valid end date.' }),
  })
  .refine((v) => new Date(v.endDate) > new Date(v.startDate), { message: 'The end date must be after the start date.', path: ['endDate'] });

export interface GenerateRenewedContractResult {
  id: string;
  contractNumber: string;
}

export async function generateRenewedContractAction(
  renewalId: string,
  _previous: ActionResult<GenerateRenewedContractResult> | null,
  formData: FormData,
): Promise<ActionResult<GenerateRenewedContractResult>> {
  try {
    const user = await requirePermission('renewals:approve');
    const parsed = generateSchema.safeParse({ startDate: opt(formData.get('startDate')), endDate: opt(formData.get('endDate')) });
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    }
    const created = await generateRenewedContract(user, renewalId, parsed.data);
    revalidatePath(`/renewals/${renewalId}`);
    revalidatePath('/renewals');
    revalidatePath('/contracts');
    return actionSuccess(created);
  } catch (error) {
    return actionFailure(error);
  }
}
