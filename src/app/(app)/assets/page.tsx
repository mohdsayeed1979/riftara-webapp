import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { FilterBar } from '@/components/app/filter-bar';
import { KpiCard } from '@/components/ui/kpi-card';
import { EmptyState } from '@/components/ui/misc';
import { KpiGrid, PageHeader } from '@/components/ui/page';
import { StatusBadge } from '@/components/ui/status-badge';
import { Pagination, Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { can, requirePermission } from '@/lib/auth/guard';
import { formatCompactCurrency, formatDate } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import {
  ASSET_STATUSES,
  ASSET_TYPES,
  getAssetFormReferenceData,
  getAssetKpis,
  listAssets,
  type AssetStatus,
  type AssetType,
} from '@/services/asset-service';
import { AssetFormDialog } from '@/features/assets/asset-form';
import { AssetRowActions, type AssetActionTarget } from '@/features/assets/asset-actions';
import { assetStatusTone, humanizeAssetType } from '@/features/assets/status';

export const metadata: Metadata = { title: 'Assets' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission('assets:view');
  const params = await searchParams;
  const locale = await getRequestLocale();
  const page = Math.max(1, Number(params.page) || 1);
  const allowedPropertyIds = user.scopedPropertyIds.length ? user.scopedPropertyIds : null;
  const scope = { organizationId: user.organizationId, allowedPropertyIds };

  const canCreate = can(user, 'assets:create');
  const canEdit = can(user, 'assets:edit');
  const canDelete = can(user, 'assets:delete');
  const showActions = canEdit || canDelete;

  const status = ASSET_STATUSES.includes(params.status as AssetStatus) ? (params.status as AssetStatus) : undefined;
  const assetType = ASSET_TYPES.includes(params.assetType as AssetType) ? (params.assetType as AssetType) : undefined;
  const propertyId = params.property && params.property !== '' ? params.property : undefined;

  const [kpis, { items, total }, reference] = await Promise.all([
    getAssetKpis(scope),
    listAssets({ ...scope, search: params.search, status, propertyId, assetType, page, pageSize: PAGE_SIZE }),
    canCreate || showActions ? getAssetFormReferenceData(user.organizationId) : Promise.resolve({ properties: [], buildings: [], vendors: [] }),
  ]);

  const money = (value: number) => formatCompactCurrency(value, { locale });

  const propertyOptions = reference.properties.map((p) => ({ value: p.id, label: p.name }));

  const buildHref = (targetPage: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== 'page') query.set(key, value);
    }
    query.set('page', String(targetPage));
    return `/assets?${query.toString()}`;
  };

  const toTarget = (asset: (typeof items)[number]): AssetActionTarget => ({
    id: asset.id,
    code: asset.code,
    nameEn: asset.nameEn,
    status: asset.status,
    propertyId: asset.propertyId,
    buildingId: asset.buildingId,
    location: asset.location,
    initial: {
      nameEn: asset.nameEn,
      nameAr: asset.nameAr ?? undefined,
      assetType: asset.assetType,
      location: asset.location ?? undefined,
      manufacturer: asset.manufacturer ?? undefined,
      modelNumber: asset.modelNumber ?? undefined,
      serialNumber: asset.serialNumber ?? undefined,
      supplierVendorId: asset.supplierVendorId ?? undefined,
      purchaseDate: asset.purchaseDate ?? undefined,
      purchaseCost: asset.purchaseCost != null ? String(asset.purchaseCost) : undefined,
      warrantyExpiryDate: asset.warrantyExpiryDate ?? undefined,
    },
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Asset Register"
        subtitle="Operational equipment across the portfolio."
        actions={canCreate ? <AssetFormDialog mode="create" reference={reference} /> : undefined}
      />

      <KpiGrid columns={4}>
        <KpiCard label="Total Assets" value={String(kpis.total)} icon={<ShieldCheck />} tone="neutral" />
        <KpiCard label="Operational" value={String(kpis.operational)} tone="success" ringValue={kpis.total > 0 ? (kpis.operational / kpis.total) * 100 : 0} />
        <KpiCard label="Purchase Value" value={money(kpis.purchaseValue)} tone="gold" />
        <KpiCard label="Lifetime Maintenance" value={money(kpis.lifetimeMaintenanceCost)} tone="warning" higherIsBetter={false} />
      </KpiGrid>

      <FilterBar
        searchPlaceholder="Search by name, code or serial..."
        filters={[
          {
            key: 'status',
            placeholder: 'All Statuses',
            options: ASSET_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) })),
          },
          {
            key: 'assetType',
            placeholder: 'All Types',
            options: ASSET_TYPES.map((t) => ({ value: t, label: humanizeAssetType(t) })),
          },
          ...(propertyOptions.length ? [{ key: 'property', placeholder: 'All Properties', options: propertyOptions }] : []),
        ]}
      />

      <Card>
        {items.length === 0 ? (
          <EmptyState icon={<ShieldCheck />} title="No assets found" description="Create an asset or adjust your filters." />
        ) : (
          <>
            <TableContainer>
              <Table>
                <THead>
                  <TR>
                    <TH>Asset</TH>
                    <TH>Type</TH>
                    <TH>Property</TH>
                    <TH>Location</TH>
                    <TH alignment="end">Next Service</TH>
                    <TH alignment="end">Lifetime Cost</TH>
                    <TH alignment="center">Status</TH>
                    {showActions ? <TH alignment="end">Actions</TH> : null}
                  </TR>
                </THead>
                <TBody>
                  {items.map((asset) => (
                    <TR key={asset.id} interactive>
                      <TD>
                        <Link href={`/assets/${asset.id}`} className="font-medium hover:text-[var(--color-info)]">
                          {asset.nameEn}
                        </Link>
                        <span className="block text-[11px] text-[var(--color-text-tertiary)]">{asset.code}</span>
                      </TD>
                      <TD className="text-[var(--color-text-secondary)]">{humanizeAssetType(asset.assetType)}</TD>
                      <TD className="text-[var(--color-text-secondary)]">
                        {asset.propertyName}
                        {asset.buildingName ? <span className="block text-[11px] text-[var(--color-text-tertiary)]">{asset.buildingName}</span> : null}
                      </TD>
                      <TD className="text-[var(--color-text-secondary)]">{asset.location ?? '—'}</TD>
                      <TD alignment="end" className="whitespace-nowrap">{asset.nextServiceDate ? formatDate(asset.nextServiceDate, { locale, style: 'short' }) : '—'}</TD>
                      <TD alignment="end" numeric>{money(Number(asset.lifetimeMaintenanceCost))}</TD>
                      <TD alignment="center"><StatusBadge status={asset.status} tone={assetStatusTone(asset.status)} label={humanizeAssetType(asset.status)} dot={false} /></TD>
                      {showActions ? (
                        <TD alignment="end">
                          <AssetRowActions target={toTarget(asset)} reference={reference} permissions={{ canEdit, canDelete }} />
                        </TD>
                      ) : null}
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} buildHref={buildHref} />
          </>
        )}
      </Card>
    </div>
  );
}
