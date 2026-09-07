'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/guard';
import { actionFailure, actionSuccess, type ActionResult } from '@/lib/errors';
import { BUILDING_STATUS_VALUES } from '@/lib/units/enums';
import {
  archiveBuilding,
  archiveFloor,
  createBuilding,
  createFloor,
  updateBuilding,
  updateFloor,
} from '@/services/building-service';

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
const optCount = z.coerce.number().int('Must be a whole number.').nonnegative('Must be zero or more.').optional();
const optArea = z.coerce.number().nonnegative('Must be zero or more.').optional();
const optYear = z.coerce.number().int().min(1300, 'Enter a valid year.').max(2200, 'Enter a valid year.').optional();

const buildingSchema = z.object({
  propertyId: z.string().uuid('A valid property is required.'),
  code: z.string().trim().min(1, 'Building code is required.').max(32),
  nameEn: z.string().trim().min(1, 'Building name is required.').max(160),
  nameAr: z.string().trim().max(160).optional(),
  status: z.string().refine((v) => BUILDING_STATUS_VALUES.includes(v), { message: 'Select a valid status.' }).optional(),
  floorCount: optCount,
  grossLeasableArea: optArea,
  constructionYear: optYear,
  elevatorCount: optCount,
  parkingCapacity: optCount,
});

export interface EntityActionResult {
  id: string;
}

export async function createBuildingAction(
  _prev: ActionResult<EntityActionResult> | null,
  formData: FormData,
): Promise<ActionResult<EntityActionResult>> {
  try {
    const user = await requirePermission('buildings:create');
    const parsed = buildingSchema.safeParse({
      propertyId: opt(formData.get('propertyId')),
      code: opt(formData.get('code')),
      nameEn: opt(formData.get('nameEn')),
      nameAr: opt(formData.get('nameAr')),
      status: opt(formData.get('status')),
      floorCount: opt(formData.get('floorCount')),
      grossLeasableArea: opt(formData.get('grossLeasableArea')),
      constructionYear: opt(formData.get('constructionYear')),
      elevatorCount: opt(formData.get('elevatorCount')),
      parkingCapacity: opt(formData.get('parkingCapacity')),
    });
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    }
    const created = await createBuilding(user, parsed.data);
    revalidateProperty(parsed.data.propertyId);
    return actionSuccess({ id: created.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateBuildingAction(
  buildingId: string,
  propertyId: string,
  _prev: ActionResult<EntityActionResult> | null,
  formData: FormData,
): Promise<ActionResult<EntityActionResult>> {
  try {
    const user = await requirePermission('buildings:edit');
    const parsed = buildingSchema.omit({ propertyId: true }).safeParse({
      code: opt(formData.get('code')),
      nameEn: opt(formData.get('nameEn')),
      nameAr: opt(formData.get('nameAr')),
      status: opt(formData.get('status')),
      floorCount: opt(formData.get('floorCount')),
      grossLeasableArea: opt(formData.get('grossLeasableArea')),
      constructionYear: opt(formData.get('constructionYear')),
      elevatorCount: opt(formData.get('elevatorCount')),
      parkingCapacity: opt(formData.get('parkingCapacity')),
    });
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    }
    await updateBuilding(user, { id: buildingId, ...parsed.data });
    revalidateProperty(propertyId);
    return actionSuccess({ id: buildingId });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function archiveBuildingAction(
  buildingId: string,
  propertyId: string,
): Promise<ActionResult<EntityActionResult>> {
  try {
    const user = await requirePermission('buildings:delete');
    await archiveBuilding(user, buildingId);
    revalidateProperty(propertyId);
    return actionSuccess({ id: buildingId });
  } catch (error) {
    return actionFailure(error);
  }
}

const floorSchema = z.object({
  buildingId: z.string().uuid('A valid building is required.'),
  level: z.coerce.number().int('Floor level must be a whole number.'),
  nameEn: z.string().trim().min(1, 'Floor name is required.').max(120),
  nameAr: z.string().trim().max(120).optional(),
  grossArea: optArea,
  floorPlanUrl: z.string().trim().max(2000).optional(),
});

export async function createFloorAction(
  propertyId: string,
  _prev: ActionResult<EntityActionResult> | null,
  formData: FormData,
): Promise<ActionResult<EntityActionResult>> {
  try {
    const user = await requirePermission('buildings:edit');
    const parsed = floorSchema.safeParse({
      buildingId: opt(formData.get('buildingId')),
      level: opt(formData.get('level')),
      nameEn: opt(formData.get('nameEn')),
      nameAr: opt(formData.get('nameAr')),
      grossArea: opt(formData.get('grossArea')),
      floorPlanUrl: opt(formData.get('floorPlanUrl')),
    });
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    }
    const created = await createFloor(user, parsed.data);
    revalidateProperty(propertyId);
    return actionSuccess({ id: created.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateFloorAction(
  floorId: string,
  propertyId: string,
  _prev: ActionResult<EntityActionResult> | null,
  formData: FormData,
): Promise<ActionResult<EntityActionResult>> {
  try {
    const user = await requirePermission('buildings:edit');
    const parsed = floorSchema.omit({ buildingId: true }).safeParse({
      level: opt(formData.get('level')),
      nameEn: opt(formData.get('nameEn')),
      nameAr: opt(formData.get('nameAr')),
      grossArea: opt(formData.get('grossArea')),
      floorPlanUrl: opt(formData.get('floorPlanUrl')),
    });
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    }
    await updateFloor(user, { id: floorId, ...parsed.data });
    revalidateProperty(propertyId);
    return actionSuccess({ id: floorId });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function archiveFloorAction(
  floorId: string,
  propertyId: string,
): Promise<ActionResult<EntityActionResult>> {
  try {
    const user = await requirePermission('buildings:edit');
    await archiveFloor(user, floorId);
    revalidateProperty(propertyId);
    return actionSuccess({ id: floorId });
  } catch (error) {
    return actionFailure(error);
  }
}

function revalidateProperty(propertyId: string) {
  try {
    revalidatePath(`/properties/${propertyId}`);
    revalidatePath('/units');
  } catch {
    /* revalidation is a cache hint, not part of the transaction */
  }
}
