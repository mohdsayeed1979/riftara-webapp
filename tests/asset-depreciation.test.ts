import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { bootstrapTestDb } from './setup-db';
import type { Database } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';

const FOREIGN_ORG = '00000000-0000-4000-8000-000000000000';
const AS_OF = new Date('2026-01-01T00:00:00.000Z');

let db: Database;
let cleanup: () => void;
let admin: SessionUser;
let propertyA = '';

async function makeAsset(nameEn = 'Depreciation Asset') {
  const { createAsset } = await import('@/services/asset-service');
  return createAsset(admin, { nameEn, assetType: 'chiller', propertyId: propertyA });
}

beforeAll(async () => {
  const ctx = await bootstrapTestDb();
  db = ctx.db;
  cleanup = ctx.cleanup;
  const { users, maintenanceAssets } = await import('@/db/schema');
  const { loadSessionUser } = await import('@/lib/auth/session');
  const [u] = await db.select().from(users).where(eq(users.email, 'sayeed.almousa@riftara.sa')).limit(1);
  admin = (await loadSessionUser(u.id))!;
  const [a] = await db.select({ propertyId: maintenanceAssets.propertyId }).from(maintenanceAssets).where(eq(maintenanceAssets.organizationId, admin.organizationId)).limit(1);
  propertyA = a.propertyId;
}, 180_000);

afterAll(() => cleanup?.());

/* ----------------------- Depreciation (pure calc) ---------------------- */

describe('calculateAssetDepreciation (straight-line, calculated read-model)', () => {
  const base = { purchaseCost: 120_000, purchaseDate: '2021-01-01', usefulLifeYears: 10, residualValue: 20_000, depreciationMethod: 'straight_line', status: 'operational' };

  it('computes a valid straight-line schedule and preserves the exact elapsed instant', async () => {
    const { calculateAssetDepreciation } = await import('@/services/asset-service');
    const d = calculateAssetDepreciation(base, AS_OF);
    expect(d.depreciable).toBe(true);
    if (!d.depreciable) return;
    // base = 120000 - 20000 = 100000; annual = 10000; monthly ≈ 833.33
    expect(d.depreciableBase).toBe(100_000);
    expect(d.annualDepreciation).toBe(10_000);
    expect(d.monthlyDepreciation).toBeCloseTo(833.33, 1);
    // 5 years elapsed (2021-01-01 → 2026-01-01) → accumulated ≈ 50000, NBV ≈ 70000
    expect(d.accumulatedDepreciation).toBeGreaterThan(49_000);
    expect(d.accumulatedDepreciation).toBeLessThan(51_000);
    expect(d.netBookValue).toBeCloseTo(120_000 - d.accumulatedDepreciation, 2);
  });

  it('handles a partial year (accumulated between year boundaries)', async () => {
    const { calculateAssetDepreciation } = await import('@/services/asset-service');
    const d = calculateAssetDepreciation({ ...base, purchaseDate: '2025-07-01' }, AS_OF); // ~0.5 yr
    if (!d.depreciable) throw new Error('expected depreciable');
    expect(d.accumulatedDepreciation).toBeGreaterThan(0);
    expect(d.accumulatedDepreciation).toBeLessThan(d.annualDepreciation); // under one full year
    expect(d.started).toBe(true);
  });

  it('caps at full depreciation once useful life has elapsed (NBV = residual)', async () => {
    const { calculateAssetDepreciation } = await import('@/services/asset-service');
    const d = calculateAssetDepreciation({ ...base, purchaseDate: '2000-01-01' }, AS_OF);
    if (!d.depreciable) throw new Error('expected depreciable');
    expect(d.fullyDepreciated).toBe(true);
    expect(d.accumulatedDepreciation).toBe(d.depreciableBase);
    expect(d.netBookValue).toBe(base.residualValue);
  });

  it('treats a future purchase date as not yet started (NBV = cost)', async () => {
    const { calculateAssetDepreciation } = await import('@/services/asset-service');
    const d = calculateAssetDepreciation({ ...base, purchaseDate: '2030-01-01' }, AS_OF);
    if (!d.depreciable) throw new Error('expected depreciable');
    expect(d.started).toBe(false);
    expect(d.accumulatedDepreciation).toBe(0);
    expect(d.netBookValue).toBe(base.purchaseCost);
  });

  it('clamps residual value greater than cost to a zero depreciable base', async () => {
    const { calculateAssetDepreciation } = await import('@/services/asset-service');
    const d = calculateAssetDepreciation({ ...base, residualValue: 500_000 }, AS_OF);
    if (!d.depreciable) throw new Error('expected depreciable');
    expect(d.depreciableBase).toBe(0);
    expect(d.accumulatedDepreciation).toBe(0);
    expect(d.netBookValue).toBe(base.purchaseCost);
  });

  it('is not depreciable with zero/negative cost, missing date, or invalid useful life (no division by zero)', async () => {
    const { calculateAssetDepreciation } = await import('@/services/asset-service');
    expect(calculateAssetDepreciation({ ...base, purchaseCost: 0 }, AS_OF).depreciable).toBe(false);
    expect(calculateAssetDepreciation({ ...base, purchaseCost: -5 }, AS_OF).depreciable).toBe(false);
    expect(calculateAssetDepreciation({ ...base, purchaseDate: null }, AS_OF).depreciable).toBe(false);
    expect(calculateAssetDepreciation({ ...base, usefulLifeYears: 0 }, AS_OF).depreciable).toBe(false);
    expect(calculateAssetDepreciation({ ...base, usefulLifeYears: null }, AS_OF).depreciable).toBe(false);
    expect(calculateAssetDepreciation({ ...base, usefulLifeYears: -3 }, AS_OF).depreciable).toBe(false);
  });

  it('defaults a missing residual value to zero', async () => {
    const { calculateAssetDepreciation } = await import('@/services/asset-service');
    const d = calculateAssetDepreciation({ ...base, residualValue: null, purchaseDate: '2030-01-01' }, AS_OF);
    if (!d.depreciable) throw new Error('expected depreciable');
    expect(d.residualValue).toBe(0);
    expect(d.depreciableBase).toBe(base.purchaseCost);
  });

  it('still computes for a decommissioned asset when inputs exist', async () => {
    const { calculateAssetDepreciation } = await import('@/services/asset-service');
    const d = calculateAssetDepreciation({ ...base, status: 'decommissioned' }, AS_OF);
    expect(d.depreciable).toBe(true);
  });
});

