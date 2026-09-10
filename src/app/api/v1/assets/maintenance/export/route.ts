import type { NextRequest } from 'next/server';
import { requireApiPermission } from '@/lib/api/guard';
import { apiError } from '@/lib/api/response';
import { getDb } from '@/db/client';
import { recordAudit } from '@/lib/audit';
import { buildCsv, buildWorkbook, exportFilename, type ExportColumn } from '@/lib/export/excel';
import {
  ASSET_STATUSES,
  ASSET_TYPES,
  getAssetMaintenanceTotalsByAsset,
  listAssets,
  type AssetStatus,
  type AssetType,
} from '@/services/asset-service';

export const dynamic = 'force-dynamic';

const dateOnly = (v: string | null): string => (v ? v.slice(0, 10) : '');

interface Row {
  code: string;
  nameEn: string;
  propertyName: string;
  assetType: string;
  status: string;
  totalWorkOrders: number;
  openWorkOrders: number;
  completedWorkOrders: number;
  lastCompletedAt: string | null;
  totalMaintenanceCost: number;
  activeSchedules: number;
  nextPreventiveDueDate: string | null;
}

const COLUMNS: ExportColumn<Row>[] = [
  { header: 'Asset Code', key: 'code', value: (r) => r.code, width: 16 },
  { header: 'Asset Name', key: 'name', value: (r) => r.nameEn, width: 28 },
  { header: 'Property', key: 'property', value: (r) => r.propertyName, width: 26 },
  { header: 'Asset Type', key: 'type', value: (r) => r.assetType, width: 16 },
  { header: 'Status', key: 'status', value: (r) => r.status, width: 16 },
  { header: 'Total Work Orders', key: 'totalWo', value: (r) => r.totalWorkOrders, numFmt: '#,##0', width: 16 },
  { header: 'Open Work Orders', key: 'openWo', value: (r) => r.openWorkOrders, numFmt: '#,##0', width: 16 },
  { header: 'Completed Work Orders', key: 'doneWo', value: (r) => r.completedWorkOrders, numFmt: '#,##0', width: 18 },
  { header: 'Last Completed Maintenance', key: 'lastDone', value: (r) => dateOnly(r.lastCompletedAt), width: 20 },
  { header: 'Total Maintenance Cost (SAR)', key: 'cost', value: (r) => r.totalMaintenanceCost, numFmt: '#,##0.00', width: 22 },
  { header: 'Active PM Schedules', key: 'pm', value: (r) => r.activeSchedules, numFmt: '#,##0', width: 16 },
  { header: 'Next PM Due', key: 'nextPm', value: (r) => dateOnly(r.nextPreventiveDueDate), width: 14 },
];

/** GET /api/v1/assets/maintenance/export?format=xlsx|csv — asset maintenance report. */
export async function GET(request: NextRequest) {
  try {
    const principal = await requireApiPermission('assets:view');
    const params = request.nextUrl.searchParams;
    const format = params.get('format') === 'csv' ? 'csv' : 'xlsx';

    const scope = {
      organizationId: principal.organizationId,
      allowedPropertyIds: principal.scopedPropertyIds.length ? principal.scopedPropertyIds : null,
    };
    const statusParam = params.get('status');
    const typeParam = params.get('assetType');

    const [{ items }, maintenanceMap] = await Promise.all([
      listAssets({
        ...scope,
        search: params.get('search') ?? undefined,
        status: statusParam && (ASSET_STATUSES as readonly string[]).includes(statusParam) ? (statusParam as AssetStatus) : undefined,
        propertyId: params.get('property') ?? undefined,
        assetType: typeParam && (ASSET_TYPES as readonly string[]).includes(typeParam) ? (typeParam as AssetType) : undefined,
        page: 1,
        pageSize: 10_000,
      }),
      getAssetMaintenanceTotalsByAsset(scope),
    ]);

    const rows: Row[] = items.map((a) => {
      const m = maintenanceMap.get(a.id);
      return {
        code: a.code,
        nameEn: a.nameEn,
        propertyName: a.propertyName,
        assetType: a.assetType,
        status: a.status,
        totalWorkOrders: m?.totalWorkOrders ?? 0,
        openWorkOrders: m?.openWorkOrders ?? 0,
        completedWorkOrders: m?.completedWorkOrders ?? 0,
        lastCompletedAt: m?.lastCompletedAt ?? null,
        totalMaintenanceCost: m?.totalMaintenanceCost ?? 0,
        activeSchedules: m?.activeSchedules ?? 0,
        nextPreventiveDueDate: m?.nextPreventiveDueDate ?? null,
      };
    });

    await recordAudit(await getDb(), {
      organizationId: principal.organizationId,
      action: 'export',
      entityType: 'asset_maintenance_report',
      entityLabel: 'Asset maintenance report export',
      reason: `format=${format}; rows=${rows.length}`,
      actor: principal.userId ? { id: principal.userId, fullName: principal.label } : null,
    });

    if (format === 'csv') {
      return new Response(buildCsv(rows, COLUMNS), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${exportFilename('asset-maintenance', 'csv')}"`,
        },
      });
    }

    const buffer = await buildWorkbook(rows, COLUMNS, {
      title: 'Asset Maintenance Report',
      sheetName: 'Maintenance',
      generatedBy: principal.label,
    });
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${exportFilename('asset-maintenance', 'xlsx')}"`,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
