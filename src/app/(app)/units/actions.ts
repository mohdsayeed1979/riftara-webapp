'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/guard';
import { actionFailure, actionSuccess, type ActionResult } from '@/lib/errors';
import { isUuid } from '@/lib/utils';
import {
  FIT_OUT_STATUS_VALUES,
  FURNISHING_STATUS_VALUES,
  UNIT_CONDITION_VALUES,
  UNIT_USAGE_VALUES,
} from '@/lib/units/enums';
import {
  createUnit,
  updateUnit,
  getUnitFormReferenceData,
  type UnitWriteInput,
} from '@/services/unit-service';
import { updateUnitPricing, type PriceField } from '@/services/pricing-service';

function opt(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
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

const optionalUuid = z.string().uuid('Select a valid option.').optional();
const optArea = z.coerce.number().nonnegative('Must be zero or more.').optional();
const optCount = z.coerce.number().int('Must be a whole number.').nonnegative('Must be zero or more.').optional();
const optMoney = z.coerce.number().nonnegative('Must be zero or more.').optional();

const schema = z.object({
  // Hierarchy
  propertyId: z.string().uuid('Select a property.'),
  buildingId: optionalUuid,
  floorId: optionalUuid,
  // Basic
  code: z.string().trim().min(1, 'Unit code is required.').max(40, 'Code is too long.'),
  unitNumber: z.string().trim().min(1, 'Unit number is required.').max(40, 'Unit number is too long.'),
  unitTypeId: z.string().uuid('Select a unit type.'),
  usageType: enumOf(UNIT_USAGE_VALUES, 'Select a valid usage.'),
  statusId: z.string().uuid('Select a status.'),
  // Areas
  grossArea: optArea,
  netArea: optArea,
  leasableArea: optArea,
  terraceArea: optArea,
  balconyArea: optArea,
  storageArea: optArea,
  parkingAllocation: optCount,
  // Rooms
  roomCount: optCount,
  bedroomCount: optCount,
  bathroomCount: optCount,
  hasKitchen: z.boolean(),
  hasMaidRoom: z.boolean(),
  hasDriverRoom: z.boolean(),
  // Furnishing / condition
  furnishingStatus: enumOf(FURNISHING_STATUS_VALUES, 'Select a valid furnishing status.').optional(),
  condition: enumOf(UNIT_CONDITION_VALUES, 'Select a valid condition.').optional(),
  fitOutStatus: enumOf(FIT_OUT_STATUS_VALUES, 'Select a valid fit-out status.').optional(),
  // Utilities / meters
  hvacType: z.string().trim().max(64).optional(),
  electricityMeterNumber: z.string().trim().max(48).optional(),
  waterMeterNumber: z.string().trim().max(48).optional(),
  electricityAccount: z.string().trim().max(48).optional(),
  waterAccount: z.string().trim().max(48).optional(),
  // Commercial
  frontage: optArea,
  ceilingHeight: optArea,
  electricalLoad: z.string().trim().max(64).optional(),
  permittedActivities: z.string().trim().max(2000).optional(),
  signageRights: z.boolean(),
  loadingAccess: z.boolean(),
  deliveryAccess: z.boolean(),
  fireSystem: z.boolean(),
  hvacCapacity: z.string().trim().max(64).optional(),
  utilityCapacity: z.string().trim().max(64).optional(),
  fitOutRequirements: z.string().trim().max(2000).optional(),
  // Availability
  availabilityDate: isoDate('Enter a valid date.').optional(),
  // Additional
  descriptionEn: z.string().trim().max(5000).optional(),
  descriptionAr: z.string().trim().max(5000).optional(),
  // Pricing (optional; persisted via the pricing service to keep price history)
  askingRent: optMoney,
  targetRent: optMoney,
  minimumRent: optMoney,
  approvedRent: optMoney,
  marketRent: optMoney,
  serviceCharges: optMoney,
  depositAmount: optMoney,
  parkingCharges: optMoney,
  otherCharges: optMoney,
});

type ParsedUnit = z.infer<typeof schema>;

export interface UnitActionResult {
  id: string;
}

function readForm(formData: FormData) {
  const get = (k: string) => opt(formData.get(k));
  return {
    propertyId: get('propertyId'),
    buildingId: get('buildingId'),
    floorId: get('floorId'),
    code: get('code'),
    unitNumber: get('unitNumber'),
    unitTypeId: get('unitTypeId'),
    usageType: get('usageType'),
    statusId: get('statusId'),
    grossArea: get('grossArea'),
    netArea: get('netArea'),
    leasableArea: get('leasableArea'),
    terraceArea: get('terraceArea'),
    balconyArea: get('balconyArea'),
    storageArea: get('storageArea'),
    parkingAllocation: get('parkingAllocation'),
    roomCount: get('roomCount'),
    bedroomCount: get('bedroomCount'),
    bathroomCount: get('bathroomCount'),
    hasKitchen: bool(formData.get('hasKitchen')),
    hasMaidRoom: bool(formData.get('hasMaidRoom')),
    hasDriverRoom: bool(formData.get('hasDriverRoom')),
    furnishingStatus: get('furnishingStatus'),
    condition: get('condition'),
    fitOutStatus: get('fitOutStatus'),
    hvacType: get('hvacType'),
    electricityMeterNumber: get('electricityMeterNumber'),
    waterMeterNumber: get('waterMeterNumber'),
    electricityAccount: get('electricityAccount'),
    waterAccount: get('waterAccount'),
    frontage: get('frontage'),
    ceilingHeight: get('ceilingHeight'),
    electricalLoad: get('electricalLoad'),
    permittedActivities: get('permittedActivities'),
    signageRights: bool(formData.get('signageRights')),
    loadingAccess: bool(formData.get('loadingAccess')),
    deliveryAccess: bool(formData.get('deliveryAccess')),
    fireSystem: bool(formData.get('fireSystem')),
    hvacCapacity: get('hvacCapacity'),
    utilityCapacity: get('utilityCapacity'),
    fitOutRequirements: get('fitOutRequirements'),
    availabilityDate: get('availabilityDate'),
    descriptionEn: get('descriptionEn'),
    descriptionAr: get('descriptionAr'),
    askingRent: get('askingRent'),
    targetRent: get('targetRent'),
    minimumRent: get('minimumRent'),
    approvedRent: get('approvedRent'),
    marketRent: get('marketRent'),
    serviceCharges: get('serviceCharges'),
    depositAmount: get('depositAmount'),
    parkingCharges: get('parkingCharges'),
    otherCharges: get('otherCharges'),
  };
}

function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '_form');
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}

