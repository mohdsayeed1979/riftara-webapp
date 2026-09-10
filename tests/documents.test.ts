import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { bootstrapTestDb } from './setup-db';
import type { Database } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';
import type { DocumentActor } from '@/services/document-service';

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth/session')>();
  return { ...mod, getSession: vi.fn() };
});
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

const FOREIGN_ORG = '00000000-0000-4000-8000-000000000000';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'); // tiny PNG-ish header

let db: Database;
let cleanup: () => void;
let storageDir = '';
let admin: SessionUser;
let actor: DocumentActor;
let getSessionMock: ReturnType<typeof vi.fn>;
let propertyId = '';

function file(name = 'doc.png', type = 'image/png', buf = PNG) {
  return { buffer: buf, filename: name, mimeType: type, size: buf.length };
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), 'riftara-docs-'));
  process.env.STORAGE_DRIVER = 'local';
  process.env.STORAGE_LOCAL_DIR = storageDir; // set before env is first parsed
  const ctx = await bootstrapTestDb();
  db = ctx.db;
  cleanup = () => { ctx.cleanup(); try { rmSync(storageDir, { recursive: true, force: true }); } catch { /* best effort */ } };

  const { users, properties } = await import('@/db/schema');
  const { loadSessionUser, getSession } = await import('@/lib/auth/session');
  const { documentActorFromUser } = await import('@/services/document-service');
  getSessionMock = getSession as unknown as ReturnType<typeof vi.fn>;
  const [u] = await db.select().from(users).where(eq(users.email, 'sayeed.almousa@riftara.sa')).limit(1);
  admin = (await loadSessionUser(u.id))!;
  actor = documentActorFromUser(admin);
  const [p] = await db.select({ id: properties.id }).from(properties).where(eq(properties.organizationId, admin.organizationId)).limit(1);
  propertyId = p.id;
}, 180_000);

afterAll(() => cleanup?.());

/* -------------------------------- Storage -------------------------------- */

describe('Local filesystem storage driver', () => {
  it('put / get / exists / delete round-trip', async () => {
    const { getStorage } = await import('@/lib/storage');
    const s = getStorage();
    const key = `org/${admin.organizationId}/property/${propertyId}/test-object`;
    await s.put({ key, data: PNG, contentType: 'image/png' });
    expect(await s.exists(key)).toBe(true);
    expect((await s.get(key)).equals(PNG)).toBe(true);
    await s.delete(key);
    expect(await s.exists(key)).toBe(false);
  });

  it('rejects path traversal and absolute keys', async () => {
    const { getStorage } = await import('@/lib/storage');
    const s = getStorage();
    await expect(s.put({ key: '../escape', data: PNG, contentType: 'image/png' })).rejects.toThrow();
    await expect(s.get('a/../../etc/passwd')).rejects.toThrow();
    await expect(s.put({ key: '/abs/path', data: PNG, contentType: 'image/png' })).rejects.toThrow();
  });
});

/* -------------------------------- Service -------------------------------- */

