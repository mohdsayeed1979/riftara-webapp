import { requireApiPermission } from '@/lib/api/guard';
import { apiError, apiSuccess } from '@/lib/api/response';
import { AppError } from '@/lib/errors';
import { validateUploadType } from '@/lib/documents/constants';
import { findSheet, parseUploadedWorkbook } from '@/lib/import/workbook';
import { loadSessionUser } from '@/lib/auth/session';
import { executeImport, type ImportMode } from '@/services/import-service';
import { env } from '@/config/env';

export const dynamic = 'force-dynamic';

const MODES: ImportMode[] = ['create_only', 'update_existing', 'create_and_update'];

/**
 * POST /api/v1/import/properties/execute — multipart upload (`file`, optional
 * `mode`). Re-validates the file server-side (never trusts a client-held
 * preview) and, only if every row is valid, imports Properties (and Units, if
 * the workbook has a "Units" sheet) inside one database transaction.
 */
export async function POST(request: Request) {
  try {
    const principal = await requireApiPermission('properties:manage');
    if (!principal.userId) throw new AppError('FORBIDDEN', 'A signed-in user is required to run an import.');
    const actor = await loadSessionUser(principal.userId);
    if (!actor) throw new AppError('FORBIDDEN', 'Session user not found.');

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
    const fileType = file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx';
    const sheets = await parseUploadedWorkbook(buffer, file.name);
    const propertySheet = findSheet(sheets, 'Properties') ?? sheets[0] ?? null;
    const unitSheet = findSheet(sheets, 'Units');

    const result = await executeImport(actor, {
      propertyRows: propertySheet?.rows ?? [],
      unitRows: unitSheet?.rows ?? [],
      mode,
      fileName: file.name,
      fileType,
      skipErrorRows: String(form.get('skipErrorRows')) === 'true',
    });

    return apiSuccess(result);
  } catch (error) {
    return apiError(error);
  }
}
