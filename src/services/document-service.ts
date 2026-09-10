import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  buildings,
  contracts,
  customers,
  documentCategories,
  documents,
  maintenanceAssets,
  properties,
  tenants,
  units,
  users,
} from '@/db/schema';
import type { DbExecutor } from '@/db/types';
import { env } from '@/config/env';
import { recordAudit } from '@/lib/audit';
import { conflict, forbidden, notFound, validationError } from '@/lib/errors';
import { getStorage } from '@/lib/storage';
import { sanitizeFilename, validateUploadType, type DocumentEntityType } from '@/lib/documents/constants';
import type { PermissionKey } from '@/lib/permissions/catalog';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Document management service (Phase 11A). Organization-scoped, RBAC- and
 * data-scope-aware, audited. Files are stored through the storage abstraction
 * (never the filesystem directly); the DB row is the source of truth.
 */

/** The actor context every mutation/read needs (works for a session or API key). */
export interface DocumentActor {
  organizationId: string;
  userId: string | null;
  label: string;
  permissions: PermissionKey[];
  scopedPropertyIds: string[];
}

const maxUploadBytes = () => env.STORAGE_MAX_UPLOAD_MB * 1024 * 1024;

/** Builds the document actor context from a session user. */
export function documentActorFromUser(user: SessionUser): DocumentActor {
  return {
    organizationId: user.organizationId,
    userId: user.id,
    label: user.fullName,
    permissions: user.permissions,
    scopedPropertyIds: user.scopedPropertyIds,
  };
}

/** Loads everything the DocumentsPanel needs for an entity (list + categories). */
export async function getEntityDocuments(
  user: SessionUser,
  entityType: DocumentEntityType,
  entityId: string,
): Promise<{ documents: DocumentListItem[]; categories: Array<{ id: string; name: string; requiresExpiry: boolean }> }> {
  const actor = documentActorFromUser(user);
  const [documents, categories] = await Promise.all([
    listDocumentsByEntity(actor, entityType, entityId),
    getDocumentCategoriesForEntity(user.organizationId, entityType),
  ]);
  return { documents, categories };
}

/**
 * Resolves an entity to its owning property (null for org-level entities), or
 * null when the entity does not exist in the actor's organization. This is the
 * single place that maps a document's polymorphic entity onto a concrete table.
 */
async function resolveEntity(
  db: DbExecutor,
  organizationId: string,
  entityType: DocumentEntityType,
  entityId: string,
): Promise<{ propertyId: string | null } | null> {
  switch (entityType) {
    case 'property': {
      const [r] = await db.select({ id: properties.id }).from(properties).where(and(eq(properties.id, entityId), eq(properties.organizationId, organizationId), isNull(properties.deletedAt))).limit(1);
      return r ? { propertyId: r.id } : null;
    }
    case 'building': {
      const [r] = await db.select({ propertyId: buildings.propertyId }).from(buildings).where(and(eq(buildings.id, entityId), eq(buildings.organizationId, organizationId), isNull(buildings.deletedAt))).limit(1);
      return r ? { propertyId: r.propertyId } : null;
    }
    case 'unit': {
      const [r] = await db.select({ propertyId: units.propertyId }).from(units).where(and(eq(units.id, entityId), eq(units.organizationId, organizationId), isNull(units.deletedAt))).limit(1);
      return r ? { propertyId: r.propertyId } : null;
    }
    case 'contract': {
      const [r] = await db.select({ propertyId: contracts.propertyId }).from(contracts).where(and(eq(contracts.id, entityId), eq(contracts.organizationId, organizationId), isNull(contracts.deletedAt))).limit(1);
      return r ? { propertyId: r.propertyId } : null;
    }
    case 'asset': {
      const [r] = await db.select({ propertyId: maintenanceAssets.propertyId }).from(maintenanceAssets).where(and(eq(maintenanceAssets.id, entityId), eq(maintenanceAssets.organizationId, organizationId), isNull(maintenanceAssets.deletedAt))).limit(1);
      return r ? { propertyId: r.propertyId } : null;
    }
    case 'customer': {
      const [r] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, entityId), eq(customers.organizationId, organizationId), isNull(customers.deletedAt))).limit(1);
      return r ? { propertyId: null } : null;
    }
    case 'tenant': {
      const [r] = await db.select({ id: tenants.id }).from(tenants).where(and(eq(tenants.id, entityId), eq(tenants.organizationId, organizationId), isNull(tenants.deletedAt))).limit(1);
      return r ? { propertyId: null } : null;
    }
    default:
      return null;
  }
}

