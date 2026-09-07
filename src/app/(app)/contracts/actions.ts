'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/guard';
import { actionFailure, actionSuccess, type ActionResult } from '@/lib/errors';
import {
  createContract,
  updateContractDraft,
  getContractFormReferenceData,
  type CreateContractInput,
} from '@/services/contract-service';
import { getUnitDetail } from '@/services/unit-service';
import { isUuid } from '@/lib/utils';

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

const FREQUENCIES = ['monthly', 'quarterly', 'semi_annual', 'annual'] as const;

const schema = z
  .object({
    tenantId: z.string().uuid('Select a tenant.'),
    propertyId: z.string().uuid('Select a property.'),
    unitId: z.string().uuid('Select a unit.'),
    reservationId: z.string().uuid().optional(),
    startDate: isoDate('Enter a valid start date.'),
    endDate: isoDate('Enter a valid end date.'),
    annualRent: z.coerce.number().positive('Annual rent must be greater than zero.'),
    serviceCharges: z.coerce.number().nonnegative('Must be zero or more.').optional(),
    depositAmount: z.coerce.number().nonnegative('Must be zero or more.').optional(),
    paymentFrequency: enumOf(FREQUENCIES, 'Select a valid payment frequency.'),
    escalationPercent: z.coerce.number().min(0, 'Must be 0-100.').max(100, 'Must be 0-100.').optional(),
    gracePeriodDays: z.coerce.number().int().nonnegative('Must be zero or more.').optional(),
    fitOutPeriodDays: z.coerce.number().int().nonnegative('Must be zero or more.').optional(),
    specialConditions: z.string().trim().max(5000).optional(),
    lessorName: z.string().trim().max(200).optional(),
  })
  .refine((v) => new Date(v.endDate) > new Date(v.startDate), {
    message: 'The end date must be after the start date.',
    path: ['endDate'],
  });

type ParsedContract = z.infer<typeof schema>;

export interface ContractActionResult {
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
    tenantId: g('tenantId'),
    propertyId: g('propertyId'),
    unitId: g('unitId'),
    reservationId: g('reservationId'),
    startDate: g('startDate'),
    endDate: g('endDate'),
    annualRent: g('annualRent'),
    serviceCharges: g('serviceCharges'),
    depositAmount: g('depositAmount'),
    paymentFrequency: g('paymentFrequency'),
    escalationPercent: g('escalationPercent'),
    gracePeriodDays: g('gracePeriodDays'),
    fitOutPeriodDays: g('fitOutPeriodDays'),
    specialConditions: g('specialConditions'),
    lessorName: g('lessorName'),
  };
}

/** Validates every reference id against org-scoped data and enforces that the
 *  unit belongs to the chosen property. The organization always comes from the
 *  session. */
async function validateReferences(organizationId: string, data: ParsedContract): Promise<Record<string, string[]>> {
  const ref = await getContractFormReferenceData(organizationId);
  const errors: Record<string, string[]> = {};
  if (!ref.tenants.some((t) => t.id === data.tenantId)) errors.tenantId = ['Unknown tenant for this organization.'];
  if (!ref.properties.some((p) => p.id === data.propertyId)) errors.propertyId = ['Unknown property for this organization.'];
  const unit = ref.units.find((u) => u.id === data.unitId);
  if (!unit) errors.unitId = ['Unknown unit for this organization.'];
  else if (unit.propertyId !== data.propertyId) errors.unitId = ['Selected unit does not belong to the selected property.'];
  return errors;
}

function toInput(data: ParsedContract): CreateContractInput {
  return {
    tenantId: data.tenantId,
    propertyId: data.propertyId,
    unitId: data.unitId,
    reservationId: data.reservationId,
    startDate: data.startDate,
    endDate: data.endDate,
    annualRent: data.annualRent,
    serviceCharges: data.serviceCharges,
    depositAmount: data.depositAmount,
    paymentFrequency: data.paymentFrequency as CreateContractInput['paymentFrequency'],
    escalationPercent: data.escalationPercent,
    gracePeriodDays: data.gracePeriodDays,
    fitOutPeriodDays: data.fitOutPeriodDays,
    specialConditions: data.specialConditions,
    lessorName: data.lessorName,
  };
}

export async function createContractAction(
  _previous: ActionResult<ContractActionResult> | null,
  formData: FormData,
): Promise<ActionResult<ContractActionResult>> {
  try {
    const user = await requirePermission('contracts:create');
    const parsed = schema.safeParse(readForm(formData));
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    }
    const refErrors = await validateReferences(user.organizationId, parsed.data);
    if (Object.keys(refErrors).length > 0) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: refErrors };
    }
    // createContract enforces BR-003 overlap (friendly business-rule message).
    const created = await createContract(user, toInput(parsed.data));
    try {
      revalidatePath('/contracts');
      revalidatePath('/units');
    } catch {
      /* cache hint only */
    }
    return actionSuccess({ id: created.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateContractAction(
  contractId: string,
  _previous: ActionResult<ContractActionResult> | null,
  formData: FormData,
): Promise<ActionResult<ContractActionResult>> {
  try {
    if (!isUuid(contractId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Contract not found.' } };
    const user = await requirePermission('contracts:edit');
    const parsed = schema.safeParse(readForm(formData));
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    }
    const refErrors = await validateReferences(user.organizationId, parsed.data);
    if (Object.keys(refErrors).length > 0) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: refErrors };
    }
    await updateContractDraft(user, contractId, toInput(parsed.data));
    try {
      revalidatePath('/contracts');
      revalidatePath(`/contracts/${contractId}`);
    } catch {
      /* cache hint only */
    }
    return actionSuccess({ id: contractId });
  } catch (error) {
    return actionFailure(error);
  }
}

export interface UnitContractInfo {
  unitNumber: string;
  code: string;
  propertyName: string;
  buildingName: string | null;
  floorName: string | null;
  typeName: string;
  usageType: string;
  leasableArea: number;
  statusKey: string;
  statusLabel: string;
  availabilityClass: string;
  askingRent: number;
}

/** Availability + pricing snapshot for the selected unit (read-only; the
 *  authoritative contractability check is BR-003 at create time). */
export async function getUnitContractInfoAction(unitId: string): Promise<UnitContractInfo | null> {
  const user = await requirePermission('contracts:create');
  const unit = await getUnitDetail(user.organizationId, unitId);
  if (!unit) return null;
  return {
    unitNumber: unit.unitNumber,
    code: unit.code,
    propertyName: unit.propertyName,
    buildingName: unit.buildingName,
    floorName: unit.floorName,
    typeName: unit.typeName,
    usageType: unit.usageType,
    leasableArea: unit.leasableArea,
    statusKey: unit.statusKey,
    statusLabel: unit.statusLabel,
    availabilityClass: unit.availabilityClass,
    askingRent: unit.askingRent,
  };
}
