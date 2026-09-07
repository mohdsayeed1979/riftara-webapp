import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { headers } from 'next/headers';
import { getDb } from '@/db/client';
import { loginAttempts, users } from '@/db/schema';
import { recordAudit } from '@/lib/audit';
import { verifyPassword } from '@/lib/auth/password';
import { clientIp, createSession, destroySession, loadSessionUser, type SessionUser } from '@/lib/auth/session';
import { AppError } from '@/lib/errors';

/**
 * Credentials authentication with login monitoring, failed-login detection
 * and temporary lockout (BRD 148).
 *
 * Swapping in Supabase Auth means replacing `signIn` with a provider call and
 * keeping `createSession` — the rest of the application depends only on the
 * session, never on the identity provider.
 */

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export type SignInFailure =
  | 'invalid_credentials'
  | 'account_locked'
  | 'account_inactive';

export interface SignInResult {
  ok: boolean;
  user?: SessionUser;
  failure?: SignInFailure;
}

async function logAttempt(email: string, successful: boolean, reason?: string): Promise<void> {
  const db = await getDb();
  const headerList = await headers();
  await db.insert(loginAttempts).values({
    email: email.toLowerCase(),
    successful,
    ipAddress: clientIp(headerList),
    userAgent: headerList.get('user-agent')?.slice(0, 400) ?? null,
    reason: reason ?? null,
  });
}

export async function signIn(email: string, password: string): Promise<SignInResult> {
  const db = await getDb();
  const normalizedEmail = email.trim().toLowerCase();

  const [user] = await db
    .select({
      id: users.id,
      organizationId: users.organizationId,
      email: users.email,
      passwordHash: users.passwordHash,
      fullName: users.fullName,
      isActive: users.isActive,
      failedLoginCount: users.failedLoginCount,
      lockedUntil: users.lockedUntil,
    })
    .from(users)
    .where(and(eq(users.email, normalizedEmail), isNull(users.deletedAt)))
    .limit(1);

  if (!user) {
    // Verify against a dummy hash so response time does not reveal whether
    // the account exists.
    await verifyPassword(password, null);
    await logAttempt(normalizedEmail, false, 'unknown_account');
    return { ok: false, failure: 'invalid_credentials' };
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await logAttempt(normalizedEmail, false, 'locked');
    return { ok: false, failure: 'account_locked' };
  }

  if (!user.isActive) {
    await logAttempt(normalizedEmail, false, 'inactive');
    return { ok: false, failure: 'account_inactive' };
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const failedCount = user.failedLoginCount + 1;
    const shouldLock = failedCount >= MAX_FAILED_ATTEMPTS;
    await db
      .update(users)
      .set({
        failedLoginCount: failedCount,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
      })
      .where(eq(users.id, user.id));

    await logAttempt(normalizedEmail, false, 'bad_password');
    await recordAudit(db, {
      organizationId: user.organizationId,
      action: 'login_failed',
      entityType: 'user',
      entityId: user.id,
      entityLabel: user.email,
      reason: shouldLock ? 'Account locked after repeated failures' : 'Incorrect password',
    });

    return { ok: false, failure: shouldLock ? 'account_locked' : 'invalid_credentials' };
  }

  await db
    .update(users)
    .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(users.id, user.id));

  await createSession(user.id, user.organizationId);
  await logAttempt(normalizedEmail, true);

  const sessionUser = await loadSessionUser(user.id);
  if (!sessionUser) throw new AppError('INTERNAL', 'Unable to establish the session.');

  await recordAudit(db, {
    organizationId: user.organizationId,
    action: 'login',
    entityType: 'user',
    entityId: user.id,
    entityLabel: user.email,
    actor: { id: sessionUser.id, fullName: sessionUser.fullName },
  });

  return { ok: true, user: sessionUser };
}

export async function signOut(user: SessionUser | null): Promise<void> {
  if (user) {
    const db = await getDb();
    await recordAudit(db, {
      organizationId: user.organizationId,
      action: 'logout',
      entityType: 'user',
      entityId: user.id,
      entityLabel: user.email,
      actor: { id: user.id, fullName: user.fullName },
    });
  }
  await destroySession();
}
