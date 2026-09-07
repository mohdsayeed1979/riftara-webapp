import type { NextRequest } from 'next/server';
import { requireApiPermission } from '@/lib/api/guard';
import { apiError } from '@/lib/api/response';
import { buildCsv, buildWorkbook, exportFilename, type ExportColumn } from '@/lib/export/excel';
import { listUnits, type UnitListFilters, type UnitListItem } from '@/services/unit-service';

export const dynamic = 'force-dynamic';

const COLUMNS: ExportColumn<UnitListItem>[] = [
  { header: 'Unit Number', key: 'unitNumber', value: (r) => r.unitNumber, width: 16 },
  { header: 'Code', key: 'code', value: (r) => r.code, width: 22 },
  { header: 'Property', key: 'property', value: (r) => r.propertyName, width: 30 },
  { header: 'Floor', key: 'floor', value: (r) => r.floorName ?? '', width: 14 },
  { header: 'Type', key: 'type', value: (r) => r.typeName, width: 20 },
  { header: 'Leasable Area (m²)', key: 'area', value: (r) => r.leasableArea, numFmt: '#,##0.00', width: 18 },
  { header: 'Annual Rent (SAR)', key: 'rent', value: (r) => r.askingRent, numFmt: '#,##0', width: 20 },
  { header: 'Rent / m² (SAR)', key: 'rentPerSqm', value: (r) => r.rentPerSqm, numFmt: '#,##0.00', width: 16 },
  { header: 'Availability', key: 'availability', value: (r) => r.availabilityClass, width: 16 },
  { header: 'Status', key: 'status', value: (r) => r.statusLabel, width: 18 },
  { header: 'Tenant', key: 'tenant', value: (r) => r.tenantName ?? '', width: 26 },
];

/** GET /api/v1/units/export?format=xlsx|csv */
export async function GET(request: NextRequest) {
  try {
    const principal = await requireApiPermission('units:export');
    const params = request.nextUrl.searchParams;
    const format = params.get('format') === 'csv' ? 'csv' : 'xlsx';

    const filters: UnitListFilters = {
      organizationId: principal.organizationId,
      allowedPropertyIds: principal.scopedPropertyIds.length ? principal.scopedPropertyIds : null,
      search: params.get('search') ?? undefined,
      propertyId: params.get('propertyId') ?? undefined,
      unitTypeId: params.get('typeId') ?? undefined,
      statusKey: params.get('status') ?? undefined,
      availability: params.get('availability') ?? undefined,
      page: 1,
      pageSize: 10_000,
    };

    const { items } = await listUnits(filters);

    if (format === 'csv') {
      return new Response(buildCsv(items, COLUMNS), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${exportFilename('units', 'csv')}"`,
        },
      });
    }

    const buffer = await buildWorkbook(items, COLUMNS, {
      title: 'Unit Inventory',
      sheetName: 'Units',
      generatedBy: principal.label,
    });

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${exportFilename('units', 'xlsx')}"`,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
