import type { NextRequest } from 'next/server';
import { authenticateRequest, enforceRateLimit } from '@/lib/api/guard';
import { apiError } from '@/lib/api/response';
import { AppError } from '@/lib/errors';
import { isUuid } from '@/lib/utils';
import { buildCsv, buildWorkbook, type ExportColumn } from '@/lib/export/excel';
import { getImportBatch, getImportBatchErrors } from '@/services/import-service';

export const dynamic = 'force-dynamic';

interface ErrorReportRow {
  rowNumber: number;
  propertyCode: string;
  unitCode: string;
  field: string;
  value: string;
  errorType: string;
  message: string;
}

const COLUMNS: ExportColumn<ErrorReportRow>[] = [
  { header: 'Row Number', key: 'rowNumber', value: (r) => r.rowNumber, width: 12 },
  { header: 'Property Code', key: 'propertyCode', value: (r) => r.propertyCode, width: 18 },
  { header: 'Unit Code', key: 'unitCode', value: (r) => r.unitCode, width: 20 },
  { header: 'Field', key: 'field', value: (r) => r.field, width: 18 },
  { header: 'Value', key: 'value', value: (r) => r.value, width: 20 },
  { header: 'Error Type', key: 'errorType', value: (r) => r.errorType, width: 18 },
  { header: 'Error Message', key: 'message', value: (r) => r.message, width: 60 },
];

/** GET /api/v1/import/history/[id]/errors?format=xlsx|csv — downloadable error report. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await authenticateRequest();
    if (!principal.permissions.includes('properties:manage') && !principal.permissions.includes('units:manage')) {
      throw new AppError('FORBIDDEN', 'Missing required permission: properties:manage or units:manage');
    }
    await enforceRateLimit(principal);

    const { id } = await params;
    if (!isUuid(id)) throw new AppError('NOT_FOUND', 'Import batch not found.');
    const batch = await getImportBatch(principal.organizationId, id);
    const errorRows = await getImportBatchErrors(principal.organizationId, id);

    const rows: ErrorReportRow[] = errorRows.map((e) => {
      const data = (e.rowData ?? {}) as { code?: string; unitCode?: string; value?: string };
      return {
        rowNumber: e.rowNumber,
        propertyCode: data.code ?? '',
        unitCode: data.unitCode ?? '',
        field: e.field ?? '',
        value: data.value ?? '',
        errorType: e.errorCode,
        message: e.message,
      };
    });

    const format = request.nextUrl.searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';
    if (format === 'csv') {
      return new Response(buildCsv(rows, COLUMNS), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="import-errors-${batch.id}.csv"` },
      });
    }
    const buffer = await buildWorkbook(rows, COLUMNS, { title: 'Import Error Report', sheetName: 'Errors', subtitle: `Batch: ${batch.fileName}` });
    return new Response(new Uint8Array(buffer), {
      headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="import-errors-${batch.id}.xlsx"` },
    });
  } catch (error) {
    return apiError(error);
  }
}
