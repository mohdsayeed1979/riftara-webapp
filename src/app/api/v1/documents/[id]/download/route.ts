import { requireApiPermission } from '@/lib/api/guard';
import { apiError } from '@/lib/api/response';
import { AppError } from '@/lib/errors';
import { isUuid } from '@/lib/utils';
import { getDocumentForDownload, type DocumentActor } from '@/services/document-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/documents/:id/download — authenticated, scope- and permission-
 * enforced streaming download. Never a public URL; the storage key and
 * filesystem path are never exposed. Soft-deleted documents are inaccessible.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireApiPermission('documents:view');
    const { id } = await context.params;
    if (!isUuid(id)) throw new AppError('NOT_FOUND', 'Document not found.', { status: 404 });

    const actor: DocumentActor = {
      organizationId: principal.organizationId,
      userId: principal.userId,
      label: principal.label,
      permissions: principal.permissions,
      scopedPropertyIds: principal.scopedPropertyIds,
    };

    const { fileName, mimeType, buffer } = await getDocumentForDownload(actor, id);
    // Encode the filename safely for the header (RFC 5987 for non-ASCII).
    const asciiName = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
