'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/guard';
import { actionFailure, actionSuccess, type ErrorPayload } from '@/lib/errors';
import { isUuid } from '@/lib/utils';
import { CUSTOMER_PRIORITY_VALUES, CUSTOMER_TYPE_VALUES } from '@/lib/parties/enums';
import {
  createCustomerWithDeduplication,
  detectDuplicates,
  updateCustomer,
  type CreateCustomerInput,
  type DuplicateMatch,
} from '@/services/customer-service';

function opt(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t === '' ? undefined : t;
}
function bool(value: FormDataEntryValue | null): boolean {
  return value === 'on' || value === 'true' || value === '1';
}
function enumOf(values: readonly string[], message: string) {
  return z.string().refine((v) => values.includes(v), { message });
}
function isoDate(message: string) {
  return z.string().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)), { message });
}

const schema = z
  .object({
    customerType: enumOf(CUSTOMER_TYPE_VALUES, 'Select a valid customer type.'),
    fullNameEn: z.string().trim().min(1, 'Name is required.').max(200),
    fullNameAr: z.string().trim().max(200).optional(),
    companyName: z.string().trim().max(200).optional(),
    mobile: z.string().trim().max(32).optional(),
    alternateMobile: z.string().trim().max(32).optional(),
    email: z.string().trim().email('Enter a valid email.').max(160).optional(),
    nationalId: z.string().trim().max(64).optional(),
    nationalIdExpiry: isoDate('Enter a valid date.').optional(),
    iqama: z.string().trim().max(64).optional(),
    iqamaExpiry: isoDate('Enter a valid date.').optional(),
    commercialRegistration: z.string().trim().max(40).optional(),
    commercialRegistrationExpiry: isoDate('Enter a valid date.').optional(),
    nationality: z.string().trim().max(64).optional(),
    employer: z.string().trim().max(160).optional(),
    monthlyIncome: z.coerce.number().nonnegative('Must be zero or more.').optional(),
    businessActivity: z.string().trim().max(160).optional(),
    unifiedNumber: z.string().trim().max(40).optional(),
    vatNumber: z.string().trim().max(40).optional(),
    authorizedRepresentative: z.string().trim().max(160).optional(),
    addressLine: z.string().trim().max(500).optional(),
    notes: z.string().trim().max(5000).optional(),
    priority: enumOf(CUSTOMER_PRIORITY_VALUES, 'Select a valid priority.').optional(),
    tags: z.string().trim().max(500).optional(),
    marketingConsent: z.boolean(),
    communicationConsent: z.boolean(),
  })
  .refine((v) => v.customerType !== 'corporate' || Boolean(v.companyName), {
    message: 'Company name is required for a corporate customer.',
    path: ['companyName'],
  });

type ParsedCustomer = z.infer<typeof schema>;

export interface CustomerActionData {
  id: string;
}
export type CustomerActionResult =
  | { ok: true; data: CustomerActionData }
  | { ok: false; error: ErrorPayload; fieldErrors?: Record<string, string[]>; duplicates?: DuplicateMatch[] };

function readForm(formData: FormData) {
  const g = (k: string) => opt(formData.get(k));
  return {
    customerType: g('customerType'),
    fullNameEn: g('fullNameEn'),
    fullNameAr: g('fullNameAr'),
    companyName: g('companyName'),
    mobile: g('mobile'),
    alternateMobile: g('alternateMobile'),
    email: g('email'),
    nationalId: g('nationalId'),
    nationalIdExpiry: g('nationalIdExpiry'),
    iqama: g('iqama'),
    iqamaExpiry: g('iqamaExpiry'),
    commercialRegistration: g('commercialRegistration'),
    commercialRegistrationExpiry: g('commercialRegistrationExpiry'),
    nationality: g('nationality'),
    employer: g('employer'),
    monthlyIncome: g('monthlyIncome'),
    businessActivity: g('businessActivity'),
    unifiedNumber: g('unifiedNumber'),
    vatNumber: g('vatNumber'),
    authorizedRepresentative: g('authorizedRepresentative'),
    addressLine: g('addressLine'),
    notes: g('notes'),
    priority: g('priority'),
    tags: g('tags'),
    marketingConsent: bool(formData.get('marketingConsent')),
    communicationConsent: bool(formData.get('communicationConsent')),
  };
}