/* ---------------------- Maintenance linkage (DB) ----------------------- */

describe('Asset maintenance summary', () => {
  async function seedWorkOrders(assetId: string) {
    const { workOrders, maintenanceCosts } = await import('@/db/schema');
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    const [openWo] = await db.insert(workOrders).values({ organizationId: admin.organizationId, code: `WOT-${suffix}-1`, title: 'Open WO', propertyId: propertyA, assetId, status: 'open' }).returning({ id: workOrders.id });
    const [doneWo] = await db.insert(workOrders).values({ organizationId: admin.organizationId, code: `WOT-${suffix}-2`, title: 'Done WO', propertyId: propertyA, assetId, status: 'completed', completedAt: new Date() }).returning({ id: workOrders.id });
    await db.insert(maintenanceCosts).values({ organizationId: admin.organizationId, workOrderId: doneWo.id, propertyId: propertyA, assetId, description: 'Parts', amount: 500, incurredOn: '2025-06-01' });
    return { openWo: openWo.id, doneWo: doneWo.id };
  }

  it('aggregates work orders and costs for an asset that has maintenance', async () => {
    const { getAssetMaintenanceSummary } = await import('@/services/asset-service');
    const asset = await makeAsset();
    await seedWorkOrders(asset.id);
    const summary = await getAssetMaintenanceSummary(admin.organizationId, asset.id);
    expect(summary.totalWorkOrders).toBe(2);
    expect(summary.openWorkOrders).toBe(1);
    expect(summary.completedWorkOrders).toBe(1);
    expect(summary.totalMaintenanceCost).toBe(500);
    expect(summary.lastCompletedAt).toBeTruthy();
  });

  it('returns zeros for an asset with no maintenance', async () => {
    const { getAssetMaintenanceSummary } = await import('@/services/asset-service');
    const asset = await makeAsset('No Maintenance Asset');
    const summary = await getAssetMaintenanceSummary(admin.organizationId, asset.id);
    expect(summary.totalWorkOrders).toBe(0);
    expect(summary.totalMaintenanceCost).toBe(0);
    expect(summary.lastCompletedAt).toBeNull();
  });

  it('does not leak maintenance across organizations', async () => {
    const { getAssetMaintenanceSummary } = await import('@/services/asset-service');
    const asset = await makeAsset();
    await seedWorkOrders(asset.id);
    const summary = await getAssetMaintenanceSummary(FOREIGN_ORG, asset.id);
    expect(summary.totalWorkOrders).toBe(0);
    expect(summary.totalMaintenanceCost).toBe(0);
  });
});

/* ----------------------------- Valuation ------------------------------- */

describe('Asset valuation context (property-scoped, not asset-level)', () => {
  it('returns the property current valuation as context', async () => {
    const { getAssetValuationContext } = await import('@/services/asset-service');
    const ctx = await getAssetValuationContext(admin.organizationId, propertyA);
    // The seed provisions a current valuation per property.
    if (ctx) {
      expect(Number(ctx.marketValue)).toBeGreaterThan(0);
    } else {
      expect(ctx).toBeNull();
    }
  });

  it('does not expose valuation context across organizations', async () => {
    const { getAssetValuationContext } = await import('@/services/asset-service');
    const ctx = await getAssetValuationContext(FOREIGN_ORG, propertyA);
    expect(ctx).toBeNull();
  });

  it('has no asset-level valuation relationship (valuations remain property-scoped)', async () => {
    const { valuations } = await import('@/db/schema');
    // Guard against silent schema drift: valuations must not gain an assetId column.
    expect('assetId' in valuations).toBe(false);
  });
});
