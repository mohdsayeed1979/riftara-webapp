import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { bootstrapTestDb } from './setup-db';
import type { Database } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth/session')>();
  return { ...mod, getSession: vi.fn() };
});

const FOREIGN_ORG = '00000000-0000-4000-8000-000000000000';

let db: Database;
let cleanup: () => void;
let admin: SessionUser;
let getSessionMock: ReturnType<typeof vi.fn>;
let superAdminRoleId = '';
let systemRoleId = '';

// users:manage but NO super_admin; holds only properties:view among feature perms.
function limitedActor(): SessionUser {
  return {
    id: admin.id, organizationId: admin.organizationId, email: 'limited@riftara.sa', fullName: 'Limited',
    jobTitle: null, avatarUrl: null, locale: 'en', roleKeys: [], roleNames: [],
    permissions: ['users:manage', 'properties:view'], scopedPropertyIds: [], scopedCityIds: [],
  } as SessionUser;
}

let n = 0;
const key = () => `custom_${Date.now()}_${(n += 1)}`;

beforeAll(async () => {
  const ctx = await bootstrapTestDb();
  db = ctx.db; cleanup = ctx.cleanup;
  const { users, roles } = await import('@/db/schema');
  const { loadSessionUser, getSession } = await import('@/lib/auth/session');
  getSessionMock = getSession as unknown as ReturnType<typeof vi.fn>;
  const [u] = await db.select().from(users).where(eq(users.email, 'sayeed.almousa@riftara.sa')).limit(1);
  admin = (await loadSessionUser(u.id))!;
  const roleRows = await db.select({ id: roles.id, key: roles.key }).from(roles).where(eq(roles.organizationId, admin.organizationId));
  superAdminRoleId = roleRows.find((r) => r.key === 'super_admin')!.id;
  systemRoleId = roleRows.find((r) => r.key === 'auditor')!.id;
}, 180_000);

afterAll(() => cleanup?.());

describe('Custom role CRUD', () => {
  it('creates a custom role (isSystem=false) with audit', async () => {
    const { createRole } = await import('@/services/role-admin-service');
    const { roles, auditLogs } = await import('@/db/schema');
    const created = await createRole(admin, { key: key(), nameEn: 'Regional Supervisor', description: 'test' });
    const [row] = await db.select({ isSystem: roles.isSystem, org: roles.organizationId }).from(roles).where(eq(roles.id, created.id));
    expect(row.isSystem).toBe(false);
    expect(row.org).toBe(admin.organizationId);
    const audit = await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.entityId, created.id));
    expect(audit.some((a) => a.action === 'create')).toBe(true);
  });

  it('rejects a duplicate role key', async () => {
    const { createRole } = await import('@/services/role-admin-service');
    const k = key();
    await createRole(admin, { key: k, nameEn: 'One' });
    await expect(createRole(admin, { key: k, nameEn: 'Two' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects invalid input', async () => {
    const { createRole } = await import('@/services/role-admin-service');
    await expect(createRole(admin, { key: 'x', nameEn: 'Short Key' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(createRole(admin, { key: key(), nameEn: '' })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('updates a custom role', async () => {
    const { createRole, updateRole, getRoleDetail } = await import('@/services/role-admin-service');
    const created = await createRole(admin, { key: key(), nameEn: 'Before' });
    await updateRole(admin, created.id, { nameEn: 'After' });
    expect((await getRoleDetail(admin.organizationId, created.id))!.role.nameEn).toBe('After');
  });

  it('deletes an unassigned custom role but blocks an assigned one', async () => {
    const { createRole, deleteRole } = await import('@/services/role-admin-service');
    const { createUser, setUserRoles } = await import('@/services/user-admin-service');
    const solo = await createRole(admin, { key: key(), nameEn: 'Deletable' });
    await expect(deleteRole(admin, solo.id)).resolves.toMatchObject({ id: solo.id });

    const assigned = await createRole(admin, { key: key(), nameEn: 'Assigned', permissionKeys: ['properties:view'] });
    const user = await createUser(admin, { fullName: 'Holder', email: `holder_${Date.now()}@ex.com`, password: 'Riftara#Temp2025' });
    await setUserRoles(admin, user.id, [assigned.id]);
    await expect(deleteRole(admin, assigned.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('blocks cross-organization role access', async () => {
    const { createRole, updateRole, getRoleDetail } = await import('@/services/role-admin-service');
    const created = await createRole(admin, { key: key(), nameEn: 'Iso' });
    expect(await getRoleDetail(FOREIGN_ORG, created.id)).toBeNull();
    await expect(updateRole({ ...admin, organizationId: FOREIGN_ORG }, created.id, { nameEn: 'X' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('denies role creation without users:manage (RBAC)', async () => {
    const { createRoleAction } = await import('@/app/(app)/roles/actions');
    getSessionMock.mockResolvedValue({ ...admin, permissions: [] });
    const fd = new FormData(); fd.set('key', key()); fd.set('nameEn', 'Nope');
    const denied = await createRoleAction(null, fd);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN');
  });
});

describe('System role protection', () => {
  it('blocks editing, permission modification and deletion of system roles', async () => {
    const { updateRole, setRolePermissions, deleteRole } = await import('@/services/role-admin-service');
    await expect(updateRole(admin, systemRoleId, { nameEn: 'Hacked' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(setRolePermissions(admin, systemRoleId, ['properties:view'])).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(deleteRole(admin, systemRoleId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('protects the super_admin role from all modification', async () => {
    const { updateRole, setRolePermissions, deleteRole } = await import('@/services/role-admin-service');
    await expect(updateRole(admin, superAdminRoleId, { nameEn: 'x' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(setRolePermissions(admin, superAdminRoleId, [])).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(deleteRole(admin, superAdminRoleId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('Permission assignment & escalation', () => {
  it('assigns and atomically replaces permissions (Super Admin)', async () => {
    const { createRole, setRolePermissions, getRoleDetail } = await import('@/services/role-admin-service');
    const role = await createRole(admin, { key: key(), nameEn: 'Perms' });
    await setRolePermissions(admin, role.id, ['properties:view', 'units:view', 'settings:manage']);
    expect((await getRoleDetail(admin.organizationId, role.id))!.permissionKeys.sort()).toEqual(['properties:view', 'settings:manage', 'units:view']);
    await setRolePermissions(admin, role.id, ['contracts:view']);
    expect((await getRoleDetail(admin.organizationId, role.id))!.permissionKeys).toEqual(['contracts:view']);
  });

  it('blocks a non-Super-Admin from granting permissions they lack', async () => {
    const { createRole, setRolePermissions } = await import('@/services/role-admin-service');
    // limited holds properties:view — granting it is allowed…
    const ok = await createRole(limitedActor(), { key: key(), nameEn: 'Within', permissionKeys: ['properties:view'] });
    expect(ok.id).toBeTruthy();
    // …but users:delete is beyond the actor's rights.
    await expect(createRole(limitedActor(), { key: key(), nameEn: 'Beyond', permissionKeys: ['users:delete'] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(setRolePermissions(limitedActor(), ok.id, ['users:delete'])).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects an unknown permission key', async () => {
    const { createRole } = await import('@/services/role-admin-service');
    await expect(createRole(admin, { key: key(), nameEn: 'Bad', permissionKeys: ['nope:view'] })).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