/** Verifies the entity exists in the org and is within the actor's data scope. */
async function assertEntityAccessible(
  db: DbExecutor,
  actor: DocumentActor,
  entityType: DocumentEntityType,
  entityId: string,
): Promise<void> {
  const resolved = await resolveEntity(db, actor.organizationId, entityType, entityId);
  if (!resolved) throw notFound('The referenced record', entityId);
  if (actor.scopedPropertyIds.length && resolved.propertyId && !actor.scopedPropertyIds.includes(resolved.propertyId)) {
    throw forbidden('You do not have access to this record.');
  }
}

/** Loads a category and enforces applicability + expiry rules for an entity type. */
async function validateCategory(
  db: DbExecutor,
  organizationId: string,
  categoryId: string,
  entityType: DocumentEntityType,
  expiryDate: string | null | undefined,
): Promise<void> {
  const [category] = await db
    .select({ id: documentCategories.id, appliesTo: documentCategories.appliesTo, requiresExpiry: documentCategories.requiresExpiry })
    .from(documentCategories)
    .where(and(eq(documentCategories.id, categoryId), eq(documentCategories.organizationId, organizationId)))
    .limit(1);
  if (!category) throw validationError('The selected category is not valid for this organization.');
  if (category.appliesTo.length && !category.appliesTo.includes(entityType)) {
    throw validationError('The selected category does not apply to this record type.');
  }
  if (category.requiresExpiry && !expiryDate) {
    throw validationError('An expiry date is required for this document category.');
  }
}

export interface CreateDocumentInput {
  entityType: DocumentEntityType;
  entityId: string;
  categoryId?: string | null;
  title: string;
  description?: string | null;
  expiryDate?: string | null;
  requiredPermission?: string | null;
  isConfidential?: boolean;
  /** When set, this upload replaces (versions) the given current document. */
  supersedesId?: string | null;
}

export interface UploadedFile {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  size: number;
}

/**
 * Creates a new document, or a new VERSION when `supersedesId` is provided. The
 * storage object is written first; if the database transaction then fails, the
 * newly written object is cleaned up so no orphan file remains.
 */
