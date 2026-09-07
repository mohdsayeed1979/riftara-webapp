'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/guard';
import { actionFailure, actionSuccess, type ActionResult } from '@/lib/errors';
import {
  IDENTIFICATION_TYPE_VALUES,
  OWNER_TYPE_VALUES,
  OWNERSHIP_DOCUMENT_TYPE_VALUES,
  PROPERTY_CONDITION_VALUES,
  PROPERTY_STATUS_VALUES,
  PROPERTY_USAGE_VALUES,
} from '@/lib/properties/enums';
import {
  createProperty,
  getPropertyFormReferenceData,
  type CreatePropertyInput,
} from '@/services/property-service';

/** Empty / whitespace-only form values become `undefined` so `.optional()`
 *  short-circuits instead of coercing "" to 0. */
function opt(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Radix Switch / checkbox submit "on" (or nothing). */
function bool(value: FormDataEntryValue | null): boolean {
  return value === 'on' || value === 'true' || value === '1';
}

/** Validate a value belongs to an allowed set (the actual allowed values). */
function enumOf(values: readonly string[], message: string) {
  return z.string().refine((v) => values.includes(v), { message });
}
/** ISO calendar date (YYYY-MM-DD) that is also a real date. */
function isoDate(message: string) {
  return z
    .string()
    .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)), { message });
}

const optionalUuid = z.string().uuid('Select a valid option.').optional();
const optionalArea = z.coerce.number().nonnegative('Must be zero or more.').optional();
const optionalCount = z.coerce.number().int('Must be a whole number.').nonnegative('Must be zero or more.').optional();
const optionalYear = z.coerce.number().int().min(1300, 'Enter a valid year.').max(2200, 'Enter a valid year.').optional();

const schema = z.object({
  // Basic
  code: z.string().trim().min(1, 'Property code is required.').max(32, 'Code is too long.'),
  nameEn: z.string().trim().min(1, 'Property name is required.').max(200, 'Name is too long.'),
  nameAr: z.string().trim().max(200).optional(),
  propertyTypeId: z.string().uuid('Select a property type.'),
  usage: enumOf(PROPERTY_USAGE_VALUES, 'Select a valid usage.'),
  status: enumOf(PROPERTY_STATUS_VALUES, 'Select a valid status.'),
  portfolioId: optionalUuid,
  // Location & geography
  regionId: optionalUuid,
  cityId: z.string().uuid('Select a city.'),
  districtId: optionalUuid,
  addressLine: z.string().trim().max(500).optional(),
  nationalAddress: z.string().trim().max(64).optional(),
  latitude: z.coerce.number().min(-90, 'Latitude must be between -90 and 90.').max(90, 'Latitude must be between -90 and 90.').optional(),
  longitude: z.coerce.number().min(-180, 'Longitude must be between -180 and 180.').max(180, 'Longitude must be between -180 and 180.').optional(),
  googleMapsReference: z.string().trim().max(2000).optional(),
  costCenter: z.string().trim().max(48).optional(),
  // Management
  propertyManagerId: optionalUuid,
  leasingManagerId: optionalUuid,
  assetManagerId: optionalUuid,
  acquisitionDate: isoDate('Enter a valid date.').optional(),
  operationalStartDate: isoDate('Enter a valid date.').optional(),
  // Technical
  landArea: optionalArea,
  builtUpArea: optionalArea,
  grossLeasableArea: optionalArea,
  netLeasableArea: optionalArea,
  commonArea: optionalArea,
  parkingArea: optionalArea,
  buildingCount: optionalCount,
  floorCount: optionalCount,
  unitCount: optionalCount,
  constructionYear: optionalYear,
  renovationYear: optionalYear,
  condition: enumOf(PROPERTY_CONDITION_VALUES, 'Select a valid condition.').optional(),
  parkingCapacity: optionalCount,
  elevatorCount: optionalCount,
  hvacType: z.string().trim().max(64).optional(),
  electricalCapacity: z.string().trim().max(64).optional(),
  waterInfrastructure: z.string().trim().max(64).optional(),
  fireFightingSystem: z.boolean(),
  fireAlarmSystem: z.boolean(),
  generator: z.boolean(),
  buildingManagementSystem: z.boolean(),
  cctv: z.boolean(),
  accessControl: z.boolean(),
  loadingFacilities: z.boolean(),
  emergencySystems: z.boolean(),
  // Additional
  descriptionEn: z.string().trim().max(5000).optional(),
  descriptionAr: z.string().trim().max(5000).optional(),
  // Ownership (optional)
  ownerName: z.string().trim().max(200).optional(),
  ownerType: enumOf(OWNER_TYPE_VALUES, 'Select a valid owner type.').optional(),
  ownershipDocumentType: enumOf(OWNERSHIP_DOCUMENT_TYPE_VALUES, 'Select a valid document type.').optional(),
  ownershipDocumentNumber: z.string().trim().max(64).optional(),
  ownershipDocumentDate: isoDate('Enter a valid date.').optional(),
  issuingAuthority: z.string().trim().max(160).optional(),
  identificationType: enumOf(IDENTIFICATION_TYPE_VALUES, 'Select a valid identification type.').optional(),
  identificationNumber: z.string().trim().max(64).optional(),
  commercialRegistration: z.string().trim().max(40).optional(),
  ownershipPercentage: z.coerce.number().min(0, 'Percentage must be between 0 and 100.').max(100, 'Percentage must be between 0 and 100.').optional(),
  authorizedRepresentative: z.string().trim().max(160).optional(),
  ownershipNotes: z.string().trim().max(2000).optional(),
});

