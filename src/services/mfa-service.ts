import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { mfaRecoveryCodes, userMfa, users } from '@/db/schema';
import { recordAudit } from '@/lib/audit';
import { AppError, conflict, forbidden, validationError } from '@/lib/errors';
import type { SessionUser } from '@/lib/auth/session';
import {
  buildOtpauthUri,
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotp,
} from '@/lib/auth/mfa';
import { otpauthQrSvg } from '@/lib/auth/mfa-qr';

/**
 * MFA orchestration service (BRD §148-149). All operations are organization- and
 * user-scoped, audited via the existing audit trail, and rate-limited. Raw
 * secrets and recovery codes are never returned except once at enrollment /
 * regeneration, and never logged.
 */

/* --------------------------- Rate limiting ------------------------------- */

interface Bucket { count: number; resetAt: number; }
const buckets = new Map<string, Bucket>();

/** Fixed-window limiter for sensitive MFA operations (verification/activation). */
export function enforceMfaRate(key: string, limit = 5, windowMs = 60_000): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    throw new AppError('RATE_LIMITED', 'Too many attempts. Please wait a moment and try again.');
  }
}

/** Test hook: clears limiter state between cases. */
export function resetMfaRateLimiter(): void {
  buckets.clear();
}

/* ------------------------------- Status ---------------------------------- */

export interface MfaStatus {
  enrolled: boolean;   // a secret exists (activated or pending)
  activated: boolean;  // fully enabled
  recoveryCodesRemaining: number;
}

async function loadRow(userId: string) {
  const db = await getDb();
  const [row] = await db.select().from(userMfa).where(and(eq(userMfa.userId, userId), isNull(userMfa.deletedAt))).limit(1);
  return row ?? null;
}

export async function getMfaStatus(userId: string): Promise<MfaStatus> {
  const db = await getDb();
  const row = await loadRow(userId);
  if (!row) return { enrolled: false, activated: false, recoveryCodesRemaining: 0 };
  const remaining = await db
    .select({ id: mfaRecoveryCodes.id })
    .from(mfaRecoveryCodes)
    .where(and(eq(mfaRecoveryCodes.userMfaId, row.id), isNull(mfaRecoveryCodes.usedAt)));
  return { enrolled: true, activated: row.activatedAt !== null, recoveryCodesRemaining: remaining.length };
}

/* ------------------------------ Enrollment ------------------------------- */

export interface EnrollmentChallenge {
  manualKey: string;
  otpauthUri: string;
  qrSvg: string;
}

/**
 * Starts (or restarts) enrollment: creates a fresh, un-activated secret and
 * returns the provisioning material. Fails if MFA is already active — the user
 * must disable it first. The secret is only ever exposed here.
 */
export async function beginMfaEnrollment(actor: SessionUser): Promise<EnrollmentChallenge> {
  const db = await getDb();
  const existing = await loadRow(actor.id);
  if (existing?.activatedAt) throw conflict('Multi-factor authentication is already enabled. Disable it first to re-enroll.');

  const secret = generateTotpSecret();
  const encryptedSecret = encryptSecret(secret);

  if (existing) {
    await db.update(userMfa).set({ encryptedSecret, activatedAt: null, updatedAt: new Date() }).where(eq(userMfa.id, existing.id));
    await db.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userMfaId, existing.id));
  } else {
    await db.insert(userMfa).values({ userId: actor.id, organizationId: actor.organizationId, encryptedSecret });
  }

  const otpauthUri = buildOtpauthUri(secret, actor.email);
  return { manualKey: secret, otpauthUri, qrSvg: otpauthQrSvg(otpauthUri) };
}

/**
 * Verifies the first code and, on success, enables MFA and issues one-time
 * recovery codes (returned in plaintext exactly once). Rate-limited.
 */
export async function activateMfa(actor: SessionUser, code: string): Promise<{ recoveryCodes: string[] }> {
  enforceMfaRate(`mfa:activate:${actor.id}`);
  const db = await getDb();
  const row = await loadRow(actor.id);
  if (!row) throw validationError('Start enrollment before verifying a code.');
  if (row.activatedAt) throw conflict('Multi-factor authentication is already enabled.');

  const secret = decryptSecret(row.encryptedSecret);
  if (!verifyTotp(secret, code)) throw validationError('That code is not valid. Check your authenticator app and try again.');

  const recoveryCodes = generateRecoveryCodes();
  await db.transaction(async (tx) => {
    await tx.update(userMfa).set({ activatedAt: new Date(), lastUsedAt: new Date(), updatedAt: new Date() }).where(eq(userMfa.id, row.id));
    await tx.update(users).set({ mfaEnabled: true, updatedAt: new Date() }).where(eq(users.id, actor.id));
    await tx.insert(mfaRecoveryCodes).values(
      recoveryCodes.map((rc) => ({ userMfaId: row.id, organizationId: actor.organizationId, codeHash: hashRecoveryCode(rc) })),
    );
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'user_mfa',
      entityId: actor.id,
      entityLabel: actor.email,
      reason: 'mfa_enabled',
      actor: { id: actor.id, fullName: actor.fullName },
    });
  });
  return { recoveryCodes };
}

