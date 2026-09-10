import { z } from 'zod';
import { requireApiPermission } from '@/lib/api/guard';
import { apiError, apiSuccess } from '@/lib/api/response';
import { AppError } from '@/lib/errors';
import { isUuid } from '@/lib/utils';
import { DOCUMENT_ENTITY_TYPES } from '@/lib/documents/constants';
import { createDocument, type DocumentActor } from '@/services/document-service';

export const dynamic = 'force-dynamic';

const uploadSchema = z.object({
  entityType: z.enum(DOCUMENT_ENTITY_TYPES),
  entityId: z.string().uuid('A valid record is required.'),
  categoryId: z.string().uuid().optional(),
  title: z.string().trim().min(1, 'Enter a title.').max(240),
  description: z.string().trim().max(5000).optional(),
  expiryDate: z.string().trim().max(10).optional(),
  requiredPermission: z.string().trim().max(96).optional(),
  isConfidential: z.boolean().optional(),
  supersedesId: z.string().uuid().optional(),
});

function str(v: FormDataEntryValue | null): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

/**
 * POST /api/v1/documents — authenticated multipart upload (create or, with
 * `supersedesId`, a new version). Enforces org scope, RBAC (documents:create;
 * versioning additionally requires documents:manage), the MIME allow-list and
 * the size limit. The service cleans up the stored object if the row fails.
 */
export async function POST(request: Request) {
  try {
    const principal = await requireApiPermission('documents:create');

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new AppError('VALIDATION', 'A file is required.', { status: 400 });

    const parsed = uploadSchema.safeParse({
      entityType: str(form.get('entityType')),
      entityId: str(form.get('entityId')),
      categoryId: str(form.get('categoryId')),
      title: str(form.get('title')),
      description: str(form.get('description')),
      expiryDate: str(form.get('expiryDate')),
      requiredPermission: str(form.get('requiredPermission')),
      isConfidential: str(form.get('isConfidential')) === 'true',
      supersedesId: str(form.get('supersedesId')),
    });
    if (!parsed.success) {
      throw new AppError('VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid upload.', { status: 400 });
    }

    // Replacing a document (versioning) is a manage-level action.
    if (parsed.data.supersedesId && !principal.permissions.includes('documents:manage')) {
      throw new AppError('FORBIDDEN', 'Managing document versions requires the documents:manage permission.');
    }
    if (parsed.data.supersedesId && !isUuid(parsed.data.supersedesId)) {
      throw new AppError('VALIDATION', 'Invalid version reference.', { status: 400 });
    }

    const actor: DocumentActor = {
      organizationId: principal.organizationId,
      userId: principal.userId,
      label: principal.label,
      permissions: principal.permissions,
      scopedPropertyIds: principal.scopedPropertyIds,
    };

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await createDocument(actor, parsed.data, {
      buffer,
      filename: file.name,
      mimeType: file.type,
      size: buffer.length,
    });

    return apiSuccess(result);
  } catch (error) {
    return apiError(error);
  }
}
