'use server';

import { z } from 'zod';
import { completeMfaLogin, signIn } from '@/services/auth-service';
import { actionFailure, actionSuccess, type ActionResult } from '@/lib/errors';

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email address.').email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

export interface SignInPayload {
  redirectTo: string;
  /** When true, the password was correct but a second factor is required. */
  mfaRequired?: boolean;
}

function safeRedirect(raw: FormDataEntryValue | null): string {
  return typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/dashboard';
}

export async function signInAction(
  _previous: ActionResult<SignInPayload> | null,
  formData: FormData,
): Promise<ActionResult<SignInPayload>> {
  const parsed = schema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { ok: false, error: { code: 'VALIDATION', message: 'Check the highlighted fields.' }, fieldErrors };
  }

  try {
    const result = await signIn(parsed.data.email, parsed.data.password);

    if (!result.ok) {
      const messages: Record<string, string> = {
        invalid_credentials: 'The email or password is incorrect.',
        account_locked: 'This account is temporarily locked after repeated failed attempts. Try again in 15 minutes.',
        account_inactive: 'This account has been deactivated. Contact your administrator.',
      };
      return {
        ok: false,
        error: {
          code: 'UNAUTHENTICATED',
          message: messages[result.failure ?? 'invalid_credentials'],
        },
      };
    }

    const redirectTo = safeRedirect(formData.get('redirectTo'));

    // Password was correct but a second factor is required — the challenge cookie
    // is already set; the form advances to the MFA step. No session yet.
    if (result.mfaRequired) {
      return actionSuccess({ redirectTo, mfaRequired: true });
    }

    return actionSuccess({ redirectTo });
  } catch (error) {
    return actionFailure(error);
  }
}

const codeSchema = z.object({
  code: z.string().trim().min(1, 'Enter the verification code.'),
});

/**
 * Second step of MFA login: verifies the TOTP or recovery code against the
 * pending challenge and, only on success, establishes the session.
 */
export async function verifyMfaAction(
  _previous: ActionResult<SignInPayload> | null,
  formData: FormData,
): Promise<ActionResult<SignInPayload>> {
  const parsed = codeSchema.safeParse({ code: formData.get('code') });
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Enter the verification code.' } };
  }

  try {
    const result = await completeMfaLogin(parsed.data.code);
    if (!result.ok) {
      const messages: Record<string, string> = {
        no_challenge: 'Your sign-in session expired. Please sign in again.',
        invalid_code: 'That code is not valid. Try again or use a recovery code.',
      };
      return {
        ok: false,
        error: { code: 'UNAUTHENTICATED', message: messages[result.failure ?? 'invalid_code'] },
      };
    }
    return actionSuccess({ redirectTo: safeRedirect(formData.get('redirectTo')) });
  } catch (error) {
    return actionFailure(error);
  }
}