/** Disables MFA after re-verifying with a valid TOTP or recovery code. */
export async function disableMfa(actor: SessionUser, code: string): Promise<{ ok: true }> {
  enforceMfaRate(`mfa:disable:${actor.id}`);
  const db = await getDb();
  const row = await loadRow(actor.id);
  if (!row || !row.activatedAt) throw conflict('Multi-factor authentication is not enabled.');

  const verification = await verifyOwnedCode(row.id, decryptSecret(row.encryptedSecret), code);
  if (!verification) throw validationError('That code is not valid.');

  await db.transaction(async (tx) => {
    await tx.delete(userMfa).where(eq(userMfa.id, row.id)); // cascade removes recovery codes
    await tx.update(users).set({ mfaEnabled: false, updatedAt: new Date() }).where(eq(users.id, actor.id));
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'user_mfa',
      entityId: actor.id,
      entityLabel: actor.email,
      reason: 'mfa_disabled',
      actor: { id: actor.id, fullName: actor.fullName },
    });
  });
  return { ok: true };
}

/** Regenerates recovery codes (invalidating all previous ones) after TOTP re-verification. */
export async function regenerateRecoveryCodes(actor: SessionUser, code: string): Promise<{ recoveryCodes: string[] }> {
  enforceMfaRate(`mfa:regen:${actor.id}`);
  const db = await getDb();
  const row = await loadRow(actor.id);
  if (!row || !row.activatedAt) throw conflict('Multi-factor authentication is not enabled.');
  if (!verifyTotp(decryptSecret(row.encryptedSecret), code)) throw validationError('That code is not valid.');

  const recoveryCodes = generateRecoveryCodes();
  await db.transaction(async (tx) => {
    await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userMfaId, row.id));
    await tx.insert(mfaRecoveryCodes).values(
      recoveryCodes.map((rc) => ({ userMfaId: row.id, organizationId: actor.organizationId, codeHash: hashRecoveryCode(rc) })),
    );
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'user_mfa',
      entityId: actor.id,
      entityLabel: actor.email,
      reason: 'mfa_recovery_regenerated',
      actor: { id: actor.id, fullName: actor.fullName },
    });
  });
  return { recoveryCodes };
}

/**
 * Verifies a code against a user's MFA, consuming a recovery code if that is
 * what matched. Returns which factor succeeded, or null. Used at login and for
 * sensitive re-verification. Never reveals whether a secret exists to callers.
 */
async function verifyOwnedCode(userMfaId: string, secret: string, code: string): Promise<'totp' | 'recovery' | null> {
  if (verifyTotp(secret, code)) return 'totp';
  const db = await getDb();
  const hash = hashRecoveryCode(code);
  const [match] = await db
    .select({ id: mfaRecoveryCodes.id })
    .from(mfaRecoveryCodes)
    .where(and(eq(mfaRecoveryCodes.userMfaId, userMfaId), eq(mfaRecoveryCodes.codeHash, hash), isNull(mfaRecoveryCodes.usedAt)))
    .limit(1);
  if (!match) return null;
  await db.update(mfaRecoveryCodes).set({ usedAt: new Date() }).where(eq(mfaRecoveryCodes.id, match.id));
  return 'recovery';
}

/**
 * Login-challenge verification (called after a correct password). Rate-limited
 * per user. On success updates `lastUsedAt`. Returns the factor used or null;
 * the caller (auth-service) owns session creation and audit.
 */
export async function verifyLoginChallenge(userId: string, organizationId: string, code: string): Promise<'totp' | 'recovery' | null> {
  enforceMfaRate(`mfa:login:${userId}`, 5, 60_000);
  const row = await loadRow(userId);
  if (!row || !row.activatedAt) return null;
  const result = await verifyOwnedCode(row.id, decryptSecret(row.encryptedSecret), code);
  if (result) {
    const db = await getDb();
    await db.update(userMfa).set({ lastUsedAt: new Date() }).where(eq(userMfa.id, row.id));
  }
  return result;
}

/** True when the user has activated MFA — used by the login flow to branch. */
export async function isMfaActive(userId: string): Promise<boolean> {
  const row = await loadRow(userId);
  return Boolean(row?.activatedAt);
}

/**
 * Administrative reset: an authorized administrator disables MFA for another
 * user in their organization (e.g. lost device). Cannot enroll on their behalf.
 * The caller must hold `users:manage` (enforced in the server action).
 */
export async function adminDisableMfa(admin: SessionUser, targetUserId: string): Promise<{ ok: true }> {
  const db = await getDb();
  const [target] = await db
    .select({ id: users.id, email: users.email, organizationId: users.organizationId })
    .from(users)
    .where(and(eq(users.id, targetUserId), eq(users.organizationId, admin.organizationId), isNull(users.deletedAt)))
    .limit(1);
  if (!target) throw forbidden('You cannot manage this user.');

  const row = await loadRow(targetUserId);
  await db.transaction(async (tx) => {
    if (row) await tx.delete(userMfa).where(eq(userMfa.id, row.id));
    await tx.update(users).set({ mfaEnabled: false, updatedAt: new Date() }).where(eq(users.id, targetUserId));
    await recordAudit(tx, {
      organizationId: admin.organizationId,
      action: 'update',
      entityType: 'user_mfa',
      entityId: targetUserId,
      entityLabel: target.email,
      reason: 'mfa_disabled_by_admin',
      actor: { id: admin.id, fullName: admin.fullName },
    });
  });
  return { ok: true };
}
