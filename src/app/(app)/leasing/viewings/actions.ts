'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/guard';
import { actionFailure, actionSuccess, type ActionResult } from '@/lib/errors';
import { isUuid } from '@/lib/utils';
import {
  createViewing,
  updateViewing,
  cancelViewing,
  completeViewing,
  getViewingFormReferenceData,
  type ViewingWriteInput,
  type ViewingFeedbackInput,
} from '@/services/viewing-service';

function opt(v: FormDataEntryValue | null): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}
function isoDate(message: string) {
  return z.string().refine((x) => /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(x)), { message });
}
const optUuid = z.string().uuid('Select a valid option.').optional();
const rating = z.coerce.number().int().min(1, 'Rate 1-5.').max(5, 'Rate 1-5.').optional();

const schema = z.object({
  customerId: z.string().uuid('Select a customer.'),
  leadId: optUuid,
  propertyId: z.string().uuid('Select a property.'),
  unitId: optUuid,
  assignedUserId: optUuid,
  meetingPoint: z.string().trim().max(200).optional(),
  scheduledDate: isoDate('Enter a valid date.'),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/, 'Enter a valid time.'),
  notes: z.string().trim().max(5000).optional(),
});

type ParsedViewing = z.infer<typeof schema>;

export interface ViewingActionResult {
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
    customerId: g('customerId'), leadId: g('leadId'), propertyId: g('propertyId'), unitId: g('unitId'),
    assignedUserId: g('assignedUserId'), meetingPoint: g('meetingPoint'), scheduledDate: g('scheduledDate'),
    scheduledTime: g('scheduledTime'), notes: g('notes'),
  };
}
async function validateReferences(organizationId: string, data: ParsedViewing): Promise<Record<string, string[]>> {
  const ref = await getViewingFormReferenceData(organizationId);
  const errors: Record<string, string[]> = {};
  if (!ref.customers.some((c) => c.id === data.customerId)) errors.customerId = ['Unknown customer for this organization.'];
  if (!ref.properties.some((p) => p.id === data.propertyId)) errors.propertyId = ['Unknown property for this organization.'];
  if (data.unitId) {
    const unit = ref.units.find((u) => u.id === data.unitId);
    if (!unit) errors.unitId = ['Unknown unit for this organization.'];
    else if (unit.propertyId !== data.propertyId) errors.unitId = ['Selected unit does not belong to the selected property.'];
  }
  if (data.leadId) {
    const lead = ref.leads.find((l) => l.id === data.leadId);
    if (!lead) errors.leadId = ['Unknown lead for this organization.'];
    else if (lead.customerId !== data.customerId) errors.leadId = ['The selected lead belongs to a different customer.'];
  }
  if (data.assignedUserId && !ref.agents.some((a) => a.id === data.assignedUserId)) errors.assignedUserId = ['Unknown agent for this organization.'];
  return errors;
}
function toInput(data: ParsedViewing): ViewingWriteInput {
  return {
    leadId: data.leadId ?? null, customerId: data.customerId, propertyId: data.propertyId, unitId: data.unitId ?? null,
    assignedUserId: data.assignedUserId ?? null, meetingPoint: data.meetingPoint ?? null,
    scheduledDate: data.scheduledDate, scheduledTime: data.scheduledTime, notes: data.notes ?? null,
  };
}

export async function createViewingAction(_p: ActionResult<ViewingActionResult> | null, formData: FormData): Promise<ActionResult<ViewingActionResult>> {
  try {
    const user = await requirePermission('viewings:create');
    const parsed = schema.safeParse(readForm(formData));
    if (!parsed.success) return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    const refErrors = await validateReferences(user.organizationId, parsed.data);
    if (Object.keys(refErrors).length > 0) return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: refErrors };
    const created = await createViewing(user, toInput(parsed.data));
    try { revalidatePath('/leasing/viewings'); } catch { /* cache hint */ }
    return actionSuccess({ id: created.id });
  } catch (error) { return actionFailure(error); }
}

export async function updateViewingAction(viewingId: string, _p: ActionResult<ViewingActionResult> | null, formData: FormData): Promise<ActionResult<ViewingActionResult>> {
  try {
    if (!isUuid(viewingId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Viewing not found.' } };
    const user = await requirePermission('viewings:edit');
    const parsed = schema.safeParse(readForm(formData));
    if (!parsed.success) return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    const refErrors = await validateReferences(user.organizationId, parsed.data);
    if (Object.keys(refErrors).length > 0) return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: refErrors };
    await updateViewing(user, viewingId, toInput(parsed.data));
    try { revalidatePath('/leasing/viewings'); revalidatePath(`/leasing/viewings/${viewingId}`); } catch { /* cache hint */ }
    return actionSuccess({ id: viewingId });
  } catch (error) { return actionFailure(error); }
}

export async function cancelViewingAction(viewingId: string, reason?: string): Promise<ActionResult<ViewingActionResult>> {
  try {
    if (!isUuid(viewingId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Viewing not found.' } };
    const user = await requirePermission('viewings:edit');
    await cancelViewing(user, viewingId, reason);
    try { revalidatePath('/leasing/viewings'); revalidatePath(`/leasing/viewings/${viewingId}`); } catch { /* cache hint */ }
    return actionSuccess({ id: viewingId });
  } catch (error) { return actionFailure(error); }
}

const feedbackSchema = z.object({
  interestLevel: rating, priceSuitability: rating, areaSuitability: rating, locationSuitability: rating,
  unitSuitability: rating, likelihoodToLease: rating,
  customerComments: z.string().trim().max(5000).optional(), agentComments: z.string().trim().max(5000).optional(),
  nextAction: z.string().trim().max(200).optional(),
});

export async function completeViewingAction(viewingId: string, _p: ActionResult<ViewingActionResult> | null, formData: FormData): Promise<ActionResult<ViewingActionResult>> {
  try {
    if (!isUuid(viewingId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Viewing not found.' } };
    const user = await requirePermission('viewings:edit');
    const parsed = feedbackSchema.safeParse({
      interestLevel: opt(formData.get('interestLevel')), priceSuitability: opt(formData.get('priceSuitability')),
      areaSuitability: opt(formData.get('areaSuitability')), locationSuitability: opt(formData.get('locationSuitability')),
      unitSuitability: opt(formData.get('unitSuitability')), likelihoodToLease: opt(formData.get('likelihoodToLease')),
      customerComments: opt(formData.get('customerComments')), agentComments: opt(formData.get('agentComments')), nextAction: opt(formData.get('nextAction')),
    });
    if (!parsed.success) return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    const feedback: ViewingFeedbackInput = {
      interestLevel: parsed.data.interestLevel ?? null, priceSuitability: parsed.data.priceSuitability ?? null,
      areaSuitability: parsed.data.areaSuitability ?? null, locationSuitability: parsed.data.locationSuitability ?? null,
      unitSuitability: parsed.data.unitSuitability ?? null, likelihoodToLease: parsed.data.likelihoodToLease ?? null,
      customerComments: parsed.data.customerComments ?? null, agentComments: parsed.data.agentComments ?? null, nextAction: parsed.data.nextAction ?? null,
    };
    await completeViewing(user, viewingId, feedback);
    try { revalidatePath('/leasing/viewings'); revalidatePath(`/leasing/viewings/${viewingId}`); } catch { /* cache hint */ }
    return actionSuccess({ id: viewingId });
  } catch (error) { return actionFailure(error); }
}
