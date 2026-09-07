import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { bootstrapTestDb } from './setup-db';
import type { Database } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Phase 1 — Building / Floor / Unit management tests. Isolated seeded PGlite
 * database (never production). Covers create/update, organization scoping,
 * hierarchy integrity, RBAC, duplicate handling, audit and list scoping.
 */

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth/session')>();
  return { ...mod, getSession: vi.fn() };
});

let db: Database;
let cleanup: () => void;
let admin: SessionUser;
let getSessionMock: ReturnType<typeof vi.fn>;

let propertyA = '';
let propertyB = '';
let typeId = '';
let statusId = '';

beforeAll(async () => {
  const ctx = await bootstrapTestDb();
  db = ctx.db;
  cleanup = ctx.cleanup;

  const { users, properties } = await import('@/db/schema');
  const { loadSessionUser, getSession } = await import('@/lib/auth/session');
  getSessionMock = getSession as unknown as ReturnType<typeof vi.fn>;

  const [u] = await db.select().from(users).where(eq(users.email, 'sayeed.almousa@riftara.sa')).limit(1);
  const loaded = await loadSessionUser(u.id);
  if (!loaded) throw new Error('admin actor not found');
  admin = loaded;

  const props = await db
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.organizationId, admin.organizationId))
    .limit(2);
  propertyA = props[0].id;
  propertyB = props[1].id;

  const { getUnitFormReferenceData } = await import('@/services/unit-service');
  const ref = await getUnitFormReferenceData(admin.organizationId);
  typeId = ref.types[0].id;
  statusId = ref.statuses[0].id;
}, 180_000);

afterAll(() => cleanup?.());

function unitForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    propertyId: propertyA,
    code: `U-TST-${Math.random().toString(36).slice(2, 8)}`,
    unitNumber: `T-${Math.floor(Math.random() * 100000)}`,
    unitTypeId: typeId,
    usageType: 'commercial',
    statusId,
    ...overrides,
  };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  return fd;
}

describe('A/B/C. Building create + org scoping + invalid property', () => {
  it('A/B: creates a building scoped to the session organization', async () => {
    const { createBuilding } = await import('@/services/building-service');
    const { buildings } = await import('@/db/schema');
    const created = await createBuilding(admin, { propertyId: propertyA, code: `BLD-A-${Date.now()}`, nameEn: 'Tower A' });
    const [row] = await db.select().from(buildings).where(eq(buildings.id, created.id));
    expect(row.organizationId).toBe(admin.organizationId);
    expect(row.propertyId).toBe(propertyA);
  });

  it('C: rejects a building for a non-existent property', async () => {
    const { createBuilding } = await import('@/services/building-service');
    await expect(
      createBuilding(admin, { propertyId: '11111111-1111-4111-8111-111111111111', code: 'BLD-X', nameEn: 'Ghost' }),
    ).rejects.toThrow();
  });
});

describe('D/E. Floor create + invalid building', () => {
  it('D: creates a floor under a building', async () => {
    const { createBuilding, createFloor } = await import('@/services/building-service');
    const { floors } = await import('@/db/schema');
    const building = await createBuilding(admin, { propertyId: propertyA, code: `BLD-F-${Date.now()}`, nameEn: 'Floor Host' });
    const floor = await createFloor(admin, { buildingId: building.id, level: 1, nameEn: 'First Floor' });
    const [row] = await db.select().from(floors).where(eq(floors.id, floor.id));
    expect(row.buildingId).toBe(building.id);
    expect(row.level).toBe(1);
  });

  it('E: rejects a floor for a non-existent building', async () => {
    const { createFloor } = await import('@/services/building-service');
    await expect(
      createFloor(admin, { buildingId: '22222222-2222-4222-8222-222222222222', level: 1, nameEn: 'Ghost' }),
    ).rejects.toThrow();
  });
});

describe('F/G/L. Unit create + org scoping + audit', () => {
  it('creates a unit, scoped to the org, with an audit entry', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createUnitAction } = await import('@/app/(app)/units/actions');
    const { units, auditLogs } = await import('@/db/schema');

    const result = await createUnitAction(null, unitForm({ unitNumber: 'AUDITED-1', askingRent: '90000', leasableArea: '120' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [row] = await db.select().from(units).where(eq(units.id, result.data.id));
    expect(row.organizationId).toBe(admin.organizationId);
    expect(row.propertyId).toBe(propertyA);

    // G: another org cannot read it.
    const { getUnitDetail } = await import('@/services/unit-service');
    expect(await getUnitDetail('00000000-0000-4000-8000-000000000000', result.data.id)).toBeNull();

    // L: audit entry recorded.
    const audits = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, 'unit'), eq(auditLogs.entityId, result.data.id)));
    expect(audits.length).toBe(1);
    expect(audits[0].action).toBe('create');

    // Pricing was persisted through the pricing service (price history exists).
    const { getUnitPriceHistory } = await import('@/services/unit-service');
    const history = await getUnitPriceHistory(result.data.id);
    expect(history.length).toBeGreaterThan(0);
  });
});

