import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { bootstrapTestDb } from './setup-db';
import type { Database } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';

// In-memory cookie jar so the MFA challenge cookie round-trips through the login flow.
const cookieStore = new Map<string, string>();
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (n: string) => (cookieStore.has(n) ? { name: n, value: cookieStore.get(n)! } : undefined),
    set: (n: string, v: string) => { cookieStore.set(n, v); },
    delete: (n: string) => { cookieStore.delete(n); },
  }),
}));

let db: Database;
let cleanup: () => void;
let admin: SessionUser;

beforeAll(async () => {
  const c = await bootstrapTestDb();
  db = c.db;
  cleanup = c.cleanup;
  const { users } = await import('@/db/schema');
  const { loadSessionUser } = await import('@/lib/auth/session');
  const [u] = await db.select().from(users).where(eq(users.email, 'sayeed.almousa@riftara.sa')).limit(1);
  admin = (await loadSessionUser(u.id))!;
}, 180_000);

afterAll(() => cleanup?.());

beforeEach(async () => {
  cookieStore.clear();
  const { resetMfaRateLimiter } = await import('@/services/mfa-service');
  resetMfaRateLimiter();
});

/** Test-only clean slate: removes any existing MFA rows for a user. */
async function resetUserMfa(userId: string) {
  const { userMfa, users } = await import('@/db/schema');
  await db.delete(userMfa).where(eq(userMfa.userId, userId)); // cascade clears recovery codes
  await db.update(users).set({ mfaEnabled: false }).where(eq(users.id, userId));
}

/** Enrolls + activates MFA for a user from a clean slate; returns secret + recovery codes. */
async function enrollAndActivate(actor: SessionUser) {
  const svc = await import('@/services/mfa-service');
  const { generateTotp } = await import('@/lib/auth/mfa');
  await resetUserMfa(actor.id);
  const { resetMfaRateLimiter } = svc;
  resetMfaRateLimiter();
  const challenge = await svc.beginMfaEnrollment(actor);
  const { recoveryCodes } = await svc.activateMfa(actor, generateTotp(challenge.manualKey));
  return { secret: challenge.manualKey, recoveryCodes };
}

