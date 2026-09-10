import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { bootstrapTestDb } from './setup-db';
import type { Database } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';

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

let property = { id: '', code: '', name: '' };
let unit = { id: '', number: '' };
let customer = { id: '', code: '', name: '' };
let contract = { id: '', number: '' };
let asset = { id: '', code: '' };

function ctx(overrides: Partial<{ permissions: string[]; allowedPropertyIds: string[] | null; organizationId: string }> = {}) {
  return {
    organizationId: overrides.organizationId ?? admin.organizationId,
    permissions: (overrides.permissions ?? admin.permissions) as SessionUser['permissions'],
    allowedPropertyIds: overrides.allowedPropertyIds ?? null,
  };
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'riftara-search-'));
  process.env.STORAGE_DRIVER = 'local';
  process.env.STORAGE_LOCAL_DIR = dir;
  const c = await bootstrapTestDb();
  db = c.db;
  cleanup = () => { c.cleanup(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } };

  const { users, properties, units, customers, contracts, maintenanceAssets } = await import('@/db/schema');
  const { loadSessionUser, getSession } = await import('@/lib/auth/session');
  getSessionMock = getSession as unknown as ReturnType<typeof vi.fn>;
  const [u] = await db.select().from(users).where(eq(users.email, 'sayeed.almousa@riftara.sa')).limit(1);
  admin = (await loadSessionUser(u.id))!;

  const [p] = await db.select({ id: properties.id, code: properties.code, name: properties.nameEn }).from(properties).where(eq(properties.organizationId, admin.organizationId)).limit(1);
  property = p;
  const [un] = await db.select({ id: units.id, number: units.unitNumber }).from(units).where(eq(units.propertyId, property.id)).limit(1);
  unit = un;
  const [cu] = await db.select({ id: customers.id, code: customers.code, name: customers.fullNameEn }).from(customers).where(eq(customers.organizationId, admin.organizationId)).limit(1);
  customer = cu;
  const [co] = await db.select({ id: contracts.id, number: contracts.contractNumber }).from(contracts).where(eq(contracts.organizationId, admin.organizationId)).limit(1);
  contract = co;
  const [as] = await db.select({ id: maintenanceAssets.id, code: maintenanceAssets.code }).from(maintenanceAssets).where(eq(maintenanceAssets.organizationId, admin.organizationId)).limit(1);
  asset = as;
}, 180_000);

afterAll(() => cleanup?.());

function findGroup(groups: Awaited<ReturnType<typeof import('@/services/search-service')['globalSearch']>>, type: string) {
  return groups.find((g) => g.entityType === type);
}

describe('Global search — coverage & entity types', () => {
  it('finds a property by its exact code and ranks it top of its group', async () => {
    const { globalSearch } = await import('@/services/search-service');
    const groups = await globalSearch(property.code, ctx());
    const g = findGroup(groups, 'property');
    expect(g).toBeTruthy();
    expect(g!.items[0].id).toBe(property.id);
    expect(g!.items[0].score).toBe(100); // exact code match
  });

  it('finds units, customers, contracts and assets', async () => {
    const { globalSearch } = await import('@/services/search-service');
    expect(findGroup(await globalSearch(unit.number, ctx()), 'unit')?.items.some((i) => i.id === unit.id)).toBe(true);
    expect(findGroup(await globalSearch(customer.name.slice(0, 4), ctx()), 'customer')?.items.length).toBeGreaterThan(0);
    expect(findGroup(await globalSearch(contract.number, ctx()), 'contract')?.items.some((i) => i.id === contract.id)).toBe(true);
    expect(findGroup(await globalSearch(asset.code, ctx()), 'asset')?.items.some((i) => i.id === asset.id)).toBe(true);
  });

  it('prefix match scores below an exact match', async () => {
    const { globalSearch } = await import('@/services/search-service');
    const prefix = property.code.slice(0, Math.max(2, property.code.length - 1));
    const g = findGroup(await globalSearch(prefix, ctx()), 'property');
    const item = g?.items.find((i) => i.id === property.id);
    expect(item).toBeTruthy();
    expect(item!.score).toBeLessThan(100);
    expect(item!.score).toBeGreaterThanOrEqual(60);
  });
});

describe('Global search — authorization', () => {
  it('returns nothing for an empty / too-short query', async () => {
    const { globalSearch } = await import('@/services/search-service');
    expect(await globalSearch('', ctx())).toEqual([]);
    expect(await globalSearch('a', ctx())).toEqual([]);
  });

  it('omits groups the user lacks permission to view (RBAC)', async () => {
    const { globalSearch } = await import('@/services/search-service');
    const onlyProps = await globalSearch(property.code, ctx({ permissions: ['properties:view'] }));
    expect(onlyProps.every((g) => g.entityType === 'property' || g.entityType === 'building' || g.entityType === 'ownership')).toBe(true);
    const none = await globalSearch(property.code, ctx({ permissions: [] }));
    expect(none).toEqual([]);
  });

  it('enforces organization isolation', async () => {
    const { globalSearch } = await import('@/services/search-service');
    expect(await globalSearch(property.code, ctx({ organizationId: FOREIGN_ORG }))).toEqual([]);
  });

  it('enforces property data-scope', async () => {
    const { globalSearch } = await import('@/services/search-service');
    const inScope = await globalSearch(property.code, ctx({ allowedPropertyIds: [property.id] }));
    expect(findGroup(inScope, 'property')?.items.some((i) => i.id === property.id)).toBe(true);
    const outOfScope = await globalSearch(property.code, ctx({ allowedPropertyIds: [FOREIGN_ORG] }));
    expect(findGroup(outOfScope, 'property')).toBeUndefined();
  });
});

