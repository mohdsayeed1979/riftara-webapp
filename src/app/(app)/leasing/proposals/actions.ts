'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/guard';
import { actionFailure, actionSuccess, type ActionResult } from '@/lib/errors';
import { isUuid } from '@/lib/utils';
import {
  createProposal,
  updateProposal,
  submitProposalForApproval,
  decideProposal,
  sendProposal,
  acceptProposal,
  createProposalVersion,
  getProposalFormReferenceData,
  type ProposalWriteInput,
} from '@/services/proposal-service';

function opt(v: FormDataEntryValue | null): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}
function isoDate(message: string) {
  return z.string().refine((x) => /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(x)), { message });
}
const optUuid = z.string().uuid('Select a valid option.').optional();
const optMoney = z.coerce.number().nonnegative('Must be zero or more.').optional();
const optCount = z.coerce.number().int().nonnegative('Must be zero or more.').optional();

const schema = z.object({
  leadId: optUuid,
  customerId: z.string().uuid('Select a customer.'),
  propertyId: z.string().uuid('Select a property.'),
  unitId: z.string().uuid('Select a unit.'),
  leasableArea: z.coerce.number().positive('Enter the leasable area.'),
  annualRent: z.coerce.number().positive('Annual rent must be greater than zero.'),
  serviceCharges: optMoney,
  depositAmount: optMoney,
  contractDurationMonths: z.coerce.number().int().positive('Enter the contract duration in months.'),
  paymentTerms: z.string().trim().max(120).optional(),
  escalationPercent: z.coerce.number().min(0).max(100).optional(),
  gracePeriodDays: optCount,
  fitOutPeriodDays: optCount,
  parkingSpaces: optCount,
  utilitiesTerms: z.string().trim().max(2000).optional(),
  specialTerms: z.string().trim().max(5000).optional(),
  validUntil: isoDate('Enter a valid date.').optional(),
});

type ParsedProposal = z.infer<typeof schema>;

export interface ProposalActionResult {
  id: string;
}

function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const fe: Record<string, string[]> = {};
  for (const issue of error.issues) (fe[String(issue.path[0] ?? '_form')] ??= []).push(issue.message);
  return fe;
}
function readForm(formData: FormData) {
  const g = (k: string) => opt(formData.get(k));
  return {
    leadId: g('leadId'), customerId: g('customerId'), propertyId: g('propertyId'), unitId: g('unitId'),
    leasableArea: g('leasableArea'), annualRent: g('annualRent'), serviceCharges: g('serviceCharges'), depositAmount: g('depositAmount'),
    contractDurationMonths: g('contractDurationMonths'), paymentTerms: g('paymentTerms'), escalationPercent: g('escalationPercent'),
    gracePeriodDays: g('gracePeriodDays'), fitOutPeriodDays: g('fitOutPeriodDays'), parkingSpaces: g('parkingSpaces'),
    utilitiesTerms: g('utilitiesTerms'), specialTerms: g('specialTerms'), validUntil: g('validUntil'),
  };
}
async function validateReferences(organizationId: string, data: ParsedProposal): Promise<Record<string, string[]>> {
  const ref = await getProposalFormReferenceData(organizationId);
  const errors: Record<string, string[]> = {};
  if (!ref.customers.some((c) => c.id === data.customerId)) errors.customerId = ['Unknown customer for this organization.'];
  if (!ref.properties.some((p) => p.id === data.propertyId)) errors.propertyId = ['Unknown property for this organization.'];
  const unit = ref.units.find((u) => u.id === data.unitId);
  if (!unit) errors.unitId = ['Unknown unit for this organization.'];
  else if (unit.propertyId !== data.propertyId) errors.unitId = ['Selected unit does not belong to the selected property.'];
  if (data.leadId) {
    const lead = ref.leads.find((l) => l.id === data.leadId);
    if (!lead) errors.leadId = ['Unknown lead for this organization.'];
    else if (lead.customerId !== data.customerId) errors.leadId = ['The selected lead belongs to a different customer.'];
  }
  return errors;
}
function toInput(data: ParsedProposal): ProposalWriteInput {
  return {
    leadId: data.leadId ?? null, customerId: data.customerId, propertyId: data.propertyId, unitId: data.unitId,
    leasableArea: data.leasableArea, annualRent: data.annualRent, serviceCharges: data.serviceCharges, depositAmount: data.depositAmount,
    contractDurationMonths: data.contractDurationMonths, paymentTerms: data.paymentTerms, escalationPercent: data.escalationPercent,
    gracePeriodDays: data.gracePeriodDays, fitOutPeriodDays: data.fitOutPeriodDays, parkingSpaces: data.parkingSpaces,
    utilitiesTerms: data.utilitiesTerms ?? null, specialTerms: data.specialTerms ?? null, validUntil: data.validUntil ?? null,
  };
}