function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const fe: Record<string, string[]> = {};
  for (const issue of error.issues) (fe[String(issue.path[0] ?? '_form')] ??= []).push(issue.message);
  return fe;
}

function toInput(data: ParsedCustomer): CreateCustomerInput {
  return {
    customerType: data.customerType as 'individual' | 'corporate',
    fullNameEn: data.fullNameEn,
    fullNameAr: data.fullNameAr ?? null,
    companyName: data.companyName ?? null,
    mobile: data.mobile ?? null,
    alternateMobile: data.alternateMobile ?? null,
    email: data.email ?? null,
    nationalId: data.nationalId ?? null,
    nationalIdExpiry: data.nationalIdExpiry ?? null,
    iqama: data.iqama ?? null,
    iqamaExpiry: data.iqamaExpiry ?? null,
    commercialRegistration: data.commercialRegistration ?? null,
    commercialRegistrationExpiry: data.commercialRegistrationExpiry ?? null,
    nationality: data.nationality ?? null,
    employer: data.employer ?? null,
    monthlyIncome: typeof data.monthlyIncome === 'number' ? data.monthlyIncome : null,
    businessActivity: data.businessActivity ?? null,
    unifiedNumber: data.unifiedNumber ?? null,
    vatNumber: data.vatNumber ?? null,
    authorizedRepresentative: data.authorizedRepresentative ?? null,
    addressLine: data.addressLine ?? null,
    notes: data.notes ?? null,
    priority: data.priority ?? 'medium',
    tags: data.tags ? data.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    marketingConsent: data.marketingConsent,
    communicationConsent: data.communicationConsent,
  };
}

export async function createCustomerAction(
  _previous: CustomerActionResult | null,
  formData: FormData,
): Promise<CustomerActionResult> {
  try {
    const user = await requirePermission('customers:create');
    const parsed = schema.safeParse(readForm(formData));
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    }
    const data = parsed.data;
    const confirmed = formData.get('confirmed') === 'true';

    // Duplicate detection (BR-007) — warn before creating unless confirmed.
    if (!confirmed) {
      const duplicates = await detectDuplicates(user.organizationId, {
        mobile: data.mobile,
        email: data.email,
        national_id: data.nationalId,
        iqama: data.iqama,
        commercial_registration: data.commercialRegistration,
      });
      if (duplicates.length > 0) {
        return {
          ok: false,
          error: { code: 'CONFLICT', message: 'Possible existing customer found.' },
          duplicates,
        };
      }
    }

    // linkOnDuplicate:false → actually insert; a colliding identifier surfaces
    // as a friendly BR-007 conflict via translateDatabaseError.
    const result = await createCustomerWithDeduplication(user, toInput(data), { linkOnDuplicate: false });
    try {
      revalidatePath('/leasing/customers');
    } catch {
      /* cache hint only */
    }
    return actionSuccess({ id: result.customerId });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateCustomerAction(
  customerId: string,
  _previous: CustomerActionResult | null,
  formData: FormData,
): Promise<CustomerActionResult> {
  try {
    if (!isUuid(customerId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Customer not found.' } };
    const user = await requirePermission('customers:edit');
    const parsed = schema.safeParse(readForm(formData));
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    }
    await updateCustomer(user, customerId, toInput(parsed.data));
    try {
      revalidatePath('/leasing/customers');
      revalidatePath(`/leasing/customers/${customerId}`);
    } catch {
      /* cache hint only */
    }
    return actionSuccess({ id: customerId });
  } catch (error) {
    return actionFailure(error);
  }
}
