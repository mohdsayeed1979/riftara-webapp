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
const BAD_UUID = 'not-a-uuid';

let db: Database;
let cleanup: () => void;
let admin: SessionUser;
let getSessionMock: ReturnType<typeof vi.fn>;

let propertyA = '';
let propertyB = '';
let buildingA = ''; // belongs to propertyA
let buildingB = ''; // belongs to propertyB
let vendorId = '';

async function auditFor(assetId: string) {
  const { auditLogs } = await import('@/db/schema');
  return db
    .select({ action: auditLogs.action, reason: auditLogs.reason, entityLabel: auditLogs.entityLabel })
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, 'asset'), eq(auditLogs.entityId, assetId)));
}

async function makeAsset(code?: string, nameEn = 'Test Asset') {
  const { createAsset } = await import('@/services/asset-service');
  return createAsset(admin, { code, nameEn, assetType: 'chiller', propertyId: propertyA });
}

beforeAll(async () => {
  const ctx = await bootstrapTestDb();
  db = ctx.db;
  cleanup = ctx.cleanup;

  const { users, buildings, vendors } = await import('@/db/schema');
  const { loadSessionUser, getSession } = await import('@/lib/auth/session');
  getSessionMock = getSession as unknown as ReturnType<typeof vi.fn>;

  const [u] = await db.select().from(users).where(eq(users.email, 'sayeed.almousa@riftara.sa')).limit(1);
  admin = (await loadSessionUser(u.id))!;

  // Two buildings in two distinct properties (for assign / transfer tests).
  const rows = await db
    .select({ id: buildings.id, propertyId: buildings.propertyId })
    .from(buildings)
    .where(and(eq(buildings.organizationId, admin.organizationId), isNull(buildings.deletedAt)));
  const first = rows[0];
  const other = rows.find((r) => r.propertyId !== first.propertyId)!;
  buildingA = first.id;
  propertyA = first.propertyId;
  buildingB = other.id;
  propertyB = other.propertyId;

  const [v] = await db.select({ id: vendors.id }).from(vendors).where(eq(vendors.organizationId, admin.organizationId)).limit(1);
  vendorId = v.id;
}, 180_000);

afterAll(() => cleanup?.());

/* ------------------------------- CRUD ---------------------------------- */

describe('Asset CRUD', () => {
  it('creates an asset with an auto-generated code, reads it back, and lists it', async () => {
    const { getAsset, listAssets } = await import('@/services/asset-service');
    const created = await makeAsset(undefined, 'Rooftop Chiller');
    expect(created.code).toMatch(/^AST-\d{5}$/);

    const asset = await getAsset({ organizationId: admin.organizationId }, created.id);
    expect(asset.nameEn).toBe('Rooftop Chiller');
    expect(asset.status).toBe('operational');

    const list = await listAssets({ organizationId: admin.organizationId, search: 'Rooftop Chiller', page: 1, pageSize: 20 });
    expect(list.items.some((a) => a.id === created.id)).toBe(true);

    expect((await auditFor(created.id)).some((a) => a.action === 'create')).toBe(true);
  });

  it('rejects a duplicate asset code', async () => {
    const { createAsset } = await import('@/services/asset-service');
    await createAsset(admin, { code: 'AST-DUP-1', nameEn: 'A', assetType: 'pump', propertyId: propertyA });
    await expect(createAsset(admin, { code: 'AST-DUP-1', nameEn: 'B', assetType: 'pump', propertyId: propertyA })).rejects.toThrow();
  });

  it('updates editable fields and records an update audit entry', async () => {
    const { updateAsset, getAsset } = await import('@/services/asset-service');
    const created = await makeAsset();
    await updateAsset(admin, created.id, { nameEn: 'Renamed Asset', manufacturer: 'Carrier', supplierVendorId: vendorId });
    const asset = await getAsset({ organizationId: admin.organizationId }, created.id);
    expect(asset.nameEn).toBe('Renamed Asset');
    expect(asset.manufacturer).toBe('Carrier');
    expect(asset.supplierVendorId).toBe(vendorId);
    expect((await auditFor(created.id)).some((a) => a.action === 'update')).toBe(true);
  });
});

