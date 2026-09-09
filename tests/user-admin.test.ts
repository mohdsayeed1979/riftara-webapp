import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { bootstrapTestDb } from './setup-db';
import type { Database } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth/session')>();
  return { ...mod, getSession: vi.fn() };
});

const FOREIGN_ORG = '00000000-0000-4000-8000-000000000000';
const STRONG_PW = 'Riftara#Temp2025';

let db: Database;
let cleanup: () => void;
let admin: SessionUser; // seeded super admin
let getSessionMock: ReturnType<typeof vi.fn>;
let superAdminRoleId = '';
let readOnlyRoleId = '';
let auditorRoleId = '';

// A limited administrator with users:manage but NO super_admin and minimal perms.
function limitedActor(): SessionUser {
  return {
    id: admin.id, organizationId: admin.organizationId, email: 'limited@riftara.sa', fullName: 'Limited Admin',
    jobTitle: null, avatarUrl: null, locale: 'en', roleKeys: [], roleNames: [],
    permissions: ['users:manage', 'users:create', 'users:edit'], scopedPropertyIds: [], scopedCityIds: [],
  } as SessionUser;
}

beforeAll(async () => {
  const ctx = await bootstrapTestDb();
  db = ctx.db;
  cleanup = ctx.cleanup;

  const { users, roles } = await import('@/db/schema');
  const { loadSessionUser, getSession } = await import('@/lib/auth/session');
  getSessionMock = getSession as unknown as ReturnType<typeof vi.fn>;

  const [u] = await db.select().from(users).where(eq(users.email, 'sayeed.almousa@riftara.sa')).limit(1);
  const loaded = await loadSessionUser(u.id);
  if (!loaded) throw new Error('admin actor not found');
  admin = loaded;

  const roleRows = await db.select({ id: roles.id, key: roles.key }).from(roles).where(eq(roles.organizationId, admin.organizationId));
  superAdminRoleId = roleRows.find((r) => r.key === 'super_admin')!.id;
  readOnlyRoleId = roleRows.find((r) => r.key === 'read_only')!.id;
  auditorRoleId = roleRows.find((r) => r.key === 'auditor')!.id;
}, 180_000);

afterAll(() => cleanup?.());

let counter = 0;
function uniqueEmail() { counter += 1; return `admintest_${Date.now()}_${counter}@example.com`; }

