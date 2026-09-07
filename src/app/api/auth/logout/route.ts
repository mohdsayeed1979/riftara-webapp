import { getSession } from '@/lib/auth/session';
import { apiError, apiSuccess } from '@/lib/api/response';
import { signOut } from '@/services/auth-service';

export const dynamic = 'force-dynamic';

/** POST /api/auth/logout — revokes the session and clears the cookie. */
export async function POST() {
  try {
    const user = await getSession();
    await signOut(user);
    return apiSuccess({ signedOut: true });
  } catch (error) {
    return apiError(error);
  }
}
