import type { NextRequest } from 'next/server';
import { requireApiPermission } from '@/lib/api/guard';
import { apiError } from '@/lib/api/response';
import { buildCsv, buildWorkbook, exportFilename, type ExportColumn } from '@/lib/export/excel';
import { listInvoices, type OverdueInvoiceRow } from '@/services/collection-service';

export const dynamic = 'force-dynamic';

const COLUMNS: ExportColumn<OverdueInvoiceRow>[] = [
  { header: 'Invoice #', key: 'invoiceNumber', value: (r) => r.invoiceNumber, width: 18 },
  { header: 'Tenant', key: 'tenant', value: (r) => r.tenantName, width: 28 },
  { header: 'Property', key: 'property', value: (r) => r.propertyName, width: 28 },
  { header: 'Unit', key: 'unit', value: (r) => r.unitNumber, width: 12 },
  { header: 'Invoice Date', key: 'invoiceDate', value: (r) => r.invoiceDate, width: 14 },
  { header: 'Due Date', key: 'dueDate', value: (r) => r.dueDate, width: 14 },
  { header: 'Total (SAR)', key: 'total', value: (r) => r.totalAmount, numFmt: '#,##0.00', width: 16 },
  { header: 'Paid (SAR)', key: 'paid', value: (r) => r.paidAmount, numFmt: '#,##0.00', width: 16 },
  { header: 'Outstanding (SAR)', key: 'balance', value: (r) => r.balance, numFmt: '#,##0.00', width: 18 },
  { header: 'Days Overdue', key: 'days', value: (r) => r.daysOverdue, numFmt: '#,##0', width: 14 },
  { header: 'Status', key: 'status', value: (r) => r.status, width: 16 },
];

/** GET /api/v1/collections/export?format=xlsx|csv */
export async function GET(request: NextRequest) {
  try {
    const principal = await requireApiPermission('collections:export');
    const params = request.nextUrl.searchParams;
    const format = params.get('format') === 'csv' ? 'csv' : 'xlsx';

    const { items } = await listInvoices({
      organizationId: principal.organizationId,
      allowedPropertyIds: principal.scopedPropertyIds.length ? principal.scopedPropertyIds : null,
      propertyId: params.get('propertyId') ?? undefined,
      status: params.get('status') ?? undefined,
      page: 1,
      pageSize: 10_000,
    });

    if (format === 'csv') {
      return new Response(buildCsv(items, COLUMNS), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${exportFilename('collections', 'csv')}"`,
        },
      });
    }

    const buffer = await buildWorkbook(items, COLUMNS, {
      title: 'Collections — Open Receivables',
      sheetName: 'Receivables',
      generatedBy: principal.label,
    });

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${exportFilename('collections', 'xlsx')}"`,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
