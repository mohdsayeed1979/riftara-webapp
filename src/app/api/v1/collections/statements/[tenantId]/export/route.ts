import type { NextRequest } from 'next/server';
import { requireApiPermission } from '@/lib/api/guard';
import { apiError } from '@/lib/api/response';
import { buildCsv, buildWorkbook, exportFilename, type ExportColumn } from '@/lib/export/excel';
import { notFound } from '@/lib/errors';
import { isUuid } from '@/lib/utils';
import { getTenantStatementRows, type StatementRow } from '@/services/collection-service';

export const dynamic = 'force-dynamic';

const COLUMNS: ExportColumn<StatementRow>[] = [
  { header: 'Invoice #', key: 'invoiceNumber', value: (r) => r.invoiceNumber, width: 18 },
  { header: 'Invoice Date', key: 'invoiceDate', value: (r) => r.invoiceDate, width: 14 },
  { header: 'Due Date', key: 'dueDate', value: (r) => r.dueDate, width: 14 },
  { header: 'Charges (SAR)', key: 'charges', value: (r) => r.charges, numFmt: '#,##0.00', width: 16 },
  { header: 'Paid (SAR)', key: 'paid', value: (r) => r.paid, numFmt: '#,##0.00', width: 16 },
  { header: 'Outstanding (SAR)', key: 'outstanding', value: (r) => r.outstanding, numFmt: '#,##0.00', width: 18 },
  { header: 'Status', key: 'status', value: (r) => r.status, width: 16 },
];

/** GET /api/v1/collections/statements/:tenantId/export?format=csv|xlsx */
export async function GET(request: NextRequest, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const principal = await requireApiPermission('collections:export');
    const { tenantId } = await context.params;
    if (!isUuid(tenantId)) throw notFound('Tenant', tenantId);

    const { tenantName, rows } = await getTenantStatementRows(principal.organizationId, tenantId);
    const format = request.nextUrl.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv';

    if (format === 'csv') {
      return new Response(buildCsv(rows, COLUMNS), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${exportFilename('statement', 'csv')}"`,
        },
      });
    }

    const buffer = await buildWorkbook(rows, COLUMNS, {
      title: `Statement of Account — ${tenantName}`,
      sheetName: 'Statement',
      generatedBy: principal.label,
    });
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${exportFilename('statement', 'xlsx')}"`,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
