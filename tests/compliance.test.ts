import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
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
const isoInDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

let db: Database;
let cleanup: () => void;
let admin: SessionUser;
let getSessionMock: ReturnType<typeof vi.fn>;
let propertyId = '';
const assetIds: string[] = [];

async function docActor() {
  const { documentActorFromUser } = await import('@/services/document-service');
  return documentActorFromUser(admin);
}
async function createDoc(title: string, expiryDate: string, extra: Record<string, unknown> = {}) {
  const { createDocument } = await import('@/services/document-service');
  return createDocument(await docActor(), { entityType: 'property', entityId: propertyId, title, expiryDate, ...extra }, { buffer: Buffer.from('pdf'), filename: 'f.pdf', mimeType: 'application/pdf', size: 3 });
}
async function notif(type: string, entityId: string) {
  const { notifications } = await import('@/db/schema');
  return db.select({ id: notifications.id, severity: notifications.severity, requiredPermission: notifications.requiredPermission, linkHref: notifications.linkHref, body: notifications.body }).from(notifications).where(and(eq(notifications.organizationId, admin.organizationId), eq(notifications.notificationType, type), eq(notifications.entityId, entityId)));
}
async function setWarranty(assetId: string, date: string | null, status = 'operational') {
  const { maintenanceAssets } = await import('@/db/schema');
  await db.update(maintenanceAssets).set({ warrantyExpiryDate: date, status }).where(eq(maintenanceAssets.id, assetId));
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'riftara-compliance-'));
  process.env.STORAGE_DRIVER = 'local';
  process.env.STORAGE_LOCAL_DIR = dir;
  const c = await bootstrapTestDb();
  db = c.db;
  cleanup = () => { c.cleanup(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } };

  const { users, properties, maintenanceAssets } = await import('@/db/schema');
  const { loadSessionUser, getSession } = await import('@/lib/auth/session');
  getSessionMock = getSession as unknown as ReturnType<typeof vi.fn>;
  const [u] = await db.select().from(users).where(eq(users.email, 'sayeed.almousa@riftara.sa')).limit(1);
  admin = (await loadSessionUser(u.id))!;
  const [p] = await db.select({ id: properties.id }).from(properties).where(eq(properties.organizationId, admin.organizationId)).limit(1);
  propertyId = p.id;
  const assets = await db.select({ id: maintenanceAssets.id }).from(maintenanceAssets).where(eq(maintenanceAssets.propertyId, propertyId)).limit(5);
  for (const a of assets) assetIds.push(a.id);
  // Clear seeded warranty dates so only the ones we set drive the tests.
  await db.update(maintenanceAssets).set({ warrantyExpiryDate: null }).where(eq(maintenanceAssets.organizationId, admin.organizationId));
}, 180_000);

afterAll(() => cleanup?.());