describe('H. Unit hierarchy mismatch rejected', () => {
  it('rejects a building that belongs to a different property', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createBuilding } = await import('@/services/building-service');
    const { createUnitAction } = await import('@/app/(app)/units/actions');
    const building = await createBuilding(admin, { propertyId: propertyA, code: `BLD-H-${Date.now()}`, nameEn: 'Mismatch Host' });
    // Select propertyB but a building under propertyA.
    const result = await createUnitAction(null, unitForm({ propertyId: propertyB, buildingId: building.id }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors?.buildingId?.[0]).toBeTruthy();
  });
});

describe('I. Invalid UUID rejected', () => {
  it('update rejects a non-UUID unit id', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { updateUnitAction } = await import('@/app/(app)/units/actions');
    const result = await updateUnitAction('not-a-uuid', null, unitForm());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('create rejects a non-UUID property id via schema', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createUnitAction } = await import('@/app/(app)/units/actions');
    const result = await createUnitAction(null, unitForm({ propertyId: 'not-a-uuid' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors?.propertyId?.[0]).toBeTruthy();
  });
});

describe('J. Duplicate unit code handled', () => {
  it('returns a friendly conflict, not a raw DB error', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createUnitAction } = await import('@/app/(app)/units/actions');
    const code = `U-DUP-${Math.random().toString(36).slice(2, 8)}`;
    const first = await createUnitAction(null, unitForm({ code }));
    expect(first.ok).toBe(true);
    const second = await createUnitAction(null, unitForm({ code }));
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe('CONFLICT');
    expect(second.error.message).not.toMatch(/duplicate key|constraint/i);
  });
});

describe('K. RBAC — create denied for users without units:create', () => {
  it('returns FORBIDDEN', async () => {
    const viewer: SessionUser = { ...admin, permissions: admin.permissions.filter((p) => p !== 'units:create') };
    getSessionMock.mockResolvedValue(viewer);
    const { createUnitAction } = await import('@/app/(app)/units/actions');
    const result = await createUnitAction(null, unitForm());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('FORBIDDEN');
  });
});

describe('M. Unit update works', () => {
  it('updates the unit number', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createUnitAction, updateUnitAction } = await import('@/app/(app)/units/actions');
    const { units } = await import('@/db/schema');
    const created = await createUnitAction(null, unitForm({ unitNumber: 'BEFORE' }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const updated = await updateUnitAction(created.data.id, null, unitForm({ unitNumber: 'AFTER', code: `U-UPD-${Math.random().toString(36).slice(2, 8)}` }));
    expect(updated.ok).toBe(true);
    const [row] = await db.select().from(units).where(eq(units.id, created.data.id));
    expect(row.unitNumber).toBe('AFTER');
  });
});

describe('N. Unit list is organization-scoped', () => {
  it('returns only units for the session organization', async () => {
    const { listUnits } = await import('@/services/unit-service');
    const mine = await listUnits({ organizationId: admin.organizationId, allowedPropertyIds: null, page: 1, pageSize: 5 });
    expect(mine.total).toBeGreaterThan(0);
    const other = await listUnits({ organizationId: '00000000-0000-4000-8000-000000000000', allowedPropertyIds: null, page: 1, pageSize: 5 });
    expect(other.total).toBe(0);
  });
});

describe('O. Property -> Building -> Floor -> Unit hierarchy', () => {
  it('creates a unit placed on a floor of a building of the property', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createBuilding, createFloor } = await import('@/services/building-service');
    const { createUnitAction } = await import('@/app/(app)/units/actions');
    const { units } = await import('@/db/schema');

    const building = await createBuilding(admin, { propertyId: propertyA, code: `BLD-O-${Date.now()}`, nameEn: 'Hierarchy Tower' });
    const floor = await createFloor(admin, { buildingId: building.id, level: 2, nameEn: 'Second Floor' });
    const result = await createUnitAction(null, unitForm({ buildingId: building.id, floorId: floor.id }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [row] = await db.select().from(units).where(eq(units.id, result.data.id));
    expect(row.propertyId).toBe(propertyA);
    expect(row.buildingId).toBe(building.id);
    expect(row.floorId).toBe(floor.id);
  });
});
