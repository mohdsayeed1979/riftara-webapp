'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/guard';
import { actionFailure, actionSuccess, type ActionResult } from '@/lib/errors';
import { isUuid } from '@/lib/utils';
import {
  createReservation,
  cancelReservation,
  getReservationFormReferenceData,
  type CreateReservationInput,
} from '@/services/reservation-service';

function opt(v: FormDataEntryValue | null): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}
function isoDate(message: string) {
  return z.string().refine((x) => /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(x)), { message });
}
const optUuid = z.string().uuid('Select a valid option.').optional();

const schema = z
  .object({
    customerId: z.string().uuid('Select a customer.'),
    leadId: optUuid,
    proposalId: optUuid,
    propertyId: z.string().uuid('Select a property.'),
    unitId: z.string().uuid('Select a unit.'),
    reservationDate: isoDate('Enter a valid reservation date.'),
    expiryDate: isoDate('Enter a valid expiry date.'),
    reservationAmount: z.coerce.number().nonnegative('Must be zero or more.').optional(),
    paymentStatus: z.string().trim().max(24).optional(),
    terms: z.string().trim().max(5000).optional(),
  })
  .refine((v) => new Date(v.expiryDate) >= new Date(v.reservationDate), {
    message: 'The expiry date must be on or after the reservation date.',
    path: ['expiryDate'],
  });

type ParsedReservation = z.infer<typeof schema>;

export interface ReservationActionResult {
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
    customerId: g('customerId'),
    leadId: g('leadId'),
    proposalId: g('proposalId'),
    propertyId: g('propertyId'),
    unitId: g('unitId'),
    reservationDate: g('reservationDate'),
    expiryDate: g('expiryDate'),
    reservationAmount: g('reservationAmount'),
    paymentStatus: g('paymentStatus'),
    terms: g('terms'),
  };
}

async function validateReferences(organizationId: string, data: ParsedReservation): Promise<Record<string, string[]>> {
  const ref = await getReservationFormReferenceData(organizationId);
  const errors: Record<string, string[]> = {};
  if (!ref.customers.some((c) => c.id === data.customerId)) errors.customerId = ['Unknown customer for this organization.'];
  if (!ref.properties.some((p) => p.id === data.propertyId)) errors.propertyId = ['Unknown property for this organization.'];
  const unit = ref.units.find((u) => u.id === data.unitId);
  if (!unit) errors.unitId = ['Unknown unit for this organization.'];
  else if (unit.propertyId !== data.propertyId) errors.unitId = ['Selected unit does not belong to the selected property.'];
  if (data.leadId && !ref.leads.some((l) => l.id === data.leadId)) errors.leadId = ['Unknown lead for this organization.'];
  return errors;
}

function toInput(data: ParsedReservation): CreateReservationInput {
  return {
    customerId: data.customerId,
    leadId: data.leadId ?? null,
    proposalId: data.proposalId ?? null,
    propertyId: data.propertyId,
    unitId: data.unitId,
    reservationDate: data.reservationDate,
    expiryDate: data.expiryDate,
    reservationAmount: data.reservationAmount,
    paymentStatus: data.paymentStatus,
    terms: data.terms,
  };
}

export async function createReservationAction(
  _previous: ActionResult<ReservationActionResult> | null,
  formData: FormData,
): Promise<ActionResult<ReservationActionResult>> {
  try {
    const user = await requirePermission('reservations:create');
    const parsed = schema.safeParse(readForm(formData));
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    }
    const refErrors = await validateReferences(user.organizationId, parsed.data);
    if (Object.keys(refErrors).length > 0) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: refErrors };
    }
    // BR-002 friendly conflict + partial unique index are enforced in the service.
    const created = await createReservation(user, toInput(parsed.data));
    try {
      revalidatePath('/leasing/reservations');
      revalidatePath('/units');
    } catch {
      /* cache hint only */
    }
    return actionSuccess({ id: created.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function cancelReservationAction(
  reservationId: string,
  reason?: string,
): Promise<ActionResult<ReservationActionResult>> {
  try {
    if (!isUuid(reservationId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Reservation not found.' } };
    const user = await requirePermission('reservations:edit');
    await cancelReservation(user, reservationId, reason);
    try {
      revalidatePath('/leasing/reservations');
      revalidatePath(`/leasing/reservations/${reservationId}`);
      revalidatePath('/units');
    } catch {
      /* cache hint only */
    }
    return actionSuccess({ id: reservationId });
  } catch (error) {
    return actionFailure(error);
  }
}