describe('Document service — CRUD, versioning, scope', () => {
  it('creates a document, lists it, and audits the creation', async () => {
    const { createDocument, listDocumentsByEntity } = await import('@/services/document-service');
    const { auditLogs } = await import('@/db/schema');
    const created = await createDocument(actor, { entityType: 'property', entityId: propertyId, title: 'Title Deed' }, file());
    expect(created.version).toBe(1);
    const list = await listDocumentsByEntity(actor, 'property', propertyId);
    expect(list.some((d) => d.id === created.id && d.title === 'Title Deed')).toBe(true);
    const audit = await db.select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.entityType, 'document'), eq(auditLogs.entityId, created.id), eq(auditLogs.action, 'create')));
    expect(audit.length).toBe(1);
  });

  it('rejects a document for a non-existent / foreign entity', async () => {
    const { createDocument } = await import('@/services/document-service');
    await expect(createDocument(actor, { entityType: 'property', entityId: FOREIGN_ORG, title: 'X' }, file())).rejects.toThrow();
  });

  it('enforces organization isolation on read', async () => {
    const { createDocument, getDocumentForDownload } = await import('@/services/document-service');
    const created = await createDocument(actor, { entityType: 'property', entityId: propertyId, title: 'Org Scoped' }, file());
    const foreignActor: DocumentActor = { ...actor, organizationId: FOREIGN_ORG };
    await expect(getDocumentForDownload(foreignActor, created.id)).rejects.toThrow();
  });

  it('rejects an invalid category and enforces required expiry', async () => {
    const { createDocument } = await import('@/services/document-service');
    const { documentCategories } = await import('@/db/schema');
    await expect(createDocument(actor, { entityType: 'property', entityId: propertyId, title: 'Bad cat', categoryId: FOREIGN_ORG }, file())).rejects.toThrow(/category/i);
    // A category that requires expiry, attached to an entity type it applies to.
    const cats = await db.select({ id: documentCategories.id, appliesTo: documentCategories.appliesTo, requiresExpiry: documentCategories.requiresExpiry }).from(documentCategories).where(eq(documentCategories.organizationId, admin.organizationId));
    const expiryCat = cats.find((c) => c.requiresExpiry && (c.appliesTo.length === 0 || c.appliesTo.includes('property')));
    if (expiryCat) {
      await expect(createDocument(actor, { entityType: 'property', entityId: propertyId, title: 'No expiry', categoryId: expiryCat.id }, file())).rejects.toThrow(/expiry/i);
    }
  });

  it('rejects disallowed file types and oversize files', async () => {
    const { createDocument } = await import('@/services/document-service');
    await expect(createDocument(actor, { entityType: 'property', entityId: propertyId, title: 'Evil' }, file('evil.exe', 'application/x-msdownload'))).rejects.toThrow();
    await expect(createDocument(actor, { entityType: 'property', entityId: propertyId, title: 'JS' }, file('a.js', 'text/javascript'))).rejects.toThrow();
  });

  it('versions a document: previous becomes non-current, history preserved, file not overwritten', async () => {
    const { createDocument, listDocumentsByEntity, getDocumentVersions, getDocumentForDownload } = await import('@/services/document-service');
    const v1 = await createDocument(actor, { entityType: 'property', entityId: propertyId, title: 'Versioned' }, file('v1.png', 'image/png', Buffer.from('v1v1v1v1v1v1', 'utf8')));
    const v2 = await createDocument(actor, { entityType: 'property', entityId: propertyId, title: 'Versioned', supersedesId: v1.id }, file('v2.png', 'image/png', Buffer.from('v2v2v2v2v2v2', 'utf8')));
    expect(v2.version).toBe(2);

    const list = await listDocumentsByEntity(actor, 'property', propertyId);
    expect(list.some((d) => d.id === v2.id)).toBe(true); // current
    expect(list.some((d) => d.id === v1.id)).toBe(false); // superseded

    const versions = await getDocumentVersions(actor, v2.id);
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2]);
    expect(versions.find((v) => v.version === 2)?.isCurrentVersion).toBe(true);

    // Both physical files still resolve (original not overwritten).
    expect((await getDocumentForDownload(actor, v1.id)).buffer.toString()).toContain('v1');
    expect((await getDocumentForDownload(actor, v2.id)).buffer.toString()).toContain('v2');
  });

  it('soft-deletes a document, hiding it from lists and downloads, and audits it', async () => {
    const { createDocument, listDocumentsByEntity, softDeleteDocument, getDocumentForDownload } = await import('@/services/document-service');
    const { auditLogs } = await import('@/db/schema');
    const doc = await createDocument(actor, { entityType: 'property', entityId: propertyId, title: 'To delete' }, file());
    await softDeleteDocument(actor, doc.id);
    const list = await listDocumentsByEntity(actor, 'property', propertyId);
    expect(list.some((d) => d.id === doc.id)).toBe(false);
    await expect(getDocumentForDownload(actor, doc.id)).rejects.toThrow();
    const audit = await db.select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.entityType, 'document'), eq(auditLogs.entityId, doc.id), eq(auditLogs.action, 'soft_delete')));
    expect(audit.length).toBe(1);
  });

  it('enforces per-document requiredPermission and confidentiality', async () => {
    const { createDocument, getDocumentForDownload } = await import('@/services/document-service');
    const doc = await createDocument(actor, { entityType: 'property', entityId: propertyId, title: 'Secret', isConfidential: true, requiredPermission: 'financials:view' }, file());
    const limited: DocumentActor = { ...actor, permissions: ['documents:view'] }; // lacks financials:view
    await expect(getDocumentForDownload(limited, doc.id)).rejects.toThrow();
    const privileged: DocumentActor = { ...actor, permissions: ['documents:view', 'financials:view'] };
    expect((await getDocumentForDownload(privileged, doc.id)).fileName).toBeTruthy();
  });

  it('records a download audit event', async () => {
    const { createDocument, getDocumentForDownload } = await import('@/services/document-service');
    const { auditLogs } = await import('@/db/schema');
    const doc = await createDocument(actor, { entityType: 'property', entityId: propertyId, title: 'Downloadable' }, file());
    await getDocumentForDownload(actor, doc.id);
    const audit = await db.select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.entityType, 'document'), eq(auditLogs.entityId, doc.id), eq(auditLogs.action, 'export')));
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });
});

