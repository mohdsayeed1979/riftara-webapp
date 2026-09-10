import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { bootstrapTestDb } from './setup-db';
import type { Database } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth/session')>();
  return { ...mod, getSession: vi.fn() };
});

// The API guard and audit writer read request headers; outside a Next request
// scope headers() throws, so provide a minimal stub (no Authorization header,
// so the guard falls through to the mocked session).
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

const FOREIGN_ORG = '00000000-0000-4000-8000-000000000000';

let db: Database;
let cleanup: () => void;
let admin: SessionUser;
let getSessionMock: ReturnType<typeof vi.fn>;
let propertyA = '';

async function makeAsset(overrides: Record<string, unknown> = {}) {
  const { createAsset } = await import('@/services/asset-service');
  return createAsset(admin, { nameEn: 'Analytics Asset', assetType: 'chiller', propertyId: propertyA, ...overrides });
}

beforeAll(async () => {
  const ctx = await bootstrapTestDb();
  db = ctx.db;
  cleanup = ctx.cleanup;
  const { users, maintenanceAssets } = await import('@/db/schema');
  const { loadSessionUser, getSession } = await import('@/lib/auth/session');
  getSessionMock = getSession as unknown as ReturnType<typeof vi.fn>;
  const [u] = await db.select().from(users).where(eq(users.email, 'sayeed.almousa@riftara.sa')).limit(1);
  admin = (await loadSessionUser(u.id))!;
  const [a] = await db.select({ propertyId: maintenanceAssets.propertyId }).from(maintenanceAssets).where(eq(maintenanceAssets.organizationId, admin.organizationId)).limit(1);
  propertyA = a.propertyId;
}, 180_000);

afterAll(() => cleanup?.());

describe('Asset dashboard KPIs — organization isolation & data scope', () => {
  it('returns zero KPIs for a foreign organization', async () => {
    const { getAssetKpis, getAssetDepreciationTotals, getAssetMaintenanceAnalytics, getAssetLifecycleBreakdown } = await import('@/services/asset-service');
    const kpis = await getAssetKpis({ organizationId: FOREIGN_ORG });
    expect(kpis.total).toBe(0);
    const dep = await getAssetDepreciationTotals({ organizationId: FOREIGN_ORG });
    expect(dep.totalPurchaseCost).toBe(0);
    expect(dep.depreciableAssets).toBe(0);
    const maint = await getAssetMaintenanceAnalytics({ organizationId: FOREIGN_ORG });
    expect(maint.totalSpend).toBe(0);
    const life = await getAssetLifecycleBreakdown({ organizationId: FOREIGN_ORG });
    expect(life.byStatus).toEqual([]);
  });

  it('enforces the user property data-scope', async () => {
    const { getAssetKpis } = await import('@/services/asset-service');
    const orgTotal = (await getAssetKpis({ organizationId: admin.organizationId })).total;
    expect(orgTotal).toBeGreaterThan(0);
    const scoped = await getAssetKpis({ organizationId: admin.organizationId, allowedPropertyIds: [propertyA] });
    expect(scoped.total).toBeGreaterThan(0);
    expect(scoped.total).toBeLessThanOrEqual(orgTotal);
    const emptyScope = await getAssetKpis({ organizationId: admin.organizationId, allowedPropertyIds: [FOREIGN_ORG] });
    expect(emptyScope.total).toBe(0);
  });
});

describe('Asset status & depreciation aggregation', () => {
  it('reflects a new operational asset in the status counts', async () => {
    const { getAssetKpis } = await import('@/services/asset-service');
    const before = await getAssetKpis({ organizationId: admin.organizationId });
    await makeAsset();
    const after = await getAssetKpis({ organizationId: admin.organizationId });
    expect(after.total).toBe(before.total + 1);
    expect(after.operational).toBe(before.operational + 1);
  });

  it('aggregates depreciation totals from calculated inputs (fully depreciated + missing)', async () => {
    const { getAssetDepreciationTotals } = await import('@/services/asset-service');
    const before = await getAssetDepreciationTotals({ organizationId: admin.organizationId });
    // Fully depreciated: purchased long ago, life 10 → NBV = residual = 20,000.
    await makeAsset({ purchaseCost: 120_000, purchaseDate: '2000-01-01', usefulLifeYears: 10, residualValue: 20_000 });
    // Missing depreciation inputs.
    await makeAsset({ nameEn: 'No Inputs Asset' });
    const after = await getAssetDepreciationTotals({ organizationId: admin.organizationId });
    expect(after.depreciableAssets).toBe(before.depreciableAssets + 1);
    expect(after.fullyDepreciatedAssets).toBe(before.fullyDepreciatedAssets + 1);
    expect(after.missingInputs).toBe(before.missingInputs + 1);
    expect(after.totalNetBookValue).toBeCloseTo(before.totalNetBookValue + 20_000, 0);
  });
});

