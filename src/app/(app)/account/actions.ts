'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/guard';
import { actionFailure, actionSuccess, type ActionResult } from '@/lib/errors';
import {
  activateMfa,
  beginMfaEnrollment,
  disableMfa,
  getMfaStatus,
  regenerateRecoveryCodes,
  type EnrollmentChallenge,
  type MfaStatus,
} from '@/services/mfa-service';

const codeSchema = z.object({ code: z.string().trim().min(1) });

export async function getMfaStatusAction(): Promise<ActionResult<MfaStatus>> {
  try {
    const user = await requireUser();
    return actionSuccess(await getMfaStatus(user.id));
  } catch (error) {
    return actionFailure(error);
  }
}

export async function beginEnrollmentAction(): Promise<ActionResult<EnrollmentChallenge>> {
  try {
    const user = await requireUser();
    return actionSuccess(await beginMfaEnrollment(user));
  } catch (error) {
    return actionFailure(error);
  }
}

export async function activateMfaAction(code: string): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  try {
    const user = await requireUser();
    const parsed = codeSchema.safeParse({ code });
    if (!parsed.success) return { ok: false, error: { code: 'VALIDATION', message: 'Enter the 6-digit code.' } };
    const result = await activateMfa(user, parsed.data.code);
    revalidatePath('/account');
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function disableMfaAction(code: string): Promise<ActionResult<{ ok: true }>> {
  try {
    const user = await requireUser();
    const parsed = codeSchema.safeParse({ code });
    if (!parsed.success) return { ok: false, error: { code: 'VALIDATION', message: 'Enter a valid code.' } };
    const result = await disableMfa(user, parsed.data.code);
    revalidatePath('/account');
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function regenerateRecoveryCodesAction(code: string): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  try {
    const user = await requireUser();
    const parsed = codeSchema.safeParse({ code });
    if (!parsed.success) return { ok: false, error: { code: 'VALIDATION', message: 'Enter a valid code.' } };
    const result = await regenerateRecoveryCodes(user, parsed.data.code);
    revalidatePath('/account');
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}