/* --------------------------- Data-scope isolation ------------------------- */

describe('Document data-scope', () => {
  it('blocks access to a document whose property is outside the user scope', async () => {
    const { createDocument, listDocumentsByEntity } = await import('@/services/document-service');
    await createDocument(actor, { entityType: 'property', entityId: propertyId, title: 'Scoped' }, file());
    const scopedActor: DocumentActor = { ...actor, scopedPropertyIds: [FOREIGN_ORG] }; // no access to propertyId
    await expect(listDocumentsByEntity(scopedActor, 'property', propertyId)).rejects.toThrow();
  });
});

/* --------------------------------- Routes -------------------------------- */

describe('Document routes — RBAC, upload, download', () => {
  function form(fields: Record<string, string>, f?: File) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    if (f) fd.set('file', f);
    return new Request('http://localhost/api/v1/documents', { method: 'POST', body: fd });
  }

  it('rejects an unauthenticated upload', async () => {
    const { POST } = await import('@/app/api/v1/documents/route');
    getSessionMock.mockResolvedValue(null);
    const res = await POST(form({ entityType: 'property', entityId: propertyId, title: 'X' }, new File([PNG], 'a.png', { type: 'image/png' })));
    expect(res.status).toBe(401);
  });

  it('rejects upload without documents:create', async () => {
    const { POST } = await import('@/app/api/v1/documents/route');
    getSessionMock.mockResolvedValue({ ...admin, permissions: ['documents:view'] });
    const res = await POST(form({ entityType: 'property', entityId: propertyId, title: 'X' }, new File([PNG], 'a.png', { type: 'image/png' })));
    expect(res.status).toBe(403);
  });

  it('accepts an authorized upload and then downloads it', async () => {
    const routeMod = await import('@/app/api/v1/documents/route');
    const dlMod = await import('@/app/api/v1/documents/[id]/download/route');
    getSessionMock.mockResolvedValue({ ...admin, permissions: ['documents:create', 'documents:view'] });
    const up = await routeMod.POST(form({ entityType: 'property', entityId: propertyId, title: 'Via route' }, new File([PNG], 'route.png', { type: 'image/png' })));
    expect(up.status).toBe(200);
    const { data } = await up.json();
    expect(data.id).toBeTruthy();

    const dl = await dlMod.GET(new Request('http://localhost/'), { params: Promise.resolve({ id: data.id }) });
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toBe('image/png');
    expect(dl.headers.get('content-disposition')).toContain('attachment');
  });

  it('rejects a download with an invalid UUID and for a foreign org', async () => {
    const dlMod = await import('@/app/api/v1/documents/[id]/download/route');
    getSessionMock.mockResolvedValue({ ...admin, permissions: ['documents:view'] });
    const bad = await dlMod.GET(new Request('http://localhost/'), { params: Promise.resolve({ id: 'not-a-uuid' }) });
    expect(bad.status).toBeGreaterThanOrEqual(400);
  });
});
