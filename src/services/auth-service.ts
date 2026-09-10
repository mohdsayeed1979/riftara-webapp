import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { headers } from 'next/headers';
import { getDb } from '@/db/client';
import { loginAttempts, users } from '@/db/schema';
import { recordAudit } from '@/lib/audit';
import { verifyPassword } from '@/lib/auth/password';
import {
  clearMfaChallenge,
  clientIp,
  createMfaChallenge,
  createSession,
  destroySession,
  loadSessionUser,
  readMfaChallenge,
  type SessionUser,
} from '@/lib/auth/session';
import { isMfaActive, verifyLoginChallenge } from '@/services/mfa-service';
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
  /** Password was correct but MFA is enabled — no session created yet. */
  mfaRequired?: boolean;
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

  // Password correct — clear the failure counter and lock.
  await db.update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, user.id));

  // If the user has an active second factor, DO NOT create a session yet. Issue
  // a short-lived MFA challenge; the session is created only after the second
  // factor is verified in completeMfaLogin.
  if (await isMfaActive(user.id)) {
    await createMfaChallenge(user.id, user.organizationId);
    return { ok: true, mfaRequired: true };
  }

  await finalizeLogin(user.id, user.organizationId, normalizedEmail, 'password');
  const sessionUser = await loadSessionUser(user.id);
  if (!sessionUser) throw new AppError('INTERNAL', 'Unable to establish the session.');
  return { ok: true, user: sessionUser };
}

/** Creates the session, records the successful-login attempt and audits it. */
async function finalizeLogin(userId: string, organizationId: string, email: string, factor: 'password' | 'mfa_totp' | 'mfa_recovery'): Promise<void> {
  const db = await getDb();
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  await createSession(userId, organizationId);
  await logAttempt(email, true, factor === 'password' ? undefined : factor);
  await recordAudit(db, {
    organizationId,
    action: 'login',
    entityType: 'user',
    entityId: userId,
    entityLabel: email,
    reason: factor === 'password' ? undefined : 'mfa_challenge_success',
    actor: { id: userId, fullName: email },
  });
}

export type MfaLoginFailure = 'no_challenge' | 'invalid_code';

export interface MfaLoginResult {
  ok: boolean;
  user?: SessionUser;
  failure?: MfaLoginFailure;
}

/**
 * Completes a login that is pending MFA: verifies the code against the challenge
 * cookie, and only then creates the authenticated session. Failures are audited
 * and rate-limited (in mfa-service). Never reveals whether the account exists.
 */
export async function completeMfaLogin(code: string): Promise<MfaLoginResult> {
  const challenge = await readMfaChallenge();
  if (!challenge) return { ok: false, failure: 'no_challenge' };

  const db = await getDb();
  const [user] = await db
    .select({ id: users.id, email: users.email, organizationId: users.organizationId, isActive: users.isActive })
    .from(users)
    .where(and(eq(users.id, challenge.userId), isNull(users.deletedAt)))
    .limit(1);
  if (!user || !user.isActive) {
    await clearMfaChallenge();
    return { ok: false, failure: 'no_challenge' };
  }

  const factor = await verifyLoginChallenge(user.id, user.organizationId, code);
  if (!factor) {
    await logAttempt(user.email, false, 'mfa_challenge_failure');
    await recordAudit(db, {
      organizationId: user.organizationId,
      action: 'login_failed',
      entityType: 'user',
      entityId: user.id,
      entityLabel: user.email,
      reason: 'mfa_challenge_failure',
    });
    return { ok: false, failure: 'invalid_code' };
  }

  await finalizeLogin(user.id, user.organizationId, user.email, factor === 'recovery' ? 'mfa_recovery' : 'mfa_totp');
  if (factor === 'recovery') {
    await recordAudit(db, {
      organizationId: user.organizationId,
      action: 'update',
      entityType: 'user_mfa',
      entityId: user.id,
      entityLabel: user.email,
      reason: 'mfa_recovery_code_used',
    });
  }
  await clearMfaChallenge();
  const sessionUser = await loadSessionUser(user.id);
  if (!sessionUser) throw new AppError('INTERNAL', 'Unable to establish the session.');
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