describe('Document expiry generator', () => {
  it('notifies approaching (warning) and expired (error) documents, ignoring those outside the window', async () => {
    const { generateDocumentExpiryNotifications } = await import('@/services/notification-service');
    const soon = await createDoc('DueSoonDoc', isoInDays(10));
    const past = await createDoc('ExpiredDoc', isoInDays(-5));
    const far = await createDoc('FarDoc', isoInDays(300));
    await generateDocumentExpiryNotifications(admin.organizationId);
    expect((await notif('document_expiry', soon.id))[0]?.severity).toBe('warning');
    expect((await notif('document_expiry', past.id))[0]?.severity).toBe('error');
    expect(await notif('document_expiry', far.id)).toHaveLength(0);
  });

  it('is idempotent within the recency window', async () => {
    const { generateDocumentExpiryNotifications } = await import('@/services/notification-service');
    const doc = await createDoc('IdempotentDoc', isoInDays(15));
    await generateDocumentExpiryNotifications(admin.organizationId);
    await generateDocumentExpiryNotifications(admin.organizationId);
    expect(await notif('document_expiry', doc.id)).toHaveLength(1);
  });

  it('excludes soft-deleted and non-current documents', async () => {
    const { generateDocumentExpiryNotifications } = await import('@/services/notification-service');
    const { softDeleteDocument, createDocument } = await import('@/services/document-service');
    const deleted = await createDoc('DeletedDoc', isoInDays(10));
    await softDeleteDocument(await docActor(), deleted.id);
    const v1 = await createDoc('VersionedDoc', isoInDays(10));
    await createDocument(await docActor(), { entityType: 'property', entityId: propertyId, title: 'VersionedDoc', supersedesId: v1.id }, { buffer: Buffer.from('v2'), filename: 'v2.pdf', mimeType: 'application/pdf', size: 2 });
    await generateDocumentExpiryNotifications(admin.organizationId);
    expect(await notif('document_expiry', deleted.id)).toHaveLength(0);
    expect(await notif('document_expiry', v1.id)).toHaveLength(0); // superseded
  });

  it('targets confidential / requiredPermission documents to authorized users only, and leaks no storage key', async () => {
    const { generateDocumentExpiryNotifications } = await import('@/services/notification-service');
    const doc = await createDoc('SecretDoc', isoInDays(10), { isConfidential: true, requiredPermission: 'financials:view' });
    await generateDocumentExpiryNotifications(admin.organizationId);
    const [n] = await notif('document_expiry', doc.id);
    expect(n.requiredPermission).toBe('financials:view');
    expect(n.linkHref).toBe(`/properties/${propertyId}`);
    expect(JSON.stringify(n)).not.toMatch(/storage|org\//i);
  });

  it('is organization-isolated', async () => {
    const { generateDocumentExpiryNotifications } = await import('@/services/notification-service');
    expect(await generateDocumentExpiryNotifications(FOREIGN_ORG)).toBe(0);
  });
});

describe('Warranty expiry generator', () => {
  it('notifies approaching/expired warranties, ignores out-of-window and decommissioned assets', async () => {
    const { generateWarrantyExpiryNotifications } = await import('@/services/notification-service');
    await setWarranty(assetIds[0], isoInDays(20));
    await setWarranty(assetIds[1], isoInDays(-3));
    await setWarranty(assetIds[2], isoInDays(300));
    await setWarranty(assetIds[3], isoInDays(10), 'decommissioned');
    await generateWarrantyExpiryNotifications(admin.organizationId);
    expect((await notif('warranty_expiry', assetIds[0]))[0]?.severity).toBe('warning');
    expect((await notif('warranty_expiry', assetIds[1]))[0]?.severity).toBe('error');
    expect(await notif('warranty_expiry', assetIds[2])).toHaveLength(0);
    expect(await notif('warranty_expiry', assetIds[3])).toHaveLength(0);
  });

  it('is idempotent and organization-isolated', async () => {
    const { generateWarrantyExpiryNotifications } = await import('@/services/notification-service');
    await generateWarrantyExpiryNotifications(admin.organizationId);
    expect(await notif('warranty_expiry', assetIds[0])).toHaveLength(1);
    expect(await generateWarrantyExpiryNotifications(FOREIGN_ORG)).toBe(0);
  });
});

describe('Compliance service', () => {
  function scope(over: Partial<{ permissions: string[]; allowedPropertyIds: string[] | null; organizationId: string }> = {}) {
    return {
      organizationId: over.organizationId ?? admin.organizationId,
      permissions: (over.permissions ?? admin.permissions) as SessionUser['permissions'],
      allowedPropertyIds: over.allowedPropertyIds ?? null,
    };
  }

  it('aggregates documents, warranties and contracts with correct KPIs', async () => {
    const { getComplianceItems } = await import('@/services/compliance-service');
    await createDoc('ComplianceDoc', isoInDays(12));
    await setWarranty(assetIds[0], isoInDays(20));
    const res = await getComplianceItems(scope());
    expect(res.kpis.documents).toBeGreaterThan(0);
    expect(res.kpis.warranties).toBeGreaterThan(0);
    expect(res.items.every((i) => ['document', 'warranty', 'contract'].includes(i.category))).toBe(true);
    // No storageKey/path leakage in any item.
    expect(res.items.every((i) => !('storageKey' in i))).toBe(true);
    expect(JSON.stringify(res.items)).not.toMatch(/org\/[0-9a-f]{8}/i);
  });

  it('applies the type and status filters', async () => {
    const { getComplianceItems } = await import('@/services/compliance-service');
    const docsOnly = await getComplianceItems(scope(), { type: 'document' });
    expect(docsOnly.items.every((i) => i.category === 'document')).toBe(true);
    await createDoc('ExpiredComplianceDoc', isoInDays(-2));
    const expired = await getComplianceItems(scope(), { filter: 'expired' });
    expect(expired.items.every((i) => i.status === 'expired')).toBe(true);
  });

  it('enforces RBAC, organization isolation, property scope and confidentiality', async () => {
    const { getComplianceItems } = await import('@/services/compliance-service');
    // RBAC: assets-only sees warranties, never documents/contracts.
    const assetsOnly = await getComplianceItems(scope({ permissions: ['assets:view'] }));
    expect(assetsOnly.items.every((i) => i.category === 'warranty')).toBe(true);
    // Org isolation.
    expect((await getComplianceItems(scope({ organizationId: FOREIGN_ORG }))).items).toHaveLength(0);
    // Property data-scope: a non-matching property yields no documents/warranties.
    const outScope = await getComplianceItems(scope({ allowedPropertyIds: [FOREIGN_ORG] }));
    expect(outScope.items.every((i) => i.category === 'contract')).toBe(true);
    // Confidential document requiring a permission the user lacks is excluded.
    await createDoc('HiddenComplianceDoc', isoInDays(9), { isConfidential: true, requiredPermission: 'financials:view' });
    const limited = await getComplianceItems(scope({ permissions: ['documents:view'] }));
    expect(limited.items.some((i) => i.title === 'HiddenComplianceDoc')).toBe(false);
  });

  it('bounds page size', async () => {
    const { getComplianceItems } = await import('@/services/compliance-service');
    const res = await getComplianceItems(scope(), { pageSize: 5 });
    expect(res.items.length).toBeLessThanOrEqual(5);
    expect(res.pageSize).toBe(5);
  });
});

describe('Compliance API route', () => {
  function req(qs = '') {
    return new NextRequest(new URL(`http://localhost/api/v1/compliance${qs ? `?${qs}` : ''}`));
  }
  it('rejects unauthenticated (401) and unauthorized (403)', async () => {
    const { GET } = await import('@/app/api/v1/compliance/route');
    getSessionMock.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
    getSessionMock.mockResolvedValue({ ...admin, permissions: [] });
    expect((await GET(req())).status).toBe(403);
  });

  it('returns items + kpis for an authorized request and validates parameters', async () => {
    const { GET } = await import('@/app/api/v1/compliance/route');
    getSessionMock.mockResolvedValue(admin);
    const ok = await GET(req('type=document&filter=expiring&page=1&limit=10'));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.data.kpis).toBeDefined();
    expect(Array.isArray(body.data.items)).toBe(true);
    expect((await GET(req('type=bogus'))).status).toBe(400);
    expect((await GET(req('window=9999'))).status).toBe(400);
  });
});

describe('Cron aggregate', () => {
  it('includes the new generators in generateAllNotifications summary without breaking existing ones', async () => {
    const { generateAllNotifications } = await import('@/services/notification-service');
    const summary = await generateAllNotifications({ id: admin.id, organizationId: admin.organizationId, fullName: admin.fullName });
    expect(typeof summary.generated.documentExpiry).toBe('number');
    expect(typeof summary.generated.warrantyExpiry).toBe('number');
    expect(typeof summary.generated.contractExpiry).toBe('number');
    expect(typeof summary.generated.slaBreach).toBe('number');
  });
});
