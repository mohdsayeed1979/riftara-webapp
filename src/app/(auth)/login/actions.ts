'use server';

import { z } from 'zod';
import { signIn } from '@/services/auth-service';
import { actionFailure, actionSuccess, type ActionResult } from '@/lib/errors';

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email address.').email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

export interface SignInPayload {
  redirectTo: string;
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

    const raw = formData.get('redirectTo');
    // Only same-origin relative paths are accepted as a post-login destination.
    const redirectTo =
      typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/dashboard';

    return actionSuccess({ redirectTo });
  } catch (error) {
    return actionFailure(error);
  }
}
