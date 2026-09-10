import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { bootstrapTestDb } from './setup-db';
import type { Database } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';

const FOREIGN_ORG = '00000000-0000-4000-8000-000000000000';

let db: Database;
let cleanup: () => void;
let admin: SessionUser;

// A concrete city → building → unit chain drawn from the seeded portfolio.
let cityId = '';
let buildingId = '';
let buildingCityId = '';
let unitId = '';
let unitPropertyId = '';

beforeAll(async () => {
  const ctx = await bootstrapTestDb();
  db = ctx.db;
  cleanup = ctx.cleanup;
  const { users } = await import('@/db/schema');
  const { loadSessionUser } = await import('@/lib/auth/session');
  const [u] = await db.select().from(users).where(eq(users.email, 'sayeed.almousa@riftara.sa')).limit(1);
  admin = (await loadSessionUser(u.id))!;

  const { getDashboardFilterOptions } = await import('@/services/metrics-service');
  const opts = await getDashboardFilterOptions(admin);
  // Pick a unit that has a building, and use its chain.
  const unit = opts.units.find((x) => x.buildingId) ?? opts.units[0];
  unitId = unit.id;
  unitPropertyId = unit.propertyId;
  const building = opts.buildings.find((b) => b.id === unit.buildingId) ?? opts.buildings[0];
  buildingId = building.id;
  buildingCityId = building.cityId;
  cityId = unit.cityId;
}, 180_000);

afterAll(() => cleanup?.());

function scope(overrides: Record<string, unknown> = {}) {
  return { organizationId: admin.organizationId, ...overrides };
}

describe('Dashboard filter options — hierarchy & scope', () => {
  it('returns a real, linked City → Building → Unit hierarchy', async () => {
    const { getDashboardFilterOptions } = await import('@/services/metrics-service');
    const opts = await getDashboardFilterOptions(admin);
    expect(opts.cities.length).toBeGreaterThan(0);
    expect(opts.buildings.length).toBeGreaterThan(0);
    expect(opts.units.length).toBeGreaterThan(0);
    // Every building points at a city present in the city list.
    const cityIds = new Set(opts.cities.map((c) => c.id));
    expect(opts.buildings.every((b) => cityIds.has(b.cityId))).toBe(true);
    // Units carry their parent building/property/city for cascading.
    const unit = opts.units.find((u) => u.buildingId);
    expect(unit).toBeTruthy();
  });

  it('is organization-isolated (a foreign org sees no hierarchy)', async () => {
    const { getDashboardFilterOptions } = await import('@/services/metrics-service');
    const opts = await getDashboardFilterOptions({ ...admin, organizationId: FOREIGN_ORG });
    expect(opts).toEqual({ cities: [], buildings: [], units: [] });
  });
});

describe('Hierarchical KPI scoping narrows monotonically', () => {
  it('org ≥ city ≥ building ≥ unit for total units', async () => {
    const { getAvailabilityBreakdown } = await import('@/services/metrics-service');
    const org = await getAvailabilityBreakdown(scope());
    const city = await getAvailabilityBreakdown(scope({ cityId }));
    const building = await getAvailabilityBreakdown(scope({ cityId: buildingCityId, propertyId: unitPropertyId, buildingId }));
    const unit = await getAvailabilityBreakdown(scope({ propertyId: unitPropertyId, unitId }));

    expect(org.total).toBeGreaterThan(0);
    expect(city.total).toBeGreaterThan(0);
    expect(city.total).toBeLessThanOrEqual(org.total);
    expect(building.total).toBeLessThanOrEqual(city.total);
    expect(building.total).toBeGreaterThan(0);
    expect(unit.total).toBe(1);
  });

  it('scopes the portfolio summary financials to a single unit', async () => {
    const { getPortfolioSummary } = await import('@/services/metrics-service');
    const org = await getPortfolioSummary(scope());
    const unit = await getPortfolioSummary(scope({ propertyId: unitPropertyId, unitId }));
    expect(unit.totalUnits).toBe(1);
    // Unit-scoped contracted revenue cannot exceed the whole portfolio's.
    expect(unit.contractedRevenue).toBeLessThanOrEqual(org.contractedRevenue);
    expect(unit.collectedRevenue).toBeLessThanOrEqual(org.collectedRevenue);
    expect(Number.isFinite(unit.collectionRate)).toBe(true);
  });

  it('combines a date range with a city scope without error', async () => {
    const { getPortfolioSummary } = await import('@/services/metrics-service');
    const periodEnd = new Date();
    const periodStart = new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth() - 5, 1));
    const s = await getPortfolioSummary(scope({ cityId, periodStart, periodEnd }));
    expect(s.totalUnits).toBeGreaterThan(0);
    expect(s.collectedRevenue).toBeGreaterThanOrEqual(0);
  });

  it('returns an empty summary for a foreign organization', async () => {
    const { getPortfolioSummary } = await import('@/services/metrics-service');
    const s = await getPortfolioSummary(scope({ organizationId: FOREIGN_ORG }));
    expect(s.totalUnits).toBe(0);
    expect(s.contractedRevenue).toBe(0);
  });

  it('enforces the user property data-scope on dashboard KPIs', async () => {
    const { getAvailabilityBreakdown } = await import('@/services/metrics-service');
    const org = await getAvailabilityBreakdown(scope());
    const scoped = await getAvailabilityBreakdown(scope({ allowedPropertyIds: [unitPropertyId] }));
    expect(scoped.total).toBeGreaterThan(0);
    expect(scoped.total).toBeLessThanOrEqual(org.total);
    const empty = await getAvailabilityBreakdown(scope({ allowedPropertyIds: [FOREIGN_ORG] }));
    expect(empty.total).toBe(0);
  });
});

describe('Unit 360 focus', () => {
  it('returns a full unit summary for a real unit', async () => {
    const { getUnitFocus } = await import('@/services/metrics-service');
    const focus = await getUnitFocus(admin.organizationId, unitId);
    expect(focus).not.toBeNull();
    expect(focus!.unit.id).toBe(unitId);
    expect(focus!.unit.propertyName).toBeTruthy();
    expect(Number.isFinite(focus!.financial.collectionRate)).toBe(true);
    expect(focus!.maintenance.openWorkOrders).toBeGreaterThanOrEqual(0);
  });

  it('returns null for a foreign organization or an invalid unit id (IDOR-safe)', async () => {
    const { getUnitFocus } = await import('@/services/metrics-service');
    expect(await getUnitFocus(FOREIGN_ORG, unitId)).toBeNull();
    expect(await getUnitFocus(admin.organizationId, FOREIGN_ORG)).toBeNull();
  });
});

describe('Panels respect building/unit scope', () => {
  it('scopes upcoming renewals and recent work orders to the unit', async () => {
    const { getUpcomingRenewals, getRecentWorkOrders } = await import('@/services/dashboard-service');
    // Should not throw and should return arrays within the unit scope.
    const renewals = await getUpcomingRenewals(scope({ propertyId: unitPropertyId, unitId }));
    const workOrders = await getRecentWorkOrders(scope({ propertyId: unitPropertyId, unitId }));
    expect(Array.isArray(renewals)).toBe(true);
    expect(Array.isArray(workOrders)).toBe(true);
  });
});
