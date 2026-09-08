'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/guard';
import { actionFailure, actionSuccess, type ErrorPayload } from '@/lib/errors';
import type { SessionUser } from '@/lib/auth/session';
import { isUuid } from '@/lib/utils';
import { CUSTOMER_TYPE_VALUES } from '@/lib/parties/enums';
import {
  createCustomerWithDeduplication,
  detectDuplicates,
  type DuplicateMatch,
} from '@/services/customer-service';
import {
  createLead,
  updateLead,
  getLeadFormReferenceData,
  type CreateLeadInput,
  type LeadWriteInput,
} from '@/services/lead-service';

function opt(v: FormDataEntryValue | null): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}
function enumOf(values: readonly string[], message: string) {
  return z.string().refine((x) => values.includes(x), { message });
}
function isoDate(message: string) {
  return z.string().refine((x) => /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(x)), { message });
}
const optUuid = z.string().uuid('Select a valid option.').optional();
const optMoney = z.coerce.number().nonnegative('Must be zero or more.').optional();
const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;

const schema = z
  .object({
    customerMode: z.enum(['existing', 'new']),
    customerId: optUuid,
    // Inline new-customer fields (customerMode === 'new')
    customerType: enumOf(CUSTOMER_TYPE_VALUES, 'Select a valid type.').optional(),
    fullNameEn: z.string().trim().max(200).optional(),
    companyName: z.string().trim().max(200).optional(),
    mobile: z.string().trim().max(32).optional(),
    email: z.string().trim().email('Enter a valid email.').max(160).optional(),
    nationalId: z.string().trim().max(64).optional(),
    iqama: z.string().trim().max(64).optional(),
    commercialRegistration: z.string().trim().max(40).optional(),
    // Lead fields
    stageId: optUuid,
    sourceId: optUuid,
    assignedUserId: optUuid,
    requestedPropertyId: optUuid,
    requestedUnitId: optUuid,
    requestedUnitTypeId: optUuid,
    requiredArea: z.coerce.number().nonnegative('Must be zero or more.').optional(),
    budgetMin: optMoney,
    budgetMax: optMoney,
    moveInDate: isoDate('Enter a valid date.').optional(),
    priority: enumOf(PRIORITIES, 'Select a valid priority.').optional(),
    nextAction: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(5000).optional(),
  })
  .refine((v) => v.customerMode !== 'existing' || Boolean(v.customerId), { message: 'Select a customer.', path: ['customerId'] })
  .refine((v) => v.customerMode !== 'new' || Boolean(v.fullNameEn), { message: 'Enter the customer name.', path: ['fullNameEn'] });

type ParsedLead = z.infer<typeof schema>;

export interface LeadActionData {
  id: string;
}
export type LeadActionResult =
  | { ok: true; data: LeadActionData }
  | { ok: false; error: ErrorPayload; fieldErrors?: Record<string, string[]>; duplicates?: DuplicateMatch[] };

function readForm(formData: FormData) {
  const g = (k: string) => opt(formData.get(k));
  return {
    customerMode: (g('customerMode') ?? 'existing') as 'existing' | 'new',
    customerId: g('customerId'),
    customerType: g('customerType'),
    fullNameEn: g('fullNameEn'),
    companyName: g('companyName'),
    mobile: g('mobile'),
    email: g('email'),
    nationalId: g('nationalId'),
    iqama: g('iqama'),
    commercialRegistration: g('commercialRegistration'),
    stageId: g('stageId'),
    sourceId: g('sourceId'),
    assignedUserId: g('assignedUserId'),
    requestedPropertyId: g('requestedPropertyId'),
    requestedUnitId: g('requestedUnitId'),
    requestedUnitTypeId: g('requestedUnitTypeId'),
    requiredArea: g('requiredArea'),
    budgetMin: g('budgetMin'),
    budgetMax: g('budgetMax'),
    moveInDate: g('moveInDate'),
    priority: g('priority'),
    nextAction: g('nextAction'),
    notes: g('notes'),
  };
}

function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const fe: Record<string, string[]> = {};
  for (const issue of error.issues) (fe[String(issue.path[0] ?? '_form')] ??= []).push(issue.message);
  return fe;
}

function toLeadInput(data: ParsedLead): LeadWriteInput {
  return {
    sourceId: data.sourceId ?? null,
    assignedUserId: data.assignedUserId ?? null,
    requestedPropertyId: data.requestedPropertyId ?? null,
    requestedUnitId: data.requestedUnitId ?? null,
    requestedUnitTypeId: data.requestedUnitTypeId ?? null,
    requiredArea: data.requiredArea ?? null,
    budgetMin: data.budgetMin ?? null,
    budgetMax: data.budgetMax ?? null,
    moveInDate: data.moveInDate ?? null,
    priority: data.priority ?? 'medium',
    nextAction: data.nextAction ?? null,
    notes: data.notes ?? null,
  };
}

