import type { NextRequest } from 'next/server';
import { requireApiPermission } from '@/lib/api/guard';
import { apiError } from '@/lib/api/response';
import { getDb } from '@/db/client';
import { recordAudit } from '@/lib/audit';
import { buildCsv, buildWorkbook, exportFilename, type ExportColumn } from '@/lib/export/excel';
import {
  ASSET_STATUSES,
  ASSET_TYPES,
  calculateAssetDepreciation,
  getAssetMaintenanceTotalsByAsset,
  listAssets,
  type AssetStatus,
  type AssetType,
} from '@/services/asset-service';

export const dynamic = 'force-dynamic';

const dateOnly = (v: string | Date | null): string => (v ? String(v).slice(0, 10) : '');

interface ExportRow {
  code: string;
  nameEn: string;
  assetType: string;
  propertyName: string;
  buildingName: string | null;
  location: string | null;
  manufacturer: string | null;
  modelNumber: string | null;
  serialNumber: string | null;
  purchaseDate: string | null;
  purchaseCost: number | null;
  warrantyExpiryDate: string | null;
  vendorName: string | null;
  status: string;
  usefulLifeYears: number | null;
  residualValue: number | null;
  depreciationMethod: string | null;
  accumulatedDepreciation: number | null;
  netBookValue: number | null;
  lastMaintenance: string | null;
  totalMaintenanceCost: number;
  createdAt: Date;
  updatedAt: Date;
}

const COLUMNS: ExportColumn<ExportRow>[] = [
  { header: 'Asset Code', key: 'code', value: (r) => r.code, width: 16 },
  { header: 'Asset Name', key: 'nameEn', value: (r) => r.nameEn, width: 28 },
  { header: 'Asset Type', key: 'assetType', value: (r) => r.assetType, width: 16 },
  { header: 'Property', key: 'property', value: (r) => r.propertyName, width: 26 },
  { header: 'Building', key: 'building', value: (r) => r.buildingName ?? '', width: 20 },
  { header: 'Location', key: 'location', value: (r) => r.location ?? '', width: 20 },
  { header: 'Manufacturer', key: 'manufacturer', value: (r) => r.manufacturer ?? '', width: 18 },
  { header: 'Model', key: 'model', value: (r) => r.modelNumber ?? '', width: 16 },
  { header: 'Serial Number', key: 'serial', value: (r) => r.serialNumber ?? '', width: 18 },
  { header: 'Purchase Date', key: 'purchaseDate', value: (r) => dateOnly(r.purchaseDate), width: 14 },
  { header: 'Purchase Cost (SAR)', key: 'purchaseCost', value: (r) => r.purchaseCost, numFmt: '#,##0.00', width: 18 },
  { header: 'Warranty Expiry', key: 'warranty', value: (r) => dateOnly(r.warrantyExpiryDate), width: 14 },
  { header: 'Supplier / Vendor', key: 'vendor', value: (r) => r.vendorName ?? '', width: 22 },
  { header: 'Status', key: 'status', value: (r) => r.status, width: 16 },
  { header: 'Useful Life (Years)', key: 'usefulLife', value: (r) => r.usefulLifeYears, numFmt: '#,##0', width: 16 },
  { header: 'Residual Value (SAR)', key: 'residual', value: (r) => r.residualValue, numFmt: '#,##0.00', width: 18 },
  { header: 'Depreciation Method', key: 'method', value: (r) => r.depreciationMethod ?? '', width: 18 },
  { header: 'Calculated Accumulated Depreciation (SAR)', key: 'accum', value: (r) => r.accumulatedDepreciation, numFmt: '#,##0.00', width: 24 },
  { header: 'Calculated Net Book Value (SAR)', key: 'nbv', value: (r) => r.netBookValue, numFmt: '#,##0.00', width: 22 },
  { header: 'Last Maintenance', key: 'lastMaint', value: (r) => dateOnly(r.lastMaintenance), width: 16 },
  { header: 'Total Maintenance Cost (SAR)', key: 'maintCost', value: (r) => r.totalMaintenanceCost, numFmt: '#,##0.00', width: 22 },
  { header: 'Created', key: 'created', value: (r) => dateOnly(r.createdAt), width: 14 },
  { header: 'Updated', key: 'updated', value: (r) => dateOnly(r.updatedAt), width: 14 },
];

/** GET /api/v1/assets/export?format=xlsx|csv — asset register export. */
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

    const rows: ExportRow[] = items.map((a) => {
      const d = calculateAssetDepreciation(a);
      const maint = maintenanceMap.get(a.id);
      return {
        code: a.code,
        nameEn: a.nameEn,
        assetType: a.assetType,
        propertyName: a.propertyName,
        buildingName: a.buildingName,
        location: a.location,
        manufacturer: a.manufacturer,
        modelNumber: a.modelNumber,
        serialNumber: a.serialNumber,
        purchaseDate: a.purchaseDate,
        purchaseCost: a.purchaseCost,
        warrantyExpiryDate: a.warrantyExpiryDate,
        vendorName: a.vendorName,
        status: a.status,
        usefulLifeYears: a.usefulLifeYears,
        residualValue: a.residualValue,
        depreciationMethod: a.depreciationMethod,
        accumulatedDepreciation: d.depreciable ? d.accumulatedDepreciation : null,
        netBookValue: d.depreciable ? d.netBookValue : null,
        lastMaintenance: maint?.lastCompletedAt ?? null,
        totalMaintenanceCost: maint?.totalMaintenanceCost ?? 0,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      };
    });

    await recordAudit(await getDb(), {
      organizationId: principal.organizationId,
      action: 'export',
      entityType: 'asset_register',
      entityLabel: 'Asset register export',
      reason: `format=${format}; rows=${rows.length}`,
      actor: principal.userId ? { id: principal.userId, fullName: principal.label } : null,
    });

    if (format === 'csv') {
      return new Response(buildCsv(rows, COLUMNS), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${exportFilename('asset-register', 'csv')}"`,
        },
      });
    }

    const buffer = await buildWorkbook(rows, COLUMNS, {
      title: 'Asset Register (incl. calculated depreciation)',
      sheetName: 'Assets',
      generatedBy: principal.label,
    });
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${exportFilename('asset-register', 'xlsx')}"`,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
