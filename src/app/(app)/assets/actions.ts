'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/guard';
import { actionFailure, actionSuccess, type ActionResult } from '@/lib/errors';
import { isUuid } from '@/lib/utils';
import {
  ASSET_TYPES,
  assignAsset,
  changeAssetStatus,
  createAsset,
  disposeAsset,
  transferAsset,
  updateAsset,
  type AssetStatus,
} from '@/services/asset-service';

/** Non-terminal statuses reachable via the change-status action. */
const CHANGEABLE_STATUSES = ['operational', 'under_maintenance', 'faulty'] as const;

function opt(v: FormDataEntryValue | null): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const fe: Record<string, string[]> = {};
  for (const issue of error.issues) (fe[String(issue.path[0] ?? '_form')] ??= []).push(issue.message);
  return fe;
}

const writeSchema = z.object({
  code: z.string().trim().max(40).optional(),
  nameEn: z.string().trim().min(1, 'Enter an asset name.').max(160),
  nameAr: z.string().trim().max(160).optional(),
  assetType: z.enum(ASSET_TYPES),
  propertyId: z.string().uuid('Select a property.'),
  buildingId: z.string().uuid('Select a valid building.').optional(),
  location: z.string().trim().max(160).optional(),
  manufacturer: z.string().trim().max(120).optional(),
  modelNumber: z.string().trim().max(80).optional(),
  serialNumber: z.string().trim().max(80).optional(),
  supplierVendorId: z.string().uuid('Select a valid vendor.').optional(),
  purchaseDate: z.string().trim().max(10).optional(),
  purchaseCost: z.coerce.number().nonnegative('Must be zero or more.').optional(),
  warrantyExpiryDate: z.string().trim().max(10).optional(),
});

function readWriteForm(formData: FormData) {
  const g = (k: string) => opt(formData.get(k));
  return {
    code: g('code'),
    nameEn: g('nameEn'),
    nameAr: g('nameAr'),
    assetType: g('assetType'),
    propertyId: g('propertyId'),
    buildingId: g('buildingId'),
    location: g('location'),
    manufacturer: g('manufacturer'),
    modelNumber: g('modelNumber'),
    serialNumber: g('serialNumber'),
    supplierVendorId: g('supplierVendorId'),
    purchaseDate: g('purchaseDate'),
    purchaseCost: g('purchaseCost'),
    warrantyExpiryDate: g('warrantyExpiryDate'),
  };
}

export interface AssetActionResult {
  id: string;
  code?: string;
}

export async function createAssetAction(
  _prev: ActionResult<AssetActionResult> | null,
  formData: FormData,
): Promise<ActionResult<AssetActionResult>> {
  try {
    const user = await requirePermission('assets:create');
    const parsed = writeSchema.safeParse(readWriteForm(formData));
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    }
    const result = await createAsset(user, parsed.data);
    try { revalidatePath('/assets'); } catch { /* cache hint */ }
    return actionSuccess({ id: result.id, code: result.code });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateAssetAction(
  assetId: string,
  _prev: ActionResult<AssetActionResult> | null,
  formData: FormData,
): Promise<ActionResult<AssetActionResult>> {
  try {
    if (!isUuid(assetId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Asset not found.' } };
    const user = await requirePermission('assets:edit');
    // Identity (code) and location (property/building) are not editable here:
    // location changes go through assign/transfer.
    const parsed = writeSchema
      .omit({ code: true, propertyId: true, buildingId: true })
      .safeParse(readWriteForm(formData));
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    }
    const result = await updateAsset(user, assetId, parsed.data);
    try { revalidatePath('/assets'); revalidatePath(`/assets/${assetId}`); } catch { /* cache hint */ }
    return actionSuccess({ id: result.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function assignAssetAction(
  assetId: string,
  input: { buildingId?: string | null; location?: string | null },
): Promise<ActionResult<{ id: string }>> {
  try {
    if (!isUuid(assetId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Asset not found.' } };
    const user = await requirePermission('assets:edit');
    const buildingId = input.buildingId && isUuid(input.buildingId) ? input.buildingId : input.buildingId === null || input.buildingId === '' ? null : undefined;
    const location = input.location === undefined ? undefined : input.location === '' ? null : input.location;
    const result = await assignAsset(user, assetId, { buildingId, location });
    try { revalidatePath('/assets'); revalidatePath(`/assets/${assetId}`); } catch { /* cache hint */ }
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function transferAssetAction(
  assetId: string,
  input: { propertyId: string; buildingId?: string | null; location?: string | null },
): Promise<ActionResult<{ id: string }>> {
  try {
    if (!isUuid(assetId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Asset not found.' } };
    if (!isUuid(input.propertyId)) return { ok: false, error: { code: 'VALIDATION', message: 'Select a valid destination property.' } };
    const user = await requirePermission('assets:edit');
    const buildingId = input.buildingId && isUuid(input.buildingId) ? input.buildingId : null;
    const location = input.location === undefined || input.location === '' ? null : input.location;
    const result = await transferAsset(user, assetId, { propertyId: input.propertyId, buildingId, location });
    try { revalidatePath('/assets'); revalidatePath(`/assets/${assetId}`); } catch { /* cache hint */ }
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function changeAssetStatusAction(
  assetId: string,
  toStatus: string,
): Promise<ActionResult<{ id: string; status: AssetStatus }>> {
  try {
    if (!isUuid(assetId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Asset not found.' } };
    if (!CHANGEABLE_STATUSES.includes(toStatus as (typeof CHANGEABLE_STATUSES)[number])) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Invalid status.' } };
    }
    const user = await requirePermission('assets:edit');
    const result = await changeAssetStatus(user, assetId, toStatus as AssetStatus);
    try { revalidatePath('/assets'); revalidatePath(`/assets/${assetId}`); } catch { /* cache hint */ }
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function disposeAssetAction(
  assetId: string,
  reason: string,
): Promise<ActionResult<{ id: string; status: AssetStatus }>> {
  try {
    if (!isUuid(assetId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Asset not found.' } };
    const trimmed = (reason ?? '').trim();
    if (trimmed.length < 3) return { ok: false, error: { code: 'VALIDATION', message: 'Enter a disposal reason (at least 3 characters).' } };
    // Disposal is a delete-class action: gated by assets:delete.
    const user = await requirePermission('assets:delete');
    const result = await disposeAsset(user, assetId, { reason: trimmed.slice(0, 240) });
    try { revalidatePath('/assets'); revalidatePath(`/assets/${assetId}`); } catch { /* cache hint */ }
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}
