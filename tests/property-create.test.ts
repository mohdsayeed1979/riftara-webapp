import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { bootstrapTestDb } from './setup-db';
import type { Database } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';
import { isUuid } from '@/lib/utils';

/**
 * New Property module tests (BRD 3, 7, 9). Runs against an isolated, seeded
 * PGlite database — never production. Covers routing guard, creation,
 * validation, RBAC, org scoping, duplicate handling, audit and redirect.
 */

// Mock only getSession so we can exercise the server action's RBAC guard with
// controlled users; every other session export keeps its real implementation.
vi.mock('@/lib/auth/session', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth/session')>();
  return { ...mod, getSession: vi.fn() };
});

let db: Database;
let cleanup: () => void;
let admin: SessionUser;
let getSessionMock: ReturnType<typeof vi.fn>;

let typeId = '';
let cityId = '';
let regionId = '';
let districtId = '';

beforeAll(async () => {
  const ctx = await bootstrapTestDb();
  db = ctx.db;
  cleanup = ctx.cleanup;

  const { users, propertyTypes, cities, districts } = await import('@/db/schema');
  const { loadSessionUser, getSession } = await import('@/lib/auth/session');
  getSessionMock = getSession as unknown as ReturnType<typeof vi.fn>;

  const [u] = await db.select().from(users).where(eq(users.email, 'sayeed.almousa@riftara.sa')).limit(1);
  const loaded = await loadSessionUser(u.id);
  if (!loaded) throw new Error('admin actor not found');
  admin = loaded;

  const [type] = await db.select({ id: propertyTypes.id }).from(propertyTypes).where(eq(propertyTypes.organizationId, admin.organizationId)).limit(1);
  typeId = type.id;
  const [district] = await db
    .select({ id: districts.id, cityId: districts.cityId })
    .from(districts)
    .where(eq(districts.organizationId, admin.organizationId))
    .limit(1);
  districtId = district.id;
  cityId = district.cityId;
  const [city] = await db.select({ regionId: cities.regionId }).from(cities).where(eq(cities.id, cityId)).limit(1);
  regionId = city.regionId ?? '';
}, 180_000);

afterAll(() => cleanup?.());

function baseForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const values: Record<string, string> = {
    code: `PROP-TST-${Math.random().toString(36).slice(2, 8)}`,
    nameEn: 'Integration Test Tower',
    propertyTypeId: typeId,
    usage: 'commercial',
    status: 'active',
    cityId,
    ...overrides,
  };
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

describe('A. /properties/new route exists', () => {
  it('has a real page module at the expected path', () => {
    const p = join(process.cwd(), 'src', 'app', '(app)', 'properties', 'new', 'page.tsx');
    expect(existsSync(p)).toBe(true);
  });

  it('the page reference-data loader returns organization-scoped options', async () => {
    const { getPropertyFormReferenceData } = await import('@/services/property-service');
    const ref = await getPropertyFormReferenceData(admin.organizationId);
    expect(ref.types.length).toBeGreaterThan(0);
    expect(ref.cities.length).toBeGreaterThan(0);
    expect(ref.regions.length).toBeGreaterThan(0);
  });
});

describe('B. /properties/[id] rejects non-UUID ids', () => {
  it('isUuid guard is false for "new" and true for a real UUID', () => {
    expect(isUuid('new')).toBe(false);
    expect(isUuid('123')).toBe(false);
    expect(isUuid(admin.organizationId)).toBe(true);
  });
});

describe('C/G/J. Valid creation succeeds, is org-scoped, returns id', () => {
  it('creates a property (with ownership) scoped to the session organization', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createPropertyAction } = await import('@/app/(app)/properties/actions');
    const { properties, propertyOwnerships } = await import('@/db/schema');

    const form = baseForm({
      regionId,
      districtId,
      nameEn: 'Riftara Test Plaza',
      landArea: '1200.50',
      buildingCount: '2',
      cctv: 'on',
      ownerName: 'Test Holding Co',
      ownerType: 'entity',
      ownershipDocumentType: 'title_deed',
      ownershipDocumentNumber: 'TD-999-TEST',
      ownershipPercentage: '100',
    });
    const result = await createPropertyAction(null, form);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isUuid(result.data.id)).toBe(true);

    const [row] = await db.select().from(properties).where(eq(properties.id, result.data.id));
    expect(row.organizationId).toBe(admin.organizationId); // org from session, not client
    expect(row.cctv).toBe(true);
    expect(Number(row.landArea)).toBeCloseTo(1200.5);

    const owners = await db.select().from(propertyOwnerships).where(eq(propertyOwnerships.propertyId, result.data.id));
    expect(owners.length).toBe(1);
    expect(owners[0].ownerName).toBe('Test Holding Co');
  });

  it('a different organization cannot see the created property', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createPropertyAction } = await import('@/app/(app)/properties/actions');
    const { getPropertyDetail } = await import('@/services/property-service');
    const created = await createPropertyAction(null, baseForm({ nameEn: 'Scoped Property' }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const other = await getPropertyDetail('00000000-0000-4000-8000-000000000000', created.data.id);
    expect(other).toBeNull();
  });
});

describe('D. Missing required fields fail validation', () => {
  it('rejects a submission with no name', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createPropertyAction } = await import('@/app/(app)/properties/actions');
    const form = baseForm();
    form.delete('nameEn');
    const result = await createPropertyAction(null, form);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors?.nameEn?.[0]).toBeTruthy();
  });
});