describe('TOTP primitives', () => {
  it('base32 round-trips and TOTP verifies within the window but rejects wrong codes', async () => {
    const { base32Decode, base32Encode, generateTotp, verifyTotp, generateTotpSecret } = await import('@/lib/auth/mfa');
    const secret = generateTotpSecret();
    expect(base32Encode(base32Decode(secret))).toBe(secret);
    const code = generateTotp(secret);
    expect(verifyTotp(secret, code)).toBe(true);
    expect(verifyTotp(secret, '000000')).toBe(false);
    expect(verifyTotp(secret, 'abc')).toBe(false);
  });

  it('encrypts secrets reversibly and never stores them in clear', async () => {
    const { encryptSecret, decryptSecret } = await import('@/lib/auth/mfa');
    const enc = encryptSecret('JBSWY3DPEHPK3PXP');
    expect(enc).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(enc)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('recovery codes are hashed one-way', async () => {
    const { hashRecoveryCode, generateRecoveryCodes } = await import('@/lib/auth/mfa');
    const [code] = generateRecoveryCodes(1);
    const hash = hashRecoveryCode(code);
    expect(hash).not.toContain(code.replace('-', ''));
    expect(hashRecoveryCode(code.toLowerCase())).toBe(hash); // normalized
  });
});

describe('Enrollment', () => {
  it('produces a QR + manual key and does NOT enable MFA until verified', async () => {
    const svc = await import('@/services/mfa-service');
    const { users } = await import('@/db/schema');
    const [u] = await db.select().from(users).where(eq(users.email, 'khalid.alrashid@riftara.sa')).limit(1);
    const { loadSessionUser } = await import('@/lib/auth/session');
    const actor = (await loadSessionUser(u.id))!;

    const challenge = await svc.beginMfaEnrollment(actor);
    expect(challenge.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(challenge.qrSvg).toContain('<svg');
    expect(challenge.manualKey.length).toBeGreaterThanOrEqual(16);

    const status = await svc.getMfaStatus(actor.id);
    expect(status.enrolled).toBe(true);
    expect(status.activated).toBe(false); // not enabled yet
  });

  it('rejects an invalid enrollment code and accepts a valid one, then issues recovery codes', async () => {
    const svc = await import('@/services/mfa-service');
    const { generateTotp } = await import('@/lib/auth/mfa');
    const { users } = await import('@/db/schema');
    const [u] = await db.select().from(users).where(eq(users.email, 'sarah.mohammed@riftara.sa')).limit(1);
    const { loadSessionUser } = await import('@/lib/auth/session');
    const actor = (await loadSessionUser(u.id))!;

    const challenge = await svc.beginMfaEnrollment(actor);
    await expect(svc.activateMfa(actor, '000000')).rejects.toThrow();
    expect((await svc.getMfaStatus(actor.id)).activated).toBe(false);

    const { recoveryCodes } = await svc.activateMfa(actor, generateTotp(challenge.manualKey));
    expect(recoveryCodes).toHaveLength(10);
    const status = await svc.getMfaStatus(actor.id);
    expect(status.activated).toBe(true);
    expect(status.recoveryCodesRemaining).toBe(10);
  });
});

describe('Login challenge', () => {
  it('signIn defers the session when MFA is active and completeMfaLogin finishes it', async () => {
    const auth = await import('@/services/auth-service');
    const { generateTotp } = await import('@/lib/auth/mfa');
    const { users } = await import('@/db/schema');
    const [u] = await db.select().from(users).where(eq(users.email, 'omar.alqahtani@riftara.sa')).limit(1);
    const { loadSessionUser } = await import('@/lib/auth/session');
    const actor = (await loadSessionUser(u.id))!;
    const { secret } = await enrollAndActivate(actor);

    // Password step: correct password, but MFA required → no session yet.
    const first = await auth.signIn('omar.alqahtani@riftara.sa', 'Riftara#2025');
    expect(first.ok).toBe(true);
    expect(first.mfaRequired).toBe(true);
    expect(first.user).toBeUndefined();

    // Wrong code fails; correct code completes the login.
    const bad = await auth.completeMfaLogin('000000');
    expect(bad.ok).toBe(false);
    expect(bad.failure).toBe('invalid_code');

    const good = await auth.completeMfaLogin(generateTotp(secret));
    expect(good.ok).toBe(true);
    expect(good.user?.id).toBe(actor.id);
  });

  it('fails when there is no active challenge (expired/missing)', async () => {
    const auth = await import('@/services/auth-service');
    cookieStore.clear(); // simulate expired/absent challenge cookie
    const result = await auth.completeMfaLogin('123456');
    expect(result.ok).toBe(false);
    expect(result.failure).toBe('no_challenge');
  });

  it('MFA-disabled account logs in normally (regression)', async () => {
    const auth = await import('@/services/auth-service');
    // Ali has not enrolled MFA.
    const result = await auth.signIn('ali.kamal@riftara.sa', 'Riftara#2025');
    expect(result.ok).toBe(true);
    expect(result.mfaRequired).toBeUndefined();
    expect(result.user).toBeTruthy();
  });
});

describe('Recovery codes', () => {
  it('a recovery code logs in once and cannot be reused', async () => {
    const svc = await import('@/services/mfa-service');
    const { users } = await import('@/db/schema');
    const [u] = await db.select().from(users).where(eq(users.email, 'tariq.alnasser@riftara.sa')).limit(1);
    const { loadSessionUser } = await import('@/lib/auth/session');
    const actor = (await loadSessionUser(u.id))!;
    const { recoveryCodes } = await enrollAndActivate(actor);

    const first = await svc.verifyLoginChallenge(actor.id, actor.organizationId, recoveryCodes[0]);
    expect(first).toBe('recovery');
    // Same code cannot be reused.
    const second = await svc.verifyLoginChallenge(actor.id, actor.organizationId, recoveryCodes[0]);
    expect(second).toBeNull();
    expect((await svc.getMfaStatus(actor.id)).recoveryCodesRemaining).toBe(9);
  });

  it('regeneration invalidates previous unused recovery codes', async () => {
    const svc = await import('@/services/mfa-service');
    const { generateTotp } = await import('@/lib/auth/mfa');
    const { users } = await import('@/db/schema');
    const [u] = await db.select().from(users).where(eq(users.email, 'khalid.alrashid@riftara.sa')).limit(1);
    const { loadSessionUser } = await import('@/lib/auth/session');
    const actor = (await loadSessionUser(u.id))!;
    const { secret, recoveryCodes: original } = await enrollAndActivate(actor);

    const { recoveryCodes: regenerated } = await svc.regenerateRecoveryCodes(actor, generateTotp(secret));
    expect(regenerated).toHaveLength(10);
    // An original code no longer works; a regenerated one does.
    expect(await svc.verifyLoginChallenge(actor.id, actor.organizationId, original[0])).toBeNull();
    expect(await svc.verifyLoginChallenge(actor.id, actor.organizationId, regenerated[0])).toBe('recovery');
  });
});

describe('Disable & rate limiting', () => {
  it('disables MFA after re-verification and lets login proceed without a challenge', async () => {
    const svc = await import('@/services/mfa-service');
    const auth = await import('@/services/auth-service');
    const { generateTotp } = await import('@/lib/auth/mfa');
    const { users } = await import('@/db/schema');
    const [u] = await db.select().from(users).where(eq(users.email, 'sarah.mohammed@riftara.sa')).limit(1);
    const { loadSessionUser } = await import('@/lib/auth/session');
    const actor = (await loadSessionUser(u.id))!;
    const { secret } = await enrollAndActivate(actor);
    expect((await svc.getMfaStatus(actor.id)).activated).toBe(true);

    await svc.disableMfa(actor, generateTotp(secret));
    expect((await svc.getMfaStatus(actor.id)).activated).toBe(false);

    cookieStore.clear();
    const login = await auth.signIn('sarah.mohammed@riftara.sa', 'Riftara#2025');
    expect(login.mfaRequired).toBeUndefined();
    expect(login.user).toBeTruthy();
  });

  it('rate-limits repeated verification attempts', async () => {
    const svc = await import('@/services/mfa-service');
    const { users } = await import('@/db/schema');
    const [u] = await db.select().from(users).where(eq(users.email, 'omar.alqahtani@riftara.sa')).limit(1);
    const { loadSessionUser } = await import('@/lib/auth/session');
    const actor = (await loadSessionUser(u.id))!;
    // 5 attempts allowed, the 6th throws.
    for (let i = 0; i < 5; i += 1) {
      await svc.verifyLoginChallenge(actor.id, actor.organizationId, '000000');
    }
    await expect(svc.verifyLoginChallenge(actor.id, actor.organizationId, '000000')).rejects.toThrow();
  });
});

describe('Secret exposure & storage', () => {
  it('never returns the raw secret through status and stores it encrypted', async () => {
    const svc = await import('@/services/mfa-service');
    const { userMfa } = await import('@/db/schema');
    const { users } = await import('@/db/schema');
    const [u] = await db.select().from(users).where(eq(users.email, 'ali.kamal@riftara.sa')).limit(1);
    const { loadSessionUser } = await import('@/lib/auth/session');
    const actor = (await loadSessionUser(u.id))!;
    const challenge = await svc.beginMfaEnrollment(actor);

    const status = await svc.getMfaStatus(actor.id);
    expect(Object.values(status).join(' ')).not.toContain(challenge.manualKey);

    const [row] = await db.select().from(userMfa).where(eq(userMfa.userId, actor.id)).limit(1);
    expect(row.encryptedSecret).not.toContain(challenge.manualKey);
    expect(row.encryptedSecret.split('.').length).toBe(3); // iv.tag.ciphertext
  });
});

describe('Admin RBAC', () => {
  it('an authorized admin can reset another user\'s MFA; the target must be in-org', async () => {
    const svc = await import('@/services/mfa-service');
    const { users } = await import('@/db/schema');
    const [target] = await db.select().from(users).where(eq(users.email, 'tariq.alnasser@riftara.sa')).limit(1);
    const { loadSessionUser } = await import('@/lib/auth/session');
    const targetUser = (await loadSessionUser(target.id))!;
    await enrollAndActivate(targetUser);
    expect((await svc.getMfaStatus(target.id)).activated).toBe(true);

    await svc.adminDisableMfa(admin, target.id);
    expect((await svc.getMfaStatus(target.id)).activated).toBe(false);

    // A foreign target id is refused.
    await expect(svc.adminDisableMfa(admin, '00000000-0000-4000-8000-000000000000')).rejects.toThrow();
  });

  it('the account MFA actions require an authenticated session', async () => {
    // The cookie jar is empty (cleared in beforeEach) → no session → requireUser
    // rejects → the server action returns a failure rather than acting.
    cookieStore.clear();
    const { beginEnrollmentAction } = await import('@/app/(app)/account/actions');
    const result = await beginEnrollmentAction();
    expect(result.ok).toBe(false);
  });
});