export async function createDocument(
  actor: DocumentActor,
  input: CreateDocumentInput,
  file: UploadedFile,
): Promise<{ id: string; version: number }> {
  const db = await getDb();

  // --- Validate the upload itself -----------------------------------------
  if (file.size <= 0) throw validationError('The uploaded file is empty.');
  if (file.size > maxUploadBytes()) {
    throw validationError(`The file exceeds the ${env.STORAGE_MAX_UPLOAD_MB} MB upload limit.`);
  }
  const typeCheck = validateUploadType(file.mimeType, file.filename);
  if (!typeCheck.ok) throw validationError(typeCheck.reason);

  // --- Validate the entity, scope and category ----------------------------
  await assertEntityAccessible(db, actor, input.entityType, input.entityId);
  if (input.categoryId) {
    await validateCategory(db, actor.organizationId, input.categoryId, input.entityType, input.expiryDate ?? null);
  }

  // --- Resolve the version chain ------------------------------------------
  let previous:
    | { id: string; version: number; categoryId: string | null; expiryDate: string | null; requiredPermission: string | null; isConfidential: boolean }
    | null = null;
  if (input.supersedesId) {
    const [row] = await db
      .select({
        id: documents.id,
        version: documents.version,
        entityType: documents.entityType,
        entityId: documents.entityId,
        isCurrentVersion: documents.isCurrentVersion,
        categoryId: documents.categoryId,
        expiryDate: documents.expiryDate,
        requiredPermission: documents.requiredPermission,
        isConfidential: documents.isConfidential,
      })
      .from(documents)
      .where(and(eq(documents.id, input.supersedesId), eq(documents.organizationId, actor.organizationId), isNull(documents.deletedAt)))
      .limit(1);
    if (!row) throw notFound('Document', input.supersedesId);
    if (row.entityType !== input.entityType || row.entityId !== input.entityId) {
      throw validationError('A new version must be attached to the same record as the document it replaces.');
    }
    if (!row.isCurrentVersion) throw conflict('Only the current version of a document can be replaced.');
    previous = { id: row.id, version: row.version, categoryId: row.categoryId, expiryDate: row.expiryDate, requiredPermission: row.requiredPermission, isConfidential: row.isConfidential };
  }

  // A new version inherits metadata from the previous one unless overridden.
  const categoryId = input.categoryId !== undefined ? input.categoryId : (previous?.categoryId ?? null);
  const expiryDate = input.expiryDate !== undefined ? input.expiryDate : (previous?.expiryDate ?? null);
  const requiredPermission = input.requiredPermission !== undefined ? input.requiredPermission : (previous?.requiredPermission ?? null);
  const isConfidential = input.isConfidential !== undefined ? input.isConfidential : (previous?.isConfidential ?? false);
  const version = previous ? previous.version + 1 : 1;
  const fileName = sanitizeFilename(file.filename);
  const storageKey = `org/${actor.organizationId}/${input.entityType}/${input.entityId}/${randomUUID()}`;

  // Write the object first, then commit the row; clean up on failure.
  await getStorage().put({ key: storageKey, data: file.buffer, contentType: file.mimeType });

  try {
    return await db.transaction(async (tx) => {
      if (previous) {
        await tx.update(documents).set({ isCurrentVersion: false, updatedAt: new Date() }).where(eq(documents.id, previous.id));
      }
      const [created] = await tx
        .insert(documents)
        .values({
          organizationId: actor.organizationId,
          categoryId,
          entityType: input.entityType,
          entityId: input.entityId,
          title: input.title,
          description: input.description ?? null,
          fileName,
          storageKey,
          mimeType: file.mimeType,
          sizeBytes: file.size,
          version,
          supersedesId: previous?.id ?? null,
          isCurrentVersion: true,
          expiryDate,
          requiredPermission,
          isConfidential,
          uploadedByUserId: actor.userId,
        })
        .returning({ id: documents.id });

      await recordAudit(tx, {
        organizationId: actor.organizationId,
        action: previous ? 'update' : 'create',
        entityType: 'document',
        entityId: created.id,
        entityLabel: input.title,
        reason: previous ? 'document_version_created' : undefined,
        newValue: { entityType: input.entityType, entityId: input.entityId, fileName, version, isConfidential },
        actor: actor.userId ? { id: actor.userId, fullName: actor.label } : null,
      });

      return { id: created.id, version };
    });
  } catch (error) {
    // The row was not committed — remove the orphaned object (best effort).
    await getStorage().delete(storageKey).catch(() => undefined);
    throw error;
  }
}

export interface DocumentListItem {
  id: string;
  title: string;
  fileName: string;
  categoryName: string | null;
  version: number;
  mimeType: string;
  sizeBytes: number;
  isConfidential: boolean;
  expiryDate: string | null;
  uploadedByName: string | null;
  createdAt: Date;
  hasHistory: boolean;
}