export interface CreatePropertyResult {
  id: string;
}

export async function createPropertyAction(
  _previous: ActionResult<CreatePropertyResult> | null,
  formData: FormData,
): Promise<ActionResult<CreatePropertyResult>> {
  try {
    // RBAC: authenticated user must hold properties:create. The org is taken
    // from the session — a client-supplied organizationId is never trusted.
    const user = await requirePermission('properties:create');

    const parsed = schema.safeParse({
      code: opt(formData.get('code')),
      nameEn: opt(formData.get('nameEn')),
      nameAr: opt(formData.get('nameAr')),
      propertyTypeId: opt(formData.get('propertyTypeId')),
      usage: opt(formData.get('usage')),
      status: opt(formData.get('status')),
      portfolioId: opt(formData.get('portfolioId')),
      regionId: opt(formData.get('regionId')),
      cityId: opt(formData.get('cityId')),
      districtId: opt(formData.get('districtId')),
      addressLine: opt(formData.get('addressLine')),
      nationalAddress: opt(formData.get('nationalAddress')),
      latitude: opt(formData.get('latitude')),
      longitude: opt(formData.get('longitude')),
      googleMapsReference: opt(formData.get('googleMapsReference')),
      costCenter: opt(formData.get('costCenter')),
      propertyManagerId: opt(formData.get('propertyManagerId')),
      leasingManagerId: opt(formData.get('leasingManagerId')),
      assetManagerId: opt(formData.get('assetManagerId')),
      acquisitionDate: opt(formData.get('acquisitionDate')),
      operationalStartDate: opt(formData.get('operationalStartDate')),
      landArea: opt(formData.get('landArea')),
      builtUpArea: opt(formData.get('builtUpArea')),
      grossLeasableArea: opt(formData.get('grossLeasableArea')),
      netLeasableArea: opt(formData.get('netLeasableArea')),
      commonArea: opt(formData.get('commonArea')),
      parkingArea: opt(formData.get('parkingArea')),
      buildingCount: opt(formData.get('buildingCount')),
      floorCount: opt(formData.get('floorCount')),
      unitCount: opt(formData.get('unitCount')),
      constructionYear: opt(formData.get('constructionYear')),
      renovationYear: opt(formData.get('renovationYear')),
      condition: opt(formData.get('condition')),
      parkingCapacity: opt(formData.get('parkingCapacity')),
      elevatorCount: opt(formData.get('elevatorCount')),
      hvacType: opt(formData.get('hvacType')),
      electricalCapacity: opt(formData.get('electricalCapacity')),
      waterInfrastructure: opt(formData.get('waterInfrastructure')),
      fireFightingSystem: bool(formData.get('fireFightingSystem')),
      fireAlarmSystem: bool(formData.get('fireAlarmSystem')),
      generator: bool(formData.get('generator')),
      buildingManagementSystem: bool(formData.get('buildingManagementSystem')),
      cctv: bool(formData.get('cctv')),
      accessControl: bool(formData.get('accessControl')),
      loadingFacilities: bool(formData.get('loadingFacilities')),
      emergencySystems: bool(formData.get('emergencySystems')),
      descriptionEn: opt(formData.get('descriptionEn')),
      descriptionAr: opt(formData.get('descriptionAr')),
      ownerName: opt(formData.get('ownerName')),
      ownerType: opt(formData.get('ownerType')),
      ownershipDocumentType: opt(formData.get('ownershipDocumentType')),
      ownershipDocumentNumber: opt(formData.get('ownershipDocumentNumber')),
      ownershipDocumentDate: opt(formData.get('ownershipDocumentDate')),
      issuingAuthority: opt(formData.get('issuingAuthority')),
      identificationType: opt(formData.get('identificationType')),
      identificationNumber: opt(formData.get('identificationNumber')),
      commercialRegistration: opt(formData.get('commercialRegistration')),
      ownershipPercentage: opt(formData.get('ownershipPercentage')),
      authorizedRepresentative: opt(formData.get('authorizedRepresentative')),
      ownershipNotes: opt(formData.get('ownershipNotes')),
    });

    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    }

    const data = parsed.data;

    // Validate every reference id against what actually exists for THIS org,
    // and enforce the Region -> City -> District hierarchy on the server.
    const ref = await getPropertyFormReferenceData(user.organizationId);
    const fieldErrors: Record<string, string[]> = {};

    const typeOk = ref.types.some((t) => t.id === data.propertyTypeId);
    if (!typeOk) fieldErrors.propertyTypeId = ['Unknown property type for this organization.'];

    if (data.portfolioId && !ref.portfolios.some((p) => p.id === data.portfolioId)) {
      fieldErrors.portfolioId = ['Unknown portfolio for this organization.'];
    }
    if (data.regionId && !ref.regions.some((r) => r.id === data.regionId)) {
      fieldErrors.regionId = ['Unknown region for this organization.'];
    }

    const city = ref.cities.find((c) => c.id === data.cityId);
    if (!city) {
      fieldErrors.cityId = ['Unknown city for this organization.'];
    } else if (data.regionId && city.regionId && city.regionId !== data.regionId) {
      fieldErrors.cityId = ['Selected city does not belong to the selected region.'];
    }

    if (data.districtId) {
      const district = ref.districts.find((d) => d.id === data.districtId);
      if (!district) {
        fieldErrors.districtId = ['Unknown district for this organization.'];
      } else if (district.cityId !== data.cityId) {
        fieldErrors.districtId = ['Selected district does not belong to the selected city.'];
      }
    }

    const managerIds = ref.managers.map((m) => m.id);
    for (const key of ['propertyManagerId', 'leasingManagerId', 'assetManagerId'] as const) {
      const value = data[key];
      if (value && !managerIds.includes(value)) fieldErrors[key] = ['Unknown user for this organization.'];
    }

    if (Object.keys(fieldErrors).length > 0) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors };
    }

    // Build the ownership sub-record only when a first owner was provided.
    const ownership: CreatePropertyInput['ownership'] = data.ownerName
      ? {
          documentType: data.ownershipDocumentType ?? 'title_deed',
          documentNumber: data.ownershipDocumentNumber ?? '',
          documentDate: data.ownershipDocumentDate ?? null,
          issuingAuthority: data.issuingAuthority ?? null,
          ownerType: (data.ownerType ?? 'individual') as 'individual' | 'entity',
          ownerName: data.ownerName,
          identificationType: data.identificationType ?? null,
          identificationNumber: data.identificationNumber ?? null,
          commercialRegistration: data.commercialRegistration ?? null,
          ownershipPercentage: data.ownershipPercentage ?? 100,
          authorizedRepresentative: data.authorizedRepresentative ?? null,
          notes: data.ownershipNotes ?? null,
        }
      : null;

    if (ownership && !ownership.documentNumber) {
      return {
        ok: false,
        error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' },
        fieldErrors: { ownershipDocumentNumber: ['Document number is required when an owner is provided.'] },
      };
    }

    const input: CreatePropertyInput = {
      code: data.code,
      nameEn: data.nameEn,
      nameAr: data.nameAr ?? null,
      propertyTypeId: data.propertyTypeId,
      usage: data.usage,
      status: data.status,
      portfolioId: data.portfolioId ?? null,
      regionId: data.regionId ?? null,
      cityId: data.cityId,
      districtId: data.districtId ?? null,
      addressLine: data.addressLine ?? null,
      nationalAddress: data.nationalAddress ?? null,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      googleMapsReference: data.googleMapsReference ?? null,
      costCenter: data.costCenter ?? null,
      propertyManagerId: data.propertyManagerId ?? null,
      leasingManagerId: data.leasingManagerId ?? null,
      assetManagerId: data.assetManagerId ?? null,
      acquisitionDate: data.acquisitionDate ?? null,
      operationalStartDate: data.operationalStartDate ?? null,
      landArea: data.landArea ?? null,
      builtUpArea: data.builtUpArea ?? null,
      grossLeasableArea: data.grossLeasableArea ?? null,
      netLeasableArea: data.netLeasableArea ?? null,
      commonArea: data.commonArea ?? null,
      parkingArea: data.parkingArea ?? null,
      buildingCount: data.buildingCount ?? 0,
      floorCount: data.floorCount ?? 0,
      unitCount: data.unitCount ?? 0,
      constructionYear: data.constructionYear ?? null,
      renovationYear: data.renovationYear ?? null,
      condition: data.condition ?? null,
      parkingCapacity: data.parkingCapacity ?? null,
      elevatorCount: data.elevatorCount ?? null,
      hvacType: data.hvacType ?? null,
      electricalCapacity: data.electricalCapacity ?? null,
      waterInfrastructure: data.waterInfrastructure ?? null,
      fireFightingSystem: data.fireFightingSystem,
      fireAlarmSystem: data.fireAlarmSystem,
      generator: data.generator,
      buildingManagementSystem: data.buildingManagementSystem,
      cctv: data.cctv,
      accessControl: data.accessControl,
      loadingFacilities: data.loadingFacilities,
      emergencySystems: data.emergencySystems,
      descriptionEn: data.descriptionEn ?? null,
      descriptionAr: data.descriptionAr ?? null,
      ownership,
    };

    const created = await createProperty(user, input);
    // Cache revalidation is best-effort: the property is already committed, so a
    // revalidation hiccup must never turn a successful create into an error.
    try {
      revalidatePath('/properties');
      revalidatePath('/dashboard');
    } catch {
      /* ignore — revalidation is a cache hint, not part of the transaction */
    }
    return actionSuccess({ id: created.id });
  } catch (error) {
    // Unique code, FK and check violations are translated to friendly messages
    // by actionFailure -> translateDatabaseError. Raw DB errors never surface.
    return actionFailure(error);
  }
}

function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '_form');
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}