/* -------------------------------------------------------------------------- */
describe('User creation & edit', () => {
  it('creates a user, forces password change, and audits', async () => {
    const { createUser } = await import('@/services/user-admin-service');
    const { users, auditLogs } = await import('@/db/schema');
    const email = uniqueEmail();
    const created = await createUser(admin, { fullName: 'New Staff', email, password: STRONG_PW });
    const [row] = await db.select({ mustChange: users.mustChangePassword, org: users.organizationId, isActive: users.isActive }).from(users).where(eq(users.id, created.id));
    expect(row.mustChange).toBe(true);
    expect(row.org).toBe(admin.organizationId);
    expect(row.isActive).toBe(true);
    const audit = await db.select({ action: auditLogs.action }).from(auditLogs).where(and(eq(auditLogs.entityType, 'user'), eq(auditLogs.entityId, created.id)));
    expect(audit.some((a) => a.action === 'create')).toBe(true);
  });

  it('rejects a duplicate email', async () => {
    const { createUser } = await import('@/services/user-admin-service');
    const email = uniqueEmail();
    await createUser(admin, { fullName: 'First', email, password: STRONG_PW });
    await expect(createUser(admin, { fullName: 'Second', email, password: STRONG_PW })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects invalid input (weak password, bad email)', async () => {
    const { createUser } = await import('@/services/user-admin-service');
    await expect(createUser(admin, { fullName: 'Weak', email: uniqueEmail(), password: 'weak' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(createUser(admin, { fullName: 'Bad', email: 'not-an-email', password: STRONG_PW })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('updates profile fields', async () => {
    const { createUser, updateUser } = await import('@/services/user-admin-service');
    const { users } = await import('@/db/schema');
    const created = await createUser(admin, { fullName: 'Before', email: uniqueEmail(), password: STRONG_PW });
    await updateUser(admin, created.id, { fullName: 'After Name', email: uniqueEmail(), jobTitle: 'Analyst' });
    const [row] = await db.select({ fullName: users.fullName, jobTitle: users.jobTitle }).from(users).where(eq(users.id, created.id));
    expect(row.fullName).toBe('After Name');
    expect(row.jobTitle).toBe('Analyst');
  });

  it('denies creation without users:create (RBAC)', async () => {
    const { createUserAction } = await import('@/app/(app)/users/actions');
    getSessionMock.mockResolvedValue({ ...admin, permissions: [] });
    const fd = new FormData();
    fd.set('fullName', 'Nope'); fd.set('email', uniqueEmail()); fd.set('password', STRONG_PW);
    const denied = await createUserAction(null, fd);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN');
  });
});

/* -------------------------------------------------------------------------- */
describe('Activation & deactivation', () => {
  it('activates and deactivates a user', async () => {
    const { createUser, setUserActive } = await import('@/services/user-admin-service');
    const { users } = await import('@/db/schema');
    const created = await createUser(admin, { fullName: 'Toggle', email: uniqueEmail(), password: STRONG_PW, isActive: false });
    await setUserActive(admin, created.id, true);
    let [row] = await db.select({ isActive: users.isActive }).from(users).where(eq(users.id, created.id));
    expect(row.isActive).toBe(true);
    await setUserActive(admin, created.id, false);
    [row] = await db.select({ isActive: users.isActive }).from(users).where(eq(users.id, created.id));
    expect(row.isActive).toBe(false);
  });

  it('blocks self-deactivation', async () => {
    const { setUserActive } = await import('@/services/user-admin-service');
    await expect(setUserActive(admin, admin.id, false)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('blocks removing the Super Admin role from the last active Super Admin', async () => {
    const { setUserRoles } = await import('@/services/user-admin-service');
    // The seeded admin is the only Super Admin; removing it must be blocked.
    await expect(setUserRoles(admin, admin.id, [readOnlyRoleId])).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('deactivation revokes the user\'s sessions and blocks re-authentication', async () => {
    const { createUser, setUserActive } = await import('@/services/user-admin-service');
    const { loadSessionUser } = await import('@/lib/auth/session');
    const { sessions } = await import('@/db/schema');
    const created = await createUser(admin, { fullName: 'Session User', email: uniqueEmail(), password: STRONG_PW });
    await db.insert(sessions).values({ userId: created.id, tokenHash: `test-${created.id}`, expiresAt: new Date(Date.now() + 3_600_000) });
    await setUserActive(admin, created.id, false);
    const live = await db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.userId, created.id), isNull(sessions.revokedAt)));
    expect(live.length).toBe(0);
    expect(await loadSessionUser(created.id)).toBeNull(); // inactive → cannot load
  });
});

/* -------------------------------------------------------------------------- */
describe('Role assignment & escalation', () => {
  it('assigns, replaces and removes roles (multi-role, atomic)', async () => {
    const { createUser, setUserRoles, getUserRoleIds } = await import('@/services/user-admin-service');
    const created = await createUser(admin, { fullName: 'Roled', email: uniqueEmail(), password: STRONG_PW });
    await setUserRoles(admin, created.id, [readOnlyRoleId, auditorRoleId]);
    expect((await getUserRoleIds(admin.organizationId, created.id)).sort()).toEqual([readOnlyRoleId, auditorRoleId].sort());
    await setUserRoles(admin, created.id, [auditorRoleId]);
    expect(await getUserRoleIds(admin.organizationId, created.id)).toEqual([auditorRoleId]);
    await setUserRoles(admin, created.id, []);
    expect(await getUserRoleIds(admin.organizationId, created.id)).toEqual([]);
  });

  it('prevents a non-Super-Admin from granting the Super Admin role', async () => {
    const { createUser, setUserRoles } = await import('@/services/user-admin-service');
    const created = await createUser(admin, { fullName: 'Victim', email: uniqueEmail(), password: STRONG_PW });
    await expect(setUserRoles(limitedActor(), created.id, [superAdminRoleId])).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('prevents privilege escalation beyond the actor\'s own permissions', async () => {
    const { createUser, setUserRoles } = await import('@/services/user-admin-service');
    const created = await createUser(admin, { fullName: 'Escalate', email: uniqueEmail(), password: STRONG_PW });
    // limitedActor holds only users:* — read_only grants dashboard:view etc. it lacks.
    await expect(setUserRoles(limitedActor(), created.id, [readOnlyRoleId])).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

/* -------------------------------------------------------------------------- */
describe('Admin password reset', () => {
  it('resets the password, forces a change and revokes sessions', async () => {
    const { createUser, adminResetPassword } = await import('@/services/user-admin-service');
    const { users, sessions, auditLogs } = await import('@/db/schema');
    const created = await createUser(admin, { fullName: 'Reset Target', email: uniqueEmail(), password: STRONG_PW });
    await db.update(users).set({ mustChangePassword: false }).where(eq(users.id, created.id));
    await db.insert(sessions).values({ userId: created.id, tokenHash: `test-reset-${created.id}`, expiresAt: new Date(Date.now() + 3_600_000) });

    await adminResetPassword(admin, created.id, 'Another#Strong2025');
    const [row] = await db.select({ mustChange: users.mustChangePassword }).from(users).where(eq(users.id, created.id));
    expect(row.mustChange).toBe(true);
    const live = await db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.userId, created.id), isNull(sessions.revokedAt)));
    expect(live.length).toBe(0);
    const audit = await db.select({ action: auditLogs.action, newValue: auditLogs.newValue }).from(auditLogs).where(and(eq(auditLogs.entityType, 'user'), eq(auditLogs.entityId, created.id)));
    expect(audit.some((a) => a.action === 'update')).toBe(true);
    // The password itself must never appear in the audit trail.
    expect(JSON.stringify(audit)).not.toContain('Another#Strong2025');
  });

  it('rejects a weak reset password', async () => {
    const { createUser, adminResetPassword } = await import('@/services/user-admin-service');
    const created = await createUser(admin, { fullName: 'Weak Reset', email: uniqueEmail(), password: STRONG_PW });
    await expect(adminResetPassword(admin, created.id, 'weak')).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

/* -------------------------------------------------------------------------- */
describe('Organization isolation', () => {
  it('does not expose or mutate a user from another organization', async () => {
    const { createUser, updateUser, getUserDetail } = await import('@/services/user-admin-service');
    const created = await createUser(admin, { fullName: 'Isolated', email: uniqueEmail(), password: STRONG_PW });
    expect(await getUserDetail(FOREIGN_ORG, created.id)).toBeNull();
    await expect(updateUser({ ...admin, organizationId: FOREIGN_ORG }, created.id, { fullName: 'Hijack', email: uniqueEmail() })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