/** Lists the current-version documents attached to an entity (scope-enforced). */
export async function listDocumentsByEntity(
  actor: DocumentActor,
  entityType: DocumentEntityType,
  entityId: string,
): Promise<DocumentListItem[]> {
  const db = await getDb();
  await assertEntityAccessible(db, actor, entityType, entityId);

  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      fileName: documents.fileName,
      categoryName: documentCategories.nameEn,
      version: documents.version,
      mimeType: documents.mimeType,
      sizeBytes: documents.sizeBytes,
      isConfidential: documents.isConfidential,
      expiryDate: documents.expiryDate,
      uploadedByName: users.fullName,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .leftJoin(documentCategories, eq(documentCategories.id, documents.categoryId))
    .leftJoin(users, eq(users.id, documents.uploadedByUserId))
    .where(
      and(
        eq(documents.organizationId, actor.organizationId),
        eq(documents.entityType, entityType),
        eq(documents.entityId, entityId),
        eq(documents.isCurrentVersion, true),
        isNull(documents.deletedAt),
      ),
    )
    .orderBy(desc(documents.createdAt));

  return rows.map((r) => ({ ...r, hasHistory: r.version > 1 }));
}

export interface DocumentVersionItem {
  id: string;
  version: number;
  fileName: string;
  sizeBytes: number;
  isCurrentVersion: boolean;
  uploadedByName: string | null;
  createdAt: Date;
}

/** Returns the full version lineage for a document (newest first). */
export async function getDocumentVersions(actor: DocumentActor, documentId: string): Promise<DocumentVersionItem[]> {
  const db = await getDb();
  const [head] = await db
    .select({ id: documents.id, entityType: documents.entityType, entityId: documents.entityId })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.organizationId, actor.organizationId), isNull(documents.deletedAt)))
    .limit(1);
  if (!head) throw notFound('Document', documentId);
  await assertEntityAccessible(db, actor, head.entityType as DocumentEntityType, head.entityId);

  const all = await db
    .select({ id: documents.id, version: documents.version, fileName: documents.fileName, sizeBytes: documents.sizeBytes, isCurrentVersion: documents.isCurrentVersion, supersedesId: documents.supersedesId, uploadedByName: users.fullName, createdAt: documents.createdAt })
    .from(documents)
    .leftJoin(users, eq(users.id, documents.uploadedByUserId))
    .where(and(eq(documents.organizationId, actor.organizationId), eq(documents.entityType, head.entityType), eq(documents.entityId, head.entityId), isNull(documents.deletedAt)));

  // Walk the supersedes chain that contains `documentId`.
  const byId = new Map(all.map((r) => [r.id, r]));
  const lineage = new Set<string>([documentId]);
  let cursor = byId.get(documentId);
  while (cursor?.supersedesId && byId.has(cursor.supersedesId)) {
    lineage.add(cursor.supersedesId);
    cursor = byId.get(cursor.supersedesId);
  }
  // Include newer versions that supersede members of the lineage.
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of all) {
      if (r.supersedesId && lineage.has(r.supersedesId) && !lineage.has(r.id)) {
        lineage.add(r.id);
        grew = true;
      }
    }
  }

  return all
    .filter((r) => lineage.has(r.id))
    .sort((a, b) => b.version - a.version)
    .map(({ supersedesId: _s, ...rest }) => rest);
}

/** Loads a document and its bytes for download, enforcing every access rule. */
export async function getDocumentForDownload(
  actor: DocumentActor,
  documentId: string,
): Promise<{ fileName: string; mimeType: string; buffer: Buffer }> {
  const db = await getDb();
  const [doc] = await db
    .select({
      id: documents.id,
      entityType: documents.entityType,
      entityId: documents.entityId,
      fileName: documents.fileName,
      mimeType: documents.mimeType,
      storageKey: documents.storageKey,
      requiredPermission: documents.requiredPermission,
      isConfidential: documents.isConfidential,
    })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.organizationId, actor.organizationId), isNull(documents.deletedAt)))
    .limit(1);
  if (!doc) throw notFound('Document', documentId);

  await assertEntityAccessible(db, actor, doc.entityType as DocumentEntityType, doc.entityId);

  if (doc.requiredPermission && !actor.permissions.includes(doc.requiredPermission as PermissionKey)) {
    throw forbidden('You do not have permission to access this document.');
  }
  // Confidential documents require the base view permission in addition to any
  // specific requiredPermission (enforced above).
  if (doc.isConfidential && !actor.permissions.includes('documents:view')) {
    throw forbidden('You do not have permission to access this document.');
  }

  const buffer = await getStorage().get(doc.storageKey);

  await recordAudit(db, {
    organizationId: actor.organizationId,
    action: 'export',
    entityType: 'document',
    entityId: doc.id,
    entityLabel: doc.fileName,
    reason: 'document_download',
    actor: actor.userId ? { id: actor.userId, fullName: actor.label } : null,
  }).catch(() => undefined);

  return { fileName: doc.fileName, mimeType: doc.mimeType, buffer };
}