/* ---------------------------- Assignment ------------------------------- */

describe('Asset assignment & transfer', () => {
  it('assigns a building within the current property and audits it', async () => {
    const { assignAsset, getAsset } = await import('@/services/asset-service');
    const created = await makeAsset();
    await assignAsset(admin, created.id, { buildingId: buildingA, location: 'Roof' });
    const asset = await getAsset({ organizationId: admin.organizationId }, created.id);
    expect(asset.buildingId).toBe(buildingA);
    expect(asset.location).toBe('Roof');
    expect((await auditFor(created.id)).some((a) => a.reason === 'asset_assign')).toBe(true);
  });

  it('rejects assigning a building that belongs to a different property', async () => {
    const { assignAsset } = await import('@/services/asset-service');
    const created = await makeAsset(); // in propertyA
    await expect(assignAsset(admin, created.id, { buildingId: buildingB })).rejects.toThrow(/does not belong/i);
  });

  it('transfers an asset to a different property and preserves the previous location in the audit trail', async () => {
    const { transferAsset, getAsset } = await import('@/services/asset-service');
    const created = await makeAsset();
    await transferAsset(admin, created.id, { propertyId: propertyB, buildingId: buildingB });
    const asset = await getAsset({ organizationId: admin.organizationId }, created.id);
    expect(asset.propertyId).toBe(propertyB);
    expect(asset.buildingId).toBe(buildingB);
    expect((await auditFor(created.id)).some((a) => a.reason === 'asset_transfer')).toBe(true);
  });

  it('rejects a transfer whose building does not belong to the destination property', async () => {
    const { transferAsset } = await import('@/services/asset-service');
    const created = await makeAsset();
    await expect(transferAsset(admin, created.id, { propertyId: propertyB, buildingId: buildingA })).rejects.toThrow(/does not belong/i);
  });

  it('rejects a transfer to a property outside the organization (cross-org)', async () => {
    const { transferAsset } = await import('@/services/asset-service');
    const created = await makeAsset();
    await expect(transferAsset(admin, created.id, { propertyId: FOREIGN_ORG })).rejects.toThrow(/not valid for this organization/i);
  });
});

/* ----------------------------- Lifecycle ------------------------------- */

describe('Asset lifecycle & disposal', () => {
  it('allows a valid status transition and audits it', async () => {
    const { changeAssetStatus, getAsset } = await import('@/services/asset-service');
    const created = await makeAsset();
    const result = await changeAssetStatus(admin, created.id, 'under_maintenance');
    expect(result.status).toBe('under_maintenance');
    const asset = await getAsset({ organizationId: admin.organizationId }, created.id);
    expect(asset.status).toBe('under_maintenance');
    expect((await auditFor(created.id)).some((a) => a.reason === 'asset_status_change')).toBe(true);
  });

  it('rejects decommissioning through changeAssetStatus (must use disposal)', async () => {
    const { changeAssetStatus } = await import('@/services/asset-service');
    const created = await makeAsset();
    await expect(changeAssetStatus(admin, created.id, 'decommissioned' as never)).rejects.toThrow(/dispose/i);
  });

  it('disposes an asset (soft, decommissioned) and preserves the record', async () => {
    const { disposeAsset, getAsset } = await import('@/services/asset-service');
    const created = await makeAsset();
    const result = await disposeAsset(admin, created.id, { reason: 'End of life' });
    expect(result.status).toBe('decommissioned');
    // The record is retained (no hard delete) and readable.
    const asset = await getAsset({ organizationId: admin.organizationId }, created.id);
    expect(asset.status).toBe('decommissioned');
    const audit = await auditFor(created.id);
    expect(audit.some((a) => a.action === 'soft_delete' && (a.reason ?? '').startsWith('asset_dispose:'))).toBe(true);
  });

  it('protects a disposed asset from edit, assign, transfer, status change, and re-disposal', async () => {
    const { disposeAsset, updateAsset, assignAsset, transferAsset, changeAssetStatus } = await import('@/services/asset-service');
    const created = await makeAsset();
    await disposeAsset(admin, created.id, { reason: 'Sold' });
    await expect(updateAsset(admin, created.id, { nameEn: 'X' })).rejects.toThrow(/disposed/i);
    await expect(assignAsset(admin, created.id, { buildingId: buildingA })).rejects.toThrow(/disposed/i);
    await expect(transferAsset(admin, created.id, { propertyId: propertyB })).rejects.toThrow(/disposed/i);
    await expect(changeAssetStatus(admin, created.id, 'operational')).rejects.toThrow(/cannot move/i);
    await expect(disposeAsset(admin, created.id, { reason: 'again' })).rejects.toThrow(/already/i);
  });
});