async function writeProposal(kind: 'create' | 'update' | 'version', id: string | null, formData: FormData): Promise<ActionResult<ProposalActionResult>> {
  try {
    const user = await requirePermission(kind === 'create' || kind === 'version' ? 'proposals:create' : 'proposals:edit');
    if (id !== null && !isUuid(id)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Proposal not found.' } };
    const parsed = schema.safeParse(readForm(formData));
    if (!parsed.success) return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    const refErrors = await validateReferences(user.organizationId, parsed.data);
    if (Object.keys(refErrors).length > 0) return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: refErrors };
    const input = toInput(parsed.data);
    const result = kind === 'create' ? await createProposal(user, input) : kind === 'version' ? await createProposalVersion(user, id!, input) : await updateProposal(user, id!, input);
    try { revalidatePath('/leasing/proposals'); if (id) revalidatePath(`/leasing/proposals/${id}`); } catch { /* cache hint */ }
    return actionSuccess({ id: result.id });
  } catch (error) { return actionFailure(error); }
}

export async function createProposalAction(_p: ActionResult<ProposalActionResult> | null, formData: FormData) {
  return writeProposal('create', null, formData);
}
export async function updateProposalAction(proposalId: string, _p: ActionResult<ProposalActionResult> | null, formData: FormData) {
  return writeProposal('update', proposalId, formData);
}
export async function createProposalVersionAction(proposalId: string, _p: ActionResult<ProposalActionResult> | null, formData: FormData) {
  return writeProposal('version', proposalId, formData);
}

export async function submitProposalAction(proposalId: string, justification?: string): Promise<ActionResult<{ status: string; requiresApproval: boolean }>> {
  try {
    if (!isUuid(proposalId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Proposal not found.' } };
    const user = await requirePermission('proposals:edit');
    const result = await submitProposalForApproval(user, proposalId, justification);
    try { revalidatePath(`/leasing/proposals/${proposalId}`); revalidatePath('/leasing/proposals'); } catch { /* cache hint */ }
    return actionSuccess(result);
  } catch (error) { return actionFailure(error); }
}

export async function decideProposalAction(proposalId: string, decision: 'approved' | 'rejected', notes?: string): Promise<ActionResult<ProposalActionResult>> {
  try {
    if (!isUuid(proposalId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Proposal not found.' } };
    const user = await requirePermission('proposals:approve');
    await decideProposal(user, proposalId, decision, notes);
    try { revalidatePath(`/leasing/proposals/${proposalId}`); revalidatePath('/leasing/proposals'); } catch { /* cache hint */ }
    return actionSuccess({ id: proposalId });
  } catch (error) { return actionFailure(error); }
}

export async function sendProposalAction(proposalId: string): Promise<ActionResult<ProposalActionResult>> {
  try {
    if (!isUuid(proposalId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Proposal not found.' } };
    const user = await requirePermission('proposals:edit');
    await sendProposal(user, proposalId);
    try { revalidatePath(`/leasing/proposals/${proposalId}`); } catch { /* cache hint */ }
    return actionSuccess({ id: proposalId });
  } catch (error) { return actionFailure(error); }
}

export async function acceptProposalAction(proposalId: string): Promise<ActionResult<ProposalActionResult>> {
  try {
    if (!isUuid(proposalId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Proposal not found.' } };
    const user = await requirePermission('proposals:edit');
    await acceptProposal(user, proposalId);
    try { revalidatePath(`/leasing/proposals/${proposalId}`); } catch { /* cache hint */ }
    return actionSuccess({ id: proposalId });
  } catch (error) { return actionFailure(error); }
}
