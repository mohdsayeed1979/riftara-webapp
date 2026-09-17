import { requireApiPermission } from '@/lib/api/guard';
import { apiError, apiSuccess } from '@/lib/api/response';
import { AppError } from '@/lib/errors';
import { validateUploadType } from '@/lib/documents/constants';
import { findSheet, parseUploadedWorkbook } from '@/lib/import/workbook';
import { buildPreview, type ImportMode } from '@/services/import-service';
import { env } from '@/config/env';

export const dynamic = 'force-dynamic';

const MODES: ImportMode[] = ['create_only', 'update_existing', 'create_and_update'];

/**
 * POST /api/v1/import/properties/validate — multipart upload (`file`, optional
 * `mode`). Accepts a Properties-only workbook/CSV, or a combined workbook that
 * also has a "Units" sheet (Phase 20A §5). Read-only: validates every row and
 * returns a preview; nothing is written to the database.
 */
export async function POST(request: Request) {
  try {
    const principal = await requireApiPermission('properties:manage');

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new AppError('VALIDATION', 'A file is required.', { status: 400 });

    const check = validateUploadType(file.type, file.name);
    if (!check.ok) throw new AppError('VALIDATION', check.reason, { status: 400 });
    if (file.size > env.STORAGE_MAX_UPLOAD_MB * 1024 * 1024) {
      throw new AppError('VALIDATION', `The file exceeds the ${env.STORAGE_MAX_UPLOAD_MB} MB upload limit.`, { status: 400 });
    }

    const modeRaw = String(form.get('mode') ?? 'create_only');
    const mode = (MODES as string[]).includes(modeRaw) ? (modeRaw as ImportMode) : 'create_only';

    const buffer = Buffer.from(await file.arrayBuffer());
    const sheets = await parseUploadedWorkbook(buffer, file.name);
    const propertySheet = findSheet(sheets, 'Properties') ?? sheets[0] ?? null;
    const unitSheet = findSheet(sheets, 'Units');

    const preview = await buildPreview(principal.organizationId, {
      propertyRows: propertySheet?.rows ?? [],
      unitRows: unitSheet?.rows ?? [],
      mode,
    });

    return apiSuccess(preview);
  } catch (error) {
    return apiError(error);
  }
}
