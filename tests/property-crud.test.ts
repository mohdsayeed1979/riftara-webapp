import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { bootstrapTestDb } from './setup-db';
import type { Database } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';
import type { CreatePropertyInput } from '@/services/property-service';
import type { AuditAction } from '@/lib/audit';

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth/session')>();
  return { ...mod, getSession: vi.fn() };
});
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

const FOREIGN_ORG = '00000000-0000-4000-8000-000000000000';

let db: Database;
let cleanup: () => void;
let admin: SessionUser;
let getSessionMock: ReturnType<typeof vi.fn>;
let typeId = '';
let cityId = '';

async function baseInput(overrides: Partial<CreatePropertyInput> = {}): Promise<CreatePropertyInput> {
  return {
    code: `T-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    nameEn: 'Test Property',
    propertyTypeId: typeId,
    usage: 'residential',
    status: 'active',
    cityId,
    ...overrides,
  };
}

async function auditRows(action: AuditAction, entityId: string) {
  const { auditLogs } = await import('@/db/schema');
  return db
    .select({ id: auditLogs.id, action: auditLogs.action })
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, 'property'), eq(auditLogs.entityId, entityId), eq(auditLogs.action, action)));
}

beforeAll(async () => {
  const c = await bootstrapTestDb();
  db = c.db;
  cleanup = c.cleanup;

  const { users } = await import('@/db/schema');
  const { loadSessionUser, getSession } = await import('@/lib/auth/session');
  getSessionMock = getSession as unknown as ReturnType<typeof vi.fn>;
  const [u] = await db.select().from(users).where(eq(users.email, 'sayeed.almousa@riftara.sa')).limit(1);
  admin = (await loadSessionUser(u.id))!;

  const { getPropertyFormReferenceData } = await import('@/services/property-service');
  const ref = await getPropertyFormReferenceData(admin.organizationId);
  typeId = ref.types[0].id;
  cityId = ref.cities[0].id;
}, 180_000);

afterAll(() => cleanup?.());

describe('Property create & read', () => {
  it('creates a property and reads it back, scoped to the organization', async () => {
    const { createProperty, getPropertyDetail } = await import('@/services/property-service');
    const { id } = await createProperty(admin, await baseInput({ nameEn: 'Readable Tower' }));
    const detail = await getPropertyDetail(admin.organizationId, id);
    expect(detail?.nameEn).toBe('Readable Tower');
    // Another organization cannot read it.
    expect(await getPropertyDetail(FOREIGN_ORG, id)).toBeNull();
    // Creation is audited.
    expect((await auditRows('create', id)).length).toBeGreaterThanOrEqual(1);
  });
});

describe('Property update', () => {
  it('updates editable fields and writes an audit entry', async () => {
    const { createProperty, updateProperty, getPropertyForEdit } = await import('@/services/property-service');
    const { id } = await createProperty(admin, await baseInput({ nameEn: 'Before' }));
    await updateProperty(admin, id, await baseInput({ nameEn: 'After' }));
    const edited = await getPropertyForEdit(admin.organizationId, id);
    expect(edited?.nameEn).toBe('After');
    expect((await auditRows('update', id)).length).toBeGreaterThanOrEqual(1);
  });

  it('rejects updating a property in another organization', async () => {
    const { createProperty, updateProperty } = await import('@/services/property-service');
    const { id } = await createProperty(admin, await baseInput());
    const foreign: SessionUser = { ...admin, organizationId: FOREIGN_ORG };
    await expect(updateProperty(foreign, id, await baseInput())).rejects.toThrow();
  });
});

describe('Dependency-aware delete & archive', () => {
  it('permanently deletes a property that has no dependencies', async () => {
    const { createProperty, deleteProperty, getPropertyDependencies, getPropertyDetail } = await import('@/services/property-service');
    const { id } = await createProperty(admin, await baseInput({ nameEn: 'Empty Plot' }));
    const deps = await getPropertyDependencies(admin.organizationId, id);
    expect(deps.canHardDelete).toBe(true);
    await deleteProperty(admin, id);
    expect(await getPropertyDetail(admin.organizationId, id)).toBeNull();
    expect((await auditRows('delete', id)).length).toBeGreaterThanOrEqual(1);
  });

  it('blocks hard deletion when the property has dependencies', async () => {
    const { properties } = await import('@/db/schema');
    const { getPropertyDependencies, deleteProperty } = await import('@/services/property-service');
    // A seeded property (has buildings/units/etc.).
    const [seeded] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(eq(properties.organizationId, admin.organizationId))
      .limit(1);
    const deps = await getPropertyDependencies(admin.organizationId, seeded.id);
    expect(deps.total).toBeGreaterThan(0);
    expect(deps.canHardDelete).toBe(false);
    await expect(deleteProperty(admin, seeded.id)).rejects.toThrow();
  });

  it('archives (soft-deletes) a property, hiding it from lists while preserving data', async () => {
    const { createProperty, archiveProperty, getPropertyDetail, listProperties } = await import('@/services/property-service');
    const { id } = await createProperty(admin, await baseInput({ nameEn: 'To Archive' }));
    await archiveProperty(admin, id);
    expect(await getPropertyDetail(admin.organizationId, id)).toBeNull();
    const { items } = await listProperties({ organizationId: admin.organizationId, page: 1, pageSize: 200 });
    expect(items.some((p) => p.id === id)).toBe(false);
    expect((await auditRows('soft_delete', id)).length).toBeGreaterThanOrEqual(1);
  });

  it('rejects dependency lookups for another organization', async () => {
    const { createProperty, getPropertyDependencies } = await import('@/services/property-service');
    const { id } = await createProperty(admin, await baseInput());
    await expect(getPropertyDependencies(FOREIGN_ORG, id)).rejects.toThrow();
  });
});

describe('RBAC on server actions', () => {
  it('blocks archive/delete without properties:delete', async () => {
    const { archivePropertyAction, deletePropertyAction } = await import('@/app/(app)/properties/actions');
    const { createProperty } = await import('@/services/property-service');
    const { id } = await createProperty(admin, await baseInput());

    getSessionMock.mockResolvedValue({ ...admin, permissions: ['properties:view'] });
    const a = await archivePropertyAction(id);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.error.code).toBe('FORBIDDEN');

    const d = await deletePropertyAction(id, 'anything');
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.code).toBe('FORBIDDEN');
  });

  it('archives via action when authorized, and enforces the typed-name confirmation on delete', async () => {
    const { archivePropertyAction, deletePropertyAction } = await import('@/app/(app)/properties/actions');
    const { createProperty } = await import('@/services/property-service');
    getSessionMock.mockResolvedValue(admin);

    const safe = await createProperty(admin, await baseInput({ nameEn: 'Confirm Me' }));
    // Wrong name is rejected before any deletion happens.
    const wrong = await deletePropertyAction(safe.id, 'Not The Name');
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.code).toBe('VALIDATION');
    // Correct name deletes it.
    const right = await deletePropertyAction(safe.id, 'Confirm Me');
    expect(right.ok).toBe(true);

    const toArchive = await createProperty(admin, await baseInput());
    const archived = await archivePropertyAction(toArchive.id);
    expect(archived.ok).toBe(true);
  });

  it('blocks create/edit action without the matching permission', async () => {
    const { createPropertyAction } = await import('@/app/(app)/properties/actions');
    getSessionMock.mockResolvedValue({ ...admin, permissions: ['properties:view'] });
    const fd = new FormData();
    fd.set('code', 'X-1');
    fd.set('nameEn', 'Blocked');
    fd.set('propertyTypeId', typeId);
    fd.set('usage', 'residential');
    fd.set('status', 'active');
    fd.set('cityId', cityId);
    const result = await createPropertyAction(null, fd);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');
  });

  it('returns validation errors for an incomplete create form', async () => {
    const { createPropertyAction } = await import('@/app/(app)/properties/actions');
    getSessionMock.mockResolvedValue(admin);
    const fd = new FormData();
    fd.set('nameEn', ''); // missing code, type, city, etc.
    const result = await createPropertyAction(null, fd);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION');
  });
});

describe('Bilingual UI strings', () => {
  it('provides property action labels in English and Arabic', async () => {
    const { en, ar } = await import('@/i18n');
    expect(en.properties.archiveProperty).toBeTruthy();
    expect(en.properties.deleteProperty).toBeTruthy();
    expect(ar.properties.archiveProperty).toBeTruthy();
    expect(ar.properties.deleteProperty).toBeTruthy();
    expect(ar.properties.archiveProperty).not.toBe(en.properties.archiveProperty);
  });
});