/** Soft-deletes a document (row and file are preserved; retention is deferred). */
export async function softDeleteDocument(actor: DocumentActor, documentId: string): Promise<{ id: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [doc] = await tx
      .select({ id: documents.id, entityType: documents.entityType, entityId: documents.entityId, title: documents.title })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.organizationId, actor.organizationId), isNull(documents.deletedAt)))
      .limit(1);
    if (!doc) throw notFound('Document', documentId);
    await assertEntityAccessible(tx, actor, doc.entityType as DocumentEntityType, doc.entityId);

    await tx.update(documents).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(documents.id, documentId));
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'soft_delete',
      entityType: 'document',
      entityId: documentId,
      entityLabel: doc.title,
      actor: actor.userId ? { id: actor.userId, fullName: actor.label } : null,
    });
    return { id: documentId };
  });
}

export interface UpdateDocumentMetadataInput {
  title?: string;
  description?: string | null;
  categoryId?: string | null;
  expiryDate?: string | null;
  requiredPermission?: string | null;
  isConfidential?: boolean;
}

/** Updates document metadata (documents:manage). Does not touch the file. */
export async function updateDocumentMetadata(
  actor: DocumentActor,
  documentId: string,
  input: UpdateDocumentMetadataInput,
): Promise<{ id: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [doc] = await tx
      .select({ id: documents.id, entityType: documents.entityType, entityId: documents.entityId })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.organizationId, actor.organizationId), isNull(documents.deletedAt)))
      .limit(1);
    if (!doc) throw notFound('Document', documentId);
    await assertEntityAccessible(tx, actor, doc.entityType as DocumentEntityType, doc.entityId);

    if (input.categoryId) {
      await validateCategory(tx, actor.organizationId, input.categoryId, doc.entityType as DocumentEntityType, input.expiryDate ?? null);
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
    if (input.expiryDate !== undefined) patch.expiryDate = input.expiryDate;
    if (input.requiredPermission !== undefined) patch.requiredPermission = input.requiredPermission;
    if (input.isConfidential !== undefined) patch.isConfidential = input.isConfidential;

    await tx.update(documents).set(patch).where(eq(documents.id, documentId));
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'document',
      entityId: documentId,
      reason: 'document_metadata_updated',
      newValue: patch,
      actor: actor.userId ? { id: actor.userId, fullName: actor.label } : null,
    });
    return { id: documentId };
  });
}

/** Reference data for the upload form: categories applicable to an entity type. */
export async function getDocumentCategoriesForEntity(
  organizationId: string,
  entityType: DocumentEntityType,
): Promise<Array<{ id: string; name: string; requiresExpiry: boolean }>> {
  const db = await getDb();
  const rows = await db
    .select({ id: documentCategories.id, name: documentCategories.nameEn, appliesTo: documentCategories.appliesTo, requiresExpiry: documentCategories.requiresExpiry })
    .from(documentCategories)
    .where(eq(documentCategories.organizationId, organizationId))
    .orderBy(documentCategories.nameEn);
  return rows
    .filter((r) => r.appliesTo.length === 0 || r.appliesTo.includes(entityType))
    .map((r) => ({ id: r.id, name: r.name, requiresExpiry: r.requiresExpiry }));
}
