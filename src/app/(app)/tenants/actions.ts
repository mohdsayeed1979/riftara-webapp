'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/guard';
import { actionFailure, actionSuccess, type ActionResult } from '@/lib/errors';
import { isUuid } from '@/lib/utils';
import { TENANT_STATUS_VALUES } from '@/lib/parties/enums';
import {
  createTenant,
  updateTenant,
  getTenantFormReferenceData,
  searchCustomers,
  type TenantWriteInput,
} from '@/services/tenant-service';

function opt(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t === '' ? undefined : t;
}
function enumOf(values: readonly string[], message: string) {
  return z.string().refine((v) => values.includes(v), { message });
}
function isoDate(message: string) {
  return z.string().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)), { message });
}

const schema = z.object({
  customerId: z.string().uuid('Select a customer.'),
  displayName: z.string().trim().min(1, 'Display name is required.').max(200),
  displayNameAr: z.string().trim().max(200).optional(),
  industry: z.string().trim().max(120).optional(),
  status: enumOf(TENANT_STATUS_VALUES, 'Select a valid status.'),
  onboardedAt: isoDate('Enter a valid date.').optional(),
  accountManagerId: z.string().uuid('Select a valid account manager.').optional(),
  creditRating: z.string().trim().max(16).optional(),
  notes: z.string().trim().max(5000).optional(),
});

type ParsedTenant = z.infer<typeof schema>;

export interface TenantActionResult {
  id: string;
}

function readForm(formData: FormData) {
  const g = (k: string) => opt(formData.get(k));
  return {
    customerId: g('customerId'),
    displayName: g('displayName'),
    displayNameAr: g('displayNameAr'),
    industry: g('industry'),
    status: g('status'),
    onboardedAt: g('onboardedAt'),
    accountManagerId: g('accountManagerId'),
    creditRating: g('creditRating'),
    notes: g('notes'),
  };
}

function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const fe: Record<string, string[]> = {};
  for (const issue of error.issues) (fe[String(issue.path[0] ?? '_form')] ??= []).push(issue.message);
  return fe;
}

function toInput(data: ParsedTenant): TenantWriteInput {
  return {
    customerId: data.customerId,
    displayName: data.displayName,
    displayNameAr: data.displayNameAr ?? null,
    industry: data.industry ?? null,
    status: data.status,
    onboardedAt: data.onboardedAt ?? null,
    accountManagerId: data.accountManagerId ?? null,
    creditRating: data.creditRating ?? null,
    notes: data.notes ?? null,
  };
}

async function validateReferences(organizationId: string, data: ParsedTenant): Promise<Record<string, string[]>> {
  const ref = await getTenantFormReferenceData(organizationId);
  const errors: Record<string, string[]> = {};
  if (!ref.customers.some((c) => c.id === data.customerId)) errors.customerId = ['Unknown customer for this organization.'];
  if (data.accountManagerId && !ref.managers.some((m) => m.id === data.accountManagerId)) {
    errors.accountManagerId = ['Unknown user for this organization.'];
  }
  return errors;
}

export async function searchCustomersAction(query: string): Promise<Array<{ id: string; label: string }>> {
  const user = await requirePermission('tenants:view');
  const rows = await searchCustomers(user.organizationId, query.trim());
  return rows.map((r) => ({ id: r.id, label: `${r.name}${r.mobile ? ` · ${r.mobile}` : ''} · ${r.code}` }));
}

export async function createTenantAction(
  _previous: ActionResult<TenantActionResult> | null,
  formData: FormData,
): Promise<ActionResult<TenantActionResult>> {
  try {
    const user = await requirePermission('tenants:create');
    const parsed = schema.safeParse(readForm(formData));
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    }
    const refErrors = await validateReferences(user.organizationId, parsed.data);
    if (Object.keys(refErrors).length > 0) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: refErrors };
    }
    const created = await createTenant(user, toInput(parsed.data));
    try {
      revalidatePath('/tenants');
    } catch {
      /* cache hint only */
    }
    return actionSuccess({ id: created.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateTenantAction(
  tenantId: string,
  _previous: ActionResult<TenantActionResult> | null,
  formData: FormData,
): Promise<ActionResult<TenantActionResult>> {
  try {
    if (!isUuid(tenantId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Tenant not found.' } };
    const user = await requirePermission('tenants:edit');
    const parsed = schema.safeParse(readForm(formData));
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    }
    const refErrors = await validateReferences(user.organizationId, parsed.data);
    if (Object.keys(refErrors).length > 0) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: refErrors };
    }
    await updateTenant(user, tenantId, toInput(parsed.data));
    try {
      revalidatePath('/tenants');
      revalidatePath(`/tenants/${tenantId}`);
    } catch {
      /* cache hint only */
    }
    return actionSuccess({ id: tenantId });
  } catch (error) {
    return actionFailure(error);
  }
}
