import type { NextRequest } from 'next/server';
import { requireApiPermission } from '@/lib/api/guard';
import { apiError } from '@/lib/api/response';
import { buildCsv, buildWorkbook, exportFilename, type ExportColumn } from '@/lib/export/excel';
import { recordAudit } from '@/lib/audit';
import { getDb } from '@/db/client';
import { loadSessionUser } from '@/lib/auth/session';
import {
  listProperties,
  type PropertyListFilters,
  type PropertyListItem,
} from '@/services/property-service';

export const dynamic = 'force-dynamic';

const COLUMNS: ExportColumn<PropertyListItem>[] = [
  { header: 'Code', key: 'code', value: (r) => r.code, width: 16 },
  { header: 'Property Name', key: 'name', value: (r) => r.name, width: 34 },
  { header: 'Type', key: 'type', value: (r) => r.typeName, width: 20 },
  { header: 'City', key: 'city', value: (r) => r.cityName, width: 16 },
  { header: 'District', key: 'district', value: (r) => r.districtName ?? '', width: 18 },
  { header: 'Total Units', key: 'totalUnits', value: (r) => r.totalUnits, numFmt: '#,##0' },
  { header: 'Occupied', key: 'occupied', value: (r) => r.occupiedUnits, numFmt: '#,##0' },
  { header: 'Available', key: 'available', value: (r) => r.availableUnits, numFmt: '#,##0' },
  { header: 'Occupancy %', key: 'occupancy', value: (r) => r.occupancyRate, numFmt: '0.0"%"' },
  { header: 'Annual Rental Value (SAR)', key: 'arv', value: (r) => r.annualRentalValue, numFmt: '#,##0', width: 24 },
  { header: 'Status', key: 'status', value: (r) => r.status, width: 14 },
];

/** GET /api/v1/properties/export?format=xlsx|csv */
export async function GET(request: NextRequest) {
  try {
    const principal = await requireApiPermission('properties:export');
    const params = request.nextUrl.searchParams;
    const format = params.get('format') === 'csv' ? 'csv' : 'xlsx';

    const filters: PropertyListFilters = {
      organizationId: principal.organizationId,
      allowedPropertyIds: principal.scopedPropertyIds.length ? principal.scopedPropertyIds : null,
      allowedCityIds: principal.scopedCityIds.length ? principal.scopedCityIds : null,
      search: params.get('search') ?? undefined,
      cityId: params.get('cityId') ?? undefined,
      propertyTypeId: params.get('typeId') ?? undefined,
      status: params.get('status') ?? undefined,
      page: 1,
      pageSize: 10_000,
    };

    const { items } = await listProperties(filters);

    if (principal.userId) {
      const actor = await loadSessionUser(principal.userId);
      if (actor) {
        const db = await getDb();
        await recordAudit(db, {
          organizationId: principal.organizationId,
          action: 'export',
          entityType: 'property',
          entityLabel: `Property export (${items.length} rows, ${format})`,
          actor: { id: actor.id, fullName: actor.fullName },
        });
      }
    }

    if (format === 'csv') {
      return new Response(buildCsv(items, COLUMNS), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${exportFilename('properties', 'csv')}"`,
        },
      });
    }

    const buffer = await buildWorkbook(items, COLUMNS, {
      title: 'Property Inventory',
      sheetName: 'Properties',
      generatedBy: principal.label,
    });

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${exportFilename('properties', 'xlsx')}"`,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