describe('Asset maintenance analytics aggregation', () => {
  it('aggregates spend and work-order counts, and batches per-asset totals without N+1', async () => {
    const { getAssetMaintenanceAnalytics, getAssetMaintenanceTotalsByAsset } = await import('@/services/asset-service');
    const { workOrders, maintenanceCosts } = await import('@/db/schema');
    const asset = await makeAsset();
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    const [wo] = await db.insert(workOrders).values({ organizationId: admin.organizationId, code: `WOA-${suffix}`, title: 'WO', propertyId: propertyA, assetId: asset.id, status: 'completed', completedAt: new Date() }).returning({ id: workOrders.id });
    await db.insert(maintenanceCosts).values({ organizationId: admin.organizationId, workOrderId: wo.id, propertyId: propertyA, assetId: asset.id, description: 'Repair', amount: 1234.5, incurredOn: '2025-05-01' });

    const analytics = await getAssetMaintenanceAnalytics({ organizationId: admin.organizationId });
    expect(analytics.totalSpend).toBeGreaterThanOrEqual(1234.5);
    expect(analytics.topAssets.some((a) => a.assetId === asset.id)).toBe(true);

    const map = await getAssetMaintenanceTotalsByAsset({ organizationId: admin.organizationId });
    const entry = map.get(asset.id);
    expect(entry?.totalMaintenanceCost).toBe(1234.5);
    expect(entry?.completedWorkOrders).toBe(1);
  });
});

describe('Asset export routes — RBAC, isolation & audit', () => {
  function req(path: string) {
    return new NextRequest(new URL(`http://localhost${path}`));
  }

  it('denies the register export without assets:view', async () => {
    const { GET } = await import('@/app/api/v1/assets/export/route');
    getSessionMock.mockResolvedValue({ ...admin, permissions: [] });
    const res = await GET(req('/api/v1/assets/export?format=csv'));
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('exports the register as CSV for an authorized user and writes an audit event', async () => {
    const { GET } = await import('@/app/api/v1/assets/export/route');
    const { auditLogs } = await import('@/db/schema');
    getSessionMock.mockResolvedValue({ ...admin, permissions: ['assets:view'] });
    const res = await GET(req('/api/v1/assets/export?format=csv'));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body.split('\n')[0]).toContain('Asset Code');
    expect(body).toContain('Calculated Net Book Value');
    const audit = await db.select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.organizationId, admin.organizationId), eq(auditLogs.entityType, 'asset_register')));
    expect(audit.length).toBeGreaterThan(0);
  });

  it('exports the maintenance report and audits it', async () => {
    const { GET } = await import('@/app/api/v1/assets/maintenance/export/route');
    const { auditLogs } = await import('@/db/schema');
    getSessionMock.mockResolvedValue({ ...admin, permissions: ['assets:view'] });
    const res = await GET(req('/api/v1/assets/maintenance/export?format=csv'));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body.split('\n')[0]).toContain('Total Work Orders');
    const audit = await db.select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.organizationId, admin.organizationId), eq(auditLogs.entityType, 'asset_maintenance_report')));
    expect(audit.length).toBeGreaterThan(0);
  });

  it('enforces the user data-scope in exports (no out-of-scope rows)', async () => {
    const { GET } = await import('@/app/api/v1/assets/export/route');
    // Valid org (audit FK), but a property scope that matches no assets.
    getSessionMock.mockResolvedValue({ ...admin, permissions: ['assets:view'], scopedPropertyIds: [FOREIGN_ORG] });
    const res = await GET(req('/api/v1/assets/export?format=csv'));
    expect(res.status).toBe(200);
    const body = await res.text();
    // Header row only — no data rows within the (empty) scope.
    expect(body.trim().split('\n').length).toBe(1);
  });
});