/* ------------------------- Security & isolation ------------------------ */

describe('Asset organization isolation & UUID validation', () => {
  it('does not return an asset for a foreign organization', async () => {
    const { getAsset } = await import('@/services/asset-service');
    const created = await makeAsset();
    await expect(getAsset({ organizationId: FOREIGN_ORG }, created.id)).rejects.toThrow();
  });

  it('does not mutate an asset belonging to another organization', async () => {
    const { updateAsset } = await import('@/services/asset-service');
    const created = await makeAsset();
    const foreignActor = { ...admin, organizationId: FOREIGN_ORG };
    await expect(updateAsset(foreignActor, created.id, { nameEn: 'Hijacked' })).rejects.toThrow();
  });

  it('rejects malformed UUIDs at the action boundary', async () => {
    const { updateAssetAction, changeAssetStatusAction } = await import('@/app/(app)/assets/actions');
    getSessionMock.mockResolvedValue({ ...admin, permissions: ['assets:edit'] });
    const u = await updateAssetAction(BAD_UUID, null, new FormData());
    expect(u.ok).toBe(false);
    const s = await changeAssetStatusAction(BAD_UUID, 'operational');
    expect(s.ok).toBe(false);
  });
});

/* --------------------------- RBAC (actions) ---------------------------- */

describe('Asset RBAC (server actions)', () => {
  function form(fields: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  }

  it('denies create without assets:create', async () => {
    const { createAssetAction } = await import('@/app/(app)/assets/actions');
    getSessionMock.mockResolvedValue({ ...admin, permissions: ['assets:view'] });
    const result = await createAssetAction(null, form({ nameEn: 'X', assetType: 'pump', propertyId: propertyA }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');
  });

  it('allows create with assets:create', async () => {
    const { createAssetAction } = await import('@/app/(app)/assets/actions');
    getSessionMock.mockResolvedValue({ ...admin, permissions: ['assets:create'] });
    const result = await createAssetAction(null, form({ nameEn: 'Authorized Asset', assetType: 'generator', propertyId: propertyA }));
    expect(result.ok).toBe(true);
  });

  it('denies edit / transfer / status-change without assets:edit', async () => {
    const { updateAssetAction, transferAssetAction, changeAssetStatusAction } = await import('@/app/(app)/assets/actions');
    const created = await makeAsset();
    getSessionMock.mockResolvedValue({ ...admin, permissions: ['assets:view'] });
    const u = await updateAssetAction(created.id, null, form({ nameEn: 'Y', assetType: 'pump' }));
    expect(u.ok).toBe(false);
    const t = await transferAssetAction(created.id, { propertyId: propertyB });
    expect(t.ok).toBe(false);
    const s = await changeAssetStatusAction(created.id, 'faulty');
    expect(s.ok).toBe(false);
  });

  it('denies disposal without assets:delete but allows it with the permission', async () => {
    const { disposeAssetAction } = await import('@/app/(app)/assets/actions');
    const created = await makeAsset();
    getSessionMock.mockResolvedValue({ ...admin, permissions: ['assets:edit'] });
    const denied = await disposeAssetAction(created.id, 'no permission');
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN');

    getSessionMock.mockResolvedValue({ ...admin, permissions: ['assets:delete'] });
    const allowed = await disposeAssetAction(created.id, 'authorized disposal');
    expect(allowed.ok).toBe(true);
  });
});