describe('Global search — document security', () => {
  it('finds a document, excludes it once deleted, and never leaks the storage key', async () => {
    const { createDocument, documentActorFromUser, softDeleteDocument } = await import('@/services/document-service');
    const { globalSearch } = await import('@/services/search-service');
    const actor = documentActorFromUser(admin);
    const created = await createDocument(actor, { entityType: 'property', entityId: property.id, title: 'SearchableDeed' }, { buffer: Buffer.from('pdf'), filename: 'deed.pdf', mimeType: 'application/pdf', size: 3 });

    const g = findGroup(await globalSearch('SearchableDeed', ctx()), 'document');
    expect(g?.items.some((i) => i.id === created.id)).toBe(true);
    // No storageKey / path leakage in the result item.
    const item = g!.items.find((i) => i.id === created.id)!;
    expect(Object.keys(item).sort()).toEqual(['badge', 'href', 'id', 'score', 'subtitle', 'title']);
    expect(JSON.stringify(item)).not.toMatch(/storage|org\//i);

    await softDeleteDocument(actor, created.id);
    expect(findGroup(await globalSearch('SearchableDeed', ctx()), 'document')?.items.some((i) => i.id === created.id)).toBeFalsy();
  });

  it('hides a confidential / requiredPermission document from users without that permission', async () => {
    const { createDocument, documentActorFromUser } = await import('@/services/document-service');
    const { globalSearch } = await import('@/services/search-service');
    const actor = documentActorFromUser(admin);
    const doc = await createDocument(actor, { entityType: 'property', entityId: property.id, title: 'ConfidentialDeed', isConfidential: true, requiredPermission: 'financials:view' }, { buffer: Buffer.from('pdf'), filename: 'c.pdf', mimeType: 'application/pdf', size: 3 });

    const withoutPerm = await globalSearch('ConfidentialDeed', ctx({ permissions: ['documents:view'] }));
    expect(findGroup(withoutPerm, 'document')?.items.some((i) => i.id === doc.id)).toBeFalsy();

    const withPerm = await globalSearch('ConfidentialDeed', ctx({ permissions: ['documents:view', 'financials:view'] }));
    expect(findGroup(withPerm, 'document')?.items.some((i) => i.id === doc.id)).toBe(true);
  });
});

describe('Global search — flat mode, limits & ranking', () => {
  it('paginates and enforces a bounded page size', async () => {
    const { searchFlat } = await import('@/services/search-service');
    const res = await searchFlat(property.code, ctx(), { page: 1, pageSize: 5 });
    expect(res.pageSize).toBeLessThanOrEqual(50);
    expect(res.results.length).toBeLessThanOrEqual(5);
    expect(res.results.every((r) => typeof r.url === 'string' && typeof r.type === 'string')).toBe(true);
  });

  it('filters flat results to a single entity type', async () => {
    const { searchFlat } = await import('@/services/search-service');
    const res = await searchFlat(property.code, ctx(), { type: 'property' });
    expect(res.results.every((r) => r.type === 'property')).toBe(true);
  });

  it('caps an over-long query rather than erroring', async () => {
    const { searchFlat } = await import('@/services/search-service');
    const res = await searchFlat('x'.repeat(500), ctx());
    expect(res.total).toBe(0);
  });
});

describe('Global search API route', () => {
  function req(qs: string) {
    return new NextRequest(new URL(`http://localhost/api/v1/search?${qs}`));
  }

  it('rejects an unauthenticated request with 401', async () => {
    const { GET } = await import('@/app/api/v1/search/route');
    getSessionMock.mockResolvedValue(null);
    const res = await GET(req(`q=${property.code}`));
    expect(res.status).toBe(401);
  });

  it('returns grouped results for an authenticated request (backward compatible)', async () => {
    const { GET } = await import('@/app/api/v1/search/route');
    getSessionMock.mockResolvedValue(admin);
    const res = await GET(req(`q=${encodeURIComponent(property.code)}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((g: { entityType: string }) => g.entityType === 'property')).toBe(true);
  });

  it('returns normalized flat results with format=flat', async () => {
    const { GET } = await import('@/app/api/v1/search/route');
    getSessionMock.mockResolvedValue(admin);
    const res = await GET(req(`q=${encodeURIComponent(property.code)}&format=flat`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.results).toBeDefined();
    expect(typeof body.data.total).toBe('number');
  });

  it('rejects an over-long query and an invalid type filter', async () => {
    const { GET } = await import('@/app/api/v1/search/route');
    getSessionMock.mockResolvedValue(admin);
    expect((await GET(req(`q=${'x'.repeat(200)}`))).status).toBe(400);
    expect((await GET(req(`q=${property.code}&format=flat&type=bogus`))).status).toBe(400);
  });
});