function toWriteInput(data: ParsedUnit): UnitWriteInput {
  return {
    propertyId: data.propertyId,
    buildingId: data.buildingId ?? null,
    floorId: data.floorId ?? null,
    code: data.code,
    unitNumber: data.unitNumber,
    unitTypeId: data.unitTypeId,
    usageType: data.usageType,
    statusId: data.statusId,
    grossArea: data.grossArea ?? null,
    netArea: data.netArea ?? null,
    leasableArea: data.leasableArea ?? null,
    terraceArea: data.terraceArea ?? null,
    balconyArea: data.balconyArea ?? null,
    storageArea: data.storageArea ?? null,
    parkingAllocation: data.parkingAllocation ?? 0,
    roomCount: data.roomCount ?? null,
    bedroomCount: data.bedroomCount ?? null,
    bathroomCount: data.bathroomCount ?? null,
    hasKitchen: data.hasKitchen,
    hasMaidRoom: data.hasMaidRoom,
    hasDriverRoom: data.hasDriverRoom,
    furnishingStatus: data.furnishingStatus ?? 'unfurnished',
    hvacType: data.hvacType ?? null,
    electricityMeterNumber: data.electricityMeterNumber ?? null,
    waterMeterNumber: data.waterMeterNumber ?? null,
    electricityAccount: data.electricityAccount ?? null,
    waterAccount: data.waterAccount ?? null,
    condition: data.condition ?? null,
    fitOutStatus: data.fitOutStatus ?? 'shell_core',
    frontage: data.frontage ?? null,
    ceilingHeight: data.ceilingHeight ?? null,
    electricalLoad: data.electricalLoad ?? null,
    permittedActivities: data.permittedActivities
      ? data.permittedActivities.split(',').map((s) => s.trim()).filter(Boolean)
      : [],
    signageRights: data.signageRights,
    loadingAccess: data.loadingAccess,
    deliveryAccess: data.deliveryAccess,
    fireSystem: data.fireSystem,
    hvacCapacity: data.hvacCapacity ?? null,
    utilityCapacity: data.utilityCapacity ?? null,
    fitOutRequirements: data.fitOutRequirements ?? null,
    availabilityDate: data.availabilityDate ?? null,
    descriptionEn: data.descriptionEn ?? null,
    descriptionAr: data.descriptionAr ?? null,
  };
}

