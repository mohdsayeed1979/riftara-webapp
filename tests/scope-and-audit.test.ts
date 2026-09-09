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

let db: Database;
let cleanup: () => void;
let admin: SessionUser;
let propertyIds: string[] = [];
let cityIds: string[] = [];

let n = 0;
const email = () => `scopetest_${Date.now()}_${(n += 1)}@example.com`;

async function newUser() {
  const { createUser } = await import('@/services/user-admin-service');
  return createUser(admin, { fullName: 'Scope User', email: email(), password: 'Riftara#Temp2025' });
}

beforeAll(async () => {
  const ctx = await bootstrapTestDb();
  db = ctx.db; cleanup = ctx.cleanup;
  const { users, properties, cities } = await import('@/db/schema');
  const { loadSessionUser } = await import('@/lib/auth/session');
  const [u] = await db.select().from(users).where(eq(users.email, 'sayeed.almousa@riftara.sa')).limit(1);
  admin = (await loadSessionUser(u.id))!;
  propertyIds = (await db.select({ id: properties.id }).from(properties).where(and(eq(properties.organizationId, admin.organizationId), isNull(properties.deletedAt))).limit(3)).map((r) => r.id);
  cityIds = (await db.select({ id: cities.id }).from(cities).where(eq(cities.organizationId, admin.organizationId)).limit(2)).map((r) => r.id);
}, 180_000);

afterAll(() => cleanup?.());

describe('Data scope assignment', () => {
  it('assigns property, city and multiple scopes; round-trips via scopeFromSession', async () => {
    const { setUserScopes, getUserScopeIds } = await import('@/services/user-admin-service');
    const { loadSessionUser } = await import('@/lib/auth/session');
    const { scopeFromSession } = await import('@/services/metrics-service');
    const user = await newUser();
    await setUserScopes(admin, user.id, { propertyIds: [propertyIds[0], propertyIds[1]], cityIds: [cityIds[0]] });
    const scopes = await getUserScopeIds(admin.organizationId, user.id);
    expect(scopes.propertyIds.sort()).toEqual([propertyIds[0], propertyIds[1]].sort());
    expect(scopes.cityIds).toEqual([cityIds[0]]);
    // scopeFromSession consumes user_scopes correctly.
    const loaded = await loadSessionUser(user.id);
    const scope = scopeFromSession(loaded!);
    expect(scope.allowedPropertyIds?.sort()).toEqual([propertyIds[0], propertyIds[1]].sort());
  });

  it('atomically replaces scopes', async () => {
    const { setUserScopes, getUserScopeIds } = await import('@/services/user-admin-service');
    const user = await newUser();
    await setUserScopes(admin, user.id, { propertyIds: [propertyIds[0], propertyIds[1]], cityIds: [] });
    await setUserScopes(admin, user.id, { propertyIds: [propertyIds[2]], cityIds: [] });
    expect((await getUserScopeIds(admin.organizationId, user.id)).propertyIds).toEqual([propertyIds[2]]);
  });

  it('rejects an invalid/cross-org scope and preserves existing scopes', async () => {
    const { setUserScopes, getUserScopeIds } = await import('@/services/user-admin-service');
    const user = await newUser();
    await setUserScopes(admin, user.id, { propertyIds: [propertyIds[0]], cityIds: [] });
    await expect(setUserScopes(admin, user.id, { propertyIds: [FOREIGN_ORG], cityIds: [] })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await getUserScopeIds(admin.organizationId, user.id)).propertyIds).toEqual([propertyIds[0]]); // unchanged
  });

  it('prevents a scoped actor from granting broader property or city scope', async () => {
    const { setUserScopes } = await import('@/services/user-admin-service');
    const user = await newUser();
    const propScopedActor = { ...admin, roleKeys: [], scopedPropertyIds: [propertyIds[0]], scopedCityIds: [] } as SessionUser;
    await expect(setUserScopes(propScopedActor, user.id, { propertyIds: [propertyIds[1]], cityIds: [] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const cityScopedActor = { ...admin, roleKeys: [], scopedPropertyIds: [], scopedCityIds: [cityIds[0]] } as SessionUser;
    await expect(setUserScopes(cityScopedActor, user.id, { propertyIds: [], cityIds: [cityIds[1]] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Within own scope is allowed.
    await expect(setUserScopes(propScopedActor, user.id, { propertyIds: [propertyIds[0]], cityIds: [] })).resolves.toMatchObject({ id: user.id });
  });
});

describe('Audit & security view', () => {
  it('records scope changes and filters by entity, action and actor', async () => {
    const { setUserScopes } = await import('@/services/user-admin-service');
    const { listAuditLogs } = await import('@/services/audit-service');
    const user = await newUser();
    await setUserScopes(admin, user.id, { propertyIds: [propertyIds[0]], cityIds: [] });

    const byEntity = await listAuditLogs({ organizationId: admin.organizationId, entityType: 'user', page: 1, pageSize: 50 });
    expect(byEntity.items.every((i) => i.entityType === 'user')).toBe(true);
    const byAction = await listAuditLogs({ organizationId: admin.organizationId, action: 'create', page: 1, pageSize: 50 });
    expect(byAction.items.every((i) => i.action === 'create')).toBe(true);
    const byActor = await listAuditLogs({ organizationId: admin.organizationId, userId: admin.id, page: 1, pageSize: 10 });
    expect(byActor.total).toBeGreaterThan(0);
  });

  it('filters audit by date and paginates', async () => {
    const { listAuditLogs } = await import('@/services/audit-service');
    const today = new Date().toISOString().slice(0, 10);
    const future = await listAuditLogs({ organizationId: admin.organizationId, dateFrom: '2999-01-01', page: 1, pageSize: 10 });
    expect(future.total).toBe(0);
    const p1 = await listAuditLogs({ organizationId: admin.organizationId, dateTo: today, page: 1, pageSize: 5 });
    expect(p1.items.length).toBeLessThanOrEqual(5);
    expect(p1.total).toBeGreaterThan(0);
  });

  it('scopes audit logs to the organization', async () => {
    const { listAuditLogs } = await import('@/services/audit-service');
    const foreign = await listAuditLogs({ organizationId: FOREIGN_ORG, page: 1, pageSize: 10 });
    expect(foreign.total).toBe(0);
  });

  it('lists login attempts for organization user emails only', async () => {
    const { listLoginAttempts } = await import('@/services/audit-service');
    const { loginAttempts, users } = await import('@/db/schema');
    const [someUser] = await db.select({ email: users.email }).from(users).where(eq(users.organizationId, admin.organizationId)).limit(1);
    await db.insert(loginAttempts).values({ email: someUser.email, successful: false, reason: 'invalid_password' });
    await db.insert(loginAttempts).values({ email: 'stranger@nowhere.test', successful: false, reason: 'unknown_user' });
    const result = await listLoginAttempts(admin.organizationId, { page: 1, pageSize: 50 });
    expect(result.items.some((r) => r.email === someUser.email)).toBe(true);
    expect(result.items.some((r) => r.email === 'stranger@nowhere.test')).toBe(false); // outside org
  });
});