async function validateLeadRefs(organizationId: string, data: ParsedLead): Promise<Record<string, string[]>> {
  const ref = await getLeadFormReferenceData(organizationId);
  const errors: Record<string, string[]> = {};
  const has = (list: Array<{ id: string }>, id?: string) => !id || list.some((x) => x.id === id);
  if (data.stageId && !ref.openStages.some((s) => s.id === data.stageId)) errors.stageId = ['Select an open stage.'];
  if (!has(ref.sources, data.sourceId)) errors.sourceId = ['Unknown source for this organization.'];
  if (!has(ref.agents, data.assignedUserId)) errors.assignedUserId = ['Unknown agent for this organization.'];
  if (!has(ref.properties, data.requestedPropertyId)) errors.requestedPropertyId = ['Unknown property for this organization.'];
  if (!has(ref.unitTypes, data.requestedUnitTypeId)) errors.requestedUnitTypeId = ['Unknown unit type for this organization.'];
  if (data.requestedUnitId) {
    const unit = ref.units.find((u) => u.id === data.requestedUnitId);
    if (!unit) errors.requestedUnitId = ['Unknown unit for this organization.'];
    else if (data.requestedPropertyId && unit.propertyId !== data.requestedPropertyId) errors.requestedUnitId = ['Unit does not belong to the requested property.'];
  }
  if (data.customerMode === 'existing' && data.customerId && !ref.customers.some((c) => c.id === data.customerId)) {
    errors.customerId = ['Unknown customer for this organization.'];
  }
  return errors;
}

/** Resolves the customer id: an existing selection, or a new customer created
 *  through the existing dedup service. Returns `{ duplicates }` when a new
 *  customer collides and the user has not confirmed. */
async function resolveCustomer(
  user: SessionUser,
  data: ParsedLead,
  confirmed: boolean,
): Promise<{ customerId?: string; duplicates?: DuplicateMatch[] }> {
  if (data.customerMode === 'existing') return { customerId: data.customerId };

  const identifiers = {
    mobile: data.mobile,
    email: data.email,
    national_id: data.nationalId,
    iqama: data.iqama,
    commercial_registration: data.commercialRegistration,
  };
  if (!confirmed) {
    const duplicates = await detectDuplicates(user.organizationId, identifiers);
    if (duplicates.length > 0) return { duplicates };
  }
  const result = await createCustomerWithDeduplication(
    user,
    {
      customerType: (data.customerType ?? 'individual') as 'individual' | 'corporate',
      fullNameEn: data.fullNameEn!,
      companyName: data.companyName ?? null,
      mobile: data.mobile ?? null,
      email: data.email ?? null,
      nationalId: data.nationalId ?? null,
      iqama: data.iqama ?? null,
      commercialRegistration: data.commercialRegistration ?? null,
    },
    { linkOnDuplicate: false },
  );
  return { customerId: result.customerId };
}

export async function createLeadAction(
  _previous: LeadActionResult | null,
  formData: FormData,
): Promise<LeadActionResult> {
  try {
    const user = await requirePermission('leasing:create');
    const parsed = schema.safeParse(readForm(formData));
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    }
    const refErrors = await validateLeadRefs(user.organizationId, parsed.data);
    if (Object.keys(refErrors).length > 0) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: refErrors };
    }

    const confirmed = formData.get('confirmed') === 'true';
    const resolved = await resolveCustomer(user, parsed.data, confirmed);
    if (resolved.duplicates) {
      return { ok: false, error: { code: 'CONFLICT', message: 'Possible existing customer found.' }, duplicates: resolved.duplicates };
    }
    if (!resolved.customerId) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: { customerId: ['Select a customer.'] } };
    }

    const input: CreateLeadInput = { customerId: resolved.customerId, stageId: parsed.data.stageId ?? null, ...toLeadInput(parsed.data) };
    const created = await createLead(user, input);
    try {
      revalidatePath('/leasing');
    } catch {
      /* cache hint only */
    }
    return actionSuccess({ id: created.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateLeadAction(
  leadId: string,
  _previous: LeadActionResult | null,
  formData: FormData,
): Promise<LeadActionResult> {
  try {
    if (!isUuid(leadId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Lead not found.' } };
    const user = await requirePermission('leasing:edit');
    const parsed = schema.safeParse({ ...readForm(formData), customerMode: 'existing', customerId: '00000000-0000-4000-8000-000000000000' });
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    }
    const refErrors = await validateLeadRefs(user.organizationId, { ...parsed.data, customerMode: 'new' });
    if (Object.keys(refErrors).length > 0) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: refErrors };
    }
    await updateLead(user, leadId, toLeadInput(parsed.data));
    try {
      revalidatePath('/leasing');
      revalidatePath(`/leasing/leads/${leadId}`);
    } catch {
      /* cache hint only */
    }
    return actionSuccess({ id: leadId });
  } catch (error) {
    return actionFailure(error);
  }
}