describe('E. Invalid reference / enum values fail validation', () => {
  it('rejects an unknown property type id for this organization', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createPropertyAction } = await import('@/app/(app)/properties/actions');
    const result = await createPropertyAction(null, baseForm({ propertyTypeId: '11111111-1111-4111-8111-111111111111' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors?.propertyTypeId?.[0]).toBeTruthy();
  });

  it('rejects an invalid usage enum value', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createPropertyAction } = await import('@/app/(app)/properties/actions');
    const result = await createPropertyAction(null, baseForm({ usage: 'spaceship' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors?.usage?.[0]).toBeTruthy();
  });

  it('rejects a district that does not belong to the selected city', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createPropertyAction } = await import('@/app/(app)/properties/actions');
    const { districts } = await import('@/db/schema');
    // A district from a DIFFERENT city.
    const foreign = (
      await db.select({ id: districts.id, cityId: districts.cityId }).from(districts).where(eq(districts.organizationId, admin.organizationId)).limit(50)
    ).find((d) => d.cityId !== cityId);
    if (!foreign) return; // seed always has multiple cities, but guard anyway
    const result = await createPropertyAction(null, baseForm({ districtId: foreign.id }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors?.districtId?.[0]).toBeTruthy();
  });
});

describe('F. Unauthorized user cannot create a property', () => {
  it('returns FORBIDDEN when the user lacks properties:create', async () => {
    const viewer: SessionUser = {
      ...admin,
      permissions: admin.permissions.filter((p) => p !== 'properties:create'),
    };
    getSessionMock.mockResolvedValue(viewer);
    const { createPropertyAction } = await import('@/app/(app)/properties/actions');
    const result = await createPropertyAction(null, baseForm());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('FORBIDDEN');
  });
});

describe('H. Duplicate property code is handled', () => {
  it('returns a friendly conflict instead of a raw DB error', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createPropertyAction } = await import('@/app/(app)/properties/actions');
    const code = `PROP-DUP-${Math.random().toString(36).slice(2, 8)}`;
    const first = await createPropertyAction(null, baseForm({ code }));
    expect(first.ok).toBe(true);
    const second = await createPropertyAction(null, baseForm({ code }));
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe('CONFLICT');
    expect(second.error.message).not.toMatch(/duplicate key|constraint/i);
  });
});

describe('I. Successful creation writes an audit entry', () => {
  it('records a property create action in the audit log', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createPropertyAction } = await import('@/app/(app)/properties/actions');
    const { auditLogs } = await import('@/db/schema');
    const created = await createPropertyAction(null, baseForm({ nameEn: 'Audited Property' }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const rows = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, 'property'), eq(auditLogs.entityId, created.data.id)));
    expect(rows.length).toBe(1);
    expect(rows[0].action).toBe('create');
    expect(rows[0].organizationId).toBe(admin.organizationId);
  });
});

describe('Phase 4C. Property edit', () => {
  it('has an edit route protected by UUID and organization-scoped service updates', async () => {
    const page = join(process.cwd(), 'src', 'app', '(app)', 'properties', '[id]', 'edit', 'page.tsx');
    expect(existsSync(page)).toBe(true);
    const { createPropertyAction } = await import('@/app/(app)/properties/actions');
    const { updateProperty, getPropertyForEdit } = await import('@/services/property-service');
    const { auditLogs, properties } = await import('@/db/schema');
    getSessionMock.mockResolvedValue(admin);
    const created = await createPropertyAction(null, baseForm({ nameEn: 'Editable Property' }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const edited = await updateProperty(admin, created.data.id, {
      code: 'PROP-EDITED', nameEn: 'Edited Property', propertyTypeId: typeId, usage: 'commercial', status: 'active', cityId,
    });
    expect(edited.id).toBe(created.data.id);
    expect((await getPropertyForEdit(admin.organizationId, created.data.id))?.nameEn).toBe('Edited Property');
    expect(await getPropertyForEdit('00000000-0000-4000-8000-000000000000', created.data.id)).toBeNull();
    const rows = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, 'property'), eq(auditLogs.entityId, created.data.id)));
    expect(rows.some((row) => row.action === 'update')).toBe(true);
    const [row] = await db.select({ code: properties.code }).from(properties).where(eq(properties.id, created.data.id));
    expect(row.code).toBe('PROP-EDITED');
  });

  it('rejects an edit from a user without properties:edit (RBAC)', async () => {
    const { createPropertyAction } = await import('@/app/(app)/properties/actions');
    getSessionMock.mockResolvedValue(admin);
    const created = await createPropertyAction(null, baseForm({ nameEn: 'Guarded Property' }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    getSessionMock.mockResolvedValue({ ...admin, permissions: [] });
    const denied = await createPropertyAction(null, baseForm({ propertyId: created.data.id, nameEn: 'Should Not Save' }));
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.error.code).toBe('FORBIDDEN');
    getSessionMock.mockResolvedValue(admin);
    const { getPropertyForEdit } = await import('@/services/property-service');
    expect((await getPropertyForEdit(admin.organizationId, created.data.id))?.nameEn).toBe('Guarded Property');
  });

  it('does not update a property from another organization or a missing id', async () => {
    const { updateProperty } = await import('@/services/property-service');
    getSessionMock.mockResolvedValue(admin);
    const { createPropertyAction } = await import('@/app/(app)/properties/actions');
    const created = await createPropertyAction(null, baseForm({ nameEn: 'Isolated Property' }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const foreignActor = { ...admin, organizationId: '00000000-0000-4000-8000-000000000000' };
    const values = { code: 'PROP-X', nameEn: 'Hijacked', propertyTypeId: typeId, usage: 'commercial', status: 'active', cityId };
    await expect(updateProperty(foreignActor, created.data.id, values)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(updateProperty(admin, '00000000-0000-4000-8000-000000000000', values)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
