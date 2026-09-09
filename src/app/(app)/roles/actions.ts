'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/guard';
import { actionFailure, actionSuccess, type ActionResult } from '@/lib/errors';
import { isUuid } from '@/lib/utils';
import { createRole, deleteRole, setRolePermissions, updateRole } from '@/services/role-admin-service';

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

export interface RoleActionResult { id: string; key?: string }

const createSchema = z.object({
  key: z.string().trim().min(2, 'Enter a role key.').max(64),
  nameEn: z.string().trim().min(1, 'Enter the role name.').max(120),
  nameAr: z.string().trim().max(120).optional(),
  description: z.string().trim().max(2000).optional(),
});

export async function createRoleAction(
  _prev: ActionResult<RoleActionResult> | null,
  formData: FormData,
): Promise<ActionResult<RoleActionResult>> {
  try {
    const actor = await requirePermission('users:manage');
    const parsed = createSchema.safeParse({
      key: opt(formData.get('key')),
      nameEn: opt(formData.get('nameEn')),
      nameAr: opt(formData.get('nameAr')),
      description: opt(formData.get('description')),
    });
    if (!parsed.success) return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    const permissionKeys = formData.getAll('permissionKeys').filter((v): v is string => typeof v === 'string');
    const result = await createRole(actor, { ...parsed.data, permissionKeys });
    try { revalidatePath('/roles'); } catch { /* cache hint */ }
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

const updateSchema = createSchema.omit({ key: true });

export async function updateRoleAction(
  roleId: string,
  _prev: ActionResult<RoleActionResult> | null,
  formData: FormData,
): Promise<ActionResult<RoleActionResult>> {
  try {
    if (!isUuid(roleId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Role not found.' } };
    const actor = await requirePermission('users:manage');
    const parsed = updateSchema.safeParse({
      nameEn: opt(formData.get('nameEn')),
      nameAr: opt(formData.get('nameAr')),
      description: opt(formData.get('description')),
    });
    if (!parsed.success) return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    const result = await updateRole(actor, roleId, parsed.data);
    try { revalidatePath('/roles'); revalidatePath(`/roles/${roleId}`); } catch { /* cache hint */ }
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function setRolePermissionsAction(roleId: string, permissionKeys: string[]): Promise<ActionResult<RoleActionResult>> {
  try {
    if (!isUuid(roleId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Role not found.' } };
    const actor = await requirePermission('users:manage');
    const result = await setRolePermissions(actor, roleId, permissionKeys);
    try { revalidatePath('/roles'); revalidatePath(`/roles/${roleId}`); } catch { /* cache hint */ }
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function deleteRoleAction(roleId: string): Promise<ActionResult<RoleActionResult>> {
  try {
    if (!isUuid(roleId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Role not found.' } };
    const actor = await requirePermission('users:manage');
    const result = await deleteRole(actor, roleId);
    try { revalidatePath('/roles'); } catch { /* cache hint */ }
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}
