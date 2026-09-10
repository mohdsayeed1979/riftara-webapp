'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/guard';
import { actionFailure, actionSuccess, type ActionResult } from '@/lib/errors';
import { isUuid } from '@/lib/utils';
import {
  adminResetPassword,
  createUser,
  setUserActive,
  setUserRoles,
  setUserScopes,
  updateUser,
} from '@/services/user-admin-service';

function opt(v: FormDataEntryValue | null): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}
function roleIdsFrom(formData: FormData): string[] {
  return formData.getAll('roleIds').filter((v): v is string => typeof v === 'string' && isUuid(v));
}
function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const fe: Record<string, string[]> = {};
  for (const issue of error.issues) (fe[String(issue.path[0] ?? '_form')] ??= []).push(issue.message);
  return fe;
}

const createSchema = z.object({
  fullName: z.string().trim().min(1, 'Enter the full name.').max(160),
  fullNameAr: z.string().trim().max(160).optional(),
  email: z.string().trim().email('Enter a valid email address.').max(160),
  password: z.string().min(1, 'Enter a temporary password.'),
  jobTitle: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(32).optional(),
  locale: z.enum(['en', 'ar']).optional(),
  isActive: z.coerce.boolean().optional(),
});

export interface UserActionResult {
  id: string;
}

export async function createUserAction(
  _prev: ActionResult<UserActionResult> | null,
  formData: FormData,
): Promise<ActionResult<UserActionResult>> {
  try {
    const user = await requirePermission('users:create');
    const parsed = createSchema.safeParse({
      fullName: opt(formData.get('fullName')),
      fullNameAr: opt(formData.get('fullNameAr')),
      email: opt(formData.get('email')),
      password: opt(formData.get('password')),
      jobTitle: opt(formData.get('jobTitle')),
      phone: opt(formData.get('phone')),
      locale: opt(formData.get('locale')),
      isActive: formData.get('isActive') === 'on' || formData.get('isActive') === 'true',
    });
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    }
    const result = await createUser(user, { ...parsed.data, roleIds: roleIdsFrom(formData) });
    try { revalidatePath('/users'); } catch { /* cache hint */ }
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

const updateSchema = createSchema.omit({ password: true, isActive: true });

export async function updateUserAction(
  userId: string,
  _prev: ActionResult<UserActionResult> | null,
  formData: FormData,
): Promise<ActionResult<UserActionResult>> {
  try {
    if (!isUuid(userId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'User not found.' } };
    const actor = await requirePermission('users:edit');
    const parsed = updateSchema.safeParse({
      fullName: opt(formData.get('fullName')),
      fullNameAr: opt(formData.get('fullNameAr')),
      email: opt(formData.get('email')),
      jobTitle: opt(formData.get('jobTitle')),
      phone: opt(formData.get('phone')),
      locale: opt(formData.get('locale')),
    });
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' }, fieldErrors: fieldErrorsOf(parsed.error) };
    }
    const result = await updateUser(actor, userId, parsed.data);
    try { revalidatePath('/users'); revalidatePath(`/users/${userId}`); } catch { /* cache hint */ }
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function setUserActiveAction(userId: string, active: boolean): Promise<ActionResult<{ id: string; isActive: boolean }>> {
  try {
    if (!isUuid(userId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'User not found.' } };
    const actor = await requirePermission('users:edit');
    const result = await setUserActive(actor, userId, active);
    try { revalidatePath('/users'); revalidatePath(`/users/${userId}`); } catch { /* cache hint */ }
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function setUserRolesAction(userId: string, roleIds: string[]): Promise<ActionResult<{ id: string }>> {
  try {
    if (!isUuid(userId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'User not found.' } };
    const actor = await requirePermission('users:manage');
    const validIds = roleIds.filter((id) => isUuid(id));
    const result = await setUserRoles(actor, userId, validIds);
    try { revalidatePath('/users'); revalidatePath(`/users/${userId}`); } catch { /* cache hint */ }
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function setUserScopesAction(userId: string, propertyIds: string[], cityIds: string[]): Promise<ActionResult<{ id: string }>> {
  try {
    if (!isUuid(userId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'User not found.' } };
    const actor = await requirePermission('users:manage');
    const result = await setUserScopes(actor, userId, {
      propertyIds: propertyIds.filter((id) => isUuid(id)),
      cityIds: cityIds.filter((id) => isUuid(id)),
    });
    try { revalidatePath(`/users/${userId}`); revalidatePath('/users'); } catch { /* cache hint */ }
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function adminResetPasswordAction(userId: string, newPassword: string): Promise<ActionResult<{ id: string }>> {
  try {
    if (!isUuid(userId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'User not found.' } };
    const actor = await requirePermission('users:manage');
    const result = await adminResetPassword(actor, userId, newPassword);
    try { revalidatePath(`/users/${userId}`); } catch { /* cache hint */ }
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

/** Administrator resets (disables) a user's MFA — e.g. after a lost device. */
export async function adminResetMfaAction(userId: string): Promise<ActionResult<{ ok: true }>> {
  try {
    if (!isUuid(userId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'User not found.' } };
    const actor = await requirePermission('users:manage');
    const { adminDisableMfa } = await import('@/services/mfa-service');
    const result = await adminDisableMfa(actor, userId);
    try { revalidatePath(`/users/${userId}`); } catch { /* cache hint */ }
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}