function pricingValues(data: ParsedUnit): Partial<Record<PriceField, number>> {
  const values: Partial<Record<PriceField, number>> = {};
  const fields: PriceField[] = [
    'askingRent',
    'targetRent',
    'minimumRent',
    'approvedRent',
    'marketRent',
    'serviceCharges',
    'depositAmount',
    'parkingCharges',
    'otherCharges',
  ];
  for (const field of fields) {
    const value = data[field];
    if (typeof value === 'number') values[field] = value;
  }
  return values;
}

async function validateReferences(organizationId: string, data: ParsedUnit): Promise<Record<string, string[]>> {
  const ref = await getUnitFormReferenceData(organizationId);
  const errors: Record<string, string[]> = {};
  if (!ref.properties.some((p) => p.id === data.propertyId)) errors.propertyId = ['Unknown property for this organization.'];
  if (!ref.types.some((t) => t.id === data.unitTypeId)) errors.unitTypeId = ['Unknown unit type for this organization.'];
  if (!ref.statuses.some((s) => s.id === data.statusId)) errors.statusId = ['Unknown unit status for this organization.'];
  if (data.buildingId) {
    const building = ref.buildings.find((b) => b.id === data.buildingId);
    if (!building) errors.buildingId = ['Unknown building for this organization.'];
    else if (building.propertyId !== data.propertyId) errors.buildingId = ['Selected building does not belong to the selected property.'];
  }
  if (data.floorId) {
    const floor = ref.floors.find((f) => f.id === data.floorId);
    if (!floor) errors.floorId = ['Unknown floor for this organization.'];
    else if (!data.buildingId || floor.buildingId !== data.buildingId) errors.floorId = ['Selected floor does not belong to the selected building.'];
  }
  return errors;
}

export async function createUnitAction(
  _previous: ActionResult<UnitActionResult> | null,
  formData: FormData,
): Promise<ActionResult<UnitActionResult>> {
  try {
    const user = await requirePermission('units:create');
    const parsed = schema.safeParse(readForm(formData));
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    }
    const refErrors = await validateReferences(user.organizationId, parsed.data);
    if (Object.keys(refErrors).length > 0) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: refErrors };
    }

    const created = await createUnit(user, toWriteInput(parsed.data));
    const values = pricingValues(parsed.data);
    if (Object.keys(values).length > 0) {
      await updateUnitPricing(user, { unitId: created.id, values, reason: 'Initial pricing on unit creation' });
    }
    try {
      revalidatePath('/units');
      revalidatePath(`/properties/${parsed.data.propertyId}`);
    } catch {
      /* revalidation is a cache hint, not part of the transaction */
    }
    return actionSuccess({ id: created.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateUnitAction(
  unitId: string,
  _previous: ActionResult<UnitActionResult> | null,
  formData: FormData,
): Promise<ActionResult<UnitActionResult>> {
  try {
    if (!isUuid(unitId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Unit not found.' } };
    const user = await requirePermission('units:edit');
    const parsed = schema.safeParse(readForm(formData));
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    }
    const refErrors = await validateReferences(user.organizationId, parsed.data);
    if (Object.keys(refErrors).length > 0) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: refErrors };
    }

    await updateUnit(user, unitId, toWriteInput(parsed.data));
    const values = pricingValues(parsed.data);
    if (Object.keys(values).length > 0) {
      await updateUnitPricing(user, { unitId, values, reason: 'Pricing updated from unit edit' });
    }
    try {
      revalidatePath('/units');
      revalidatePath(`/units/${unitId}`);
    } catch {
      /* revalidation is a cache hint */
    }
    return actionSuccess({ id: unitId });
  } catch (error) {
    return actionFailure(error);
  }
}
