'use server';

import { z } from 'zod';
import { requirePermission } from '@/lib/auth/guard';
import { actionFailure, actionSuccess, type ActionResult } from '@/lib/errors';
import { isUuid } from '@/lib/utils';
import {
  getDocumentVersions,
  softDeleteDocument,
  updateDocumentMetadata,
  type DocumentActor,
  type DocumentVersionItem,
} from '@/services/document-service';
import type { SessionUser } from '@/lib/auth/session';

function toActor(user: SessionUser): DocumentActor {
  return {
    organizationId: user.organizationId,
    userId: user.id,
    label: user.fullName,
    permissions: user.permissions,
    scopedPropertyIds: user.scopedPropertyIds,
  };
}

export async function getDocumentVersionsAction(
  documentId: string,
): Promise<ActionResult<DocumentVersionItem[]>> {
  try {
    if (!isUuid(documentId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Document not found.' } };
    const user = await requirePermission('documents:view');
    const versions = await getDocumentVersions(toActor(user), documentId);
    return actionSuccess(versions);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function deleteDocumentAction(documentId: string): Promise<ActionResult<{ id: string }>> {
  try {
    if (!isUuid(documentId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Document not found.' } };
    const user = await requirePermission('documents:delete');
    const result = await softDeleteDocument(toActor(user), documentId);
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

const metadataSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  expiryDate: z.string().trim().max(10).nullable().optional(),
  isConfidential: z.boolean().optional(),
});

export async function updateDocumentMetadataAction(
  documentId: string,
  input: z.infer<typeof metadataSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    if (!isUuid(documentId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Document not found.' } };
    const user = await requirePermission('documents:manage');
    const parsed = metadataSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: 'VALIDATION', message: 'Please correct the highlighted fields.' } };
    const result = await updateDocumentMetadata(toActor(user), documentId, parsed.data);
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}
