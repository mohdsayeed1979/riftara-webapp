import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Building2, MapPin, ShieldCheck, Wrench } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';
import { DetailList, DetailRow, MetaItem, PageHeader } from '@/components/ui/page';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { can, requirePermission } from '@/lib/auth/guard';
import { isUuid } from '@/lib/utils';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import {
  getAsset,
  getAssetAuditHistory,
  getAssetFormReferenceData,
  getAssetMaintenanceHistory,
} from '@/services/asset-service';
import { AssetDetailActions, type AssetActionTarget } from '@/features/assets/asset-actions';
import { assetStatusTone, humanizeAssetType } from '@/features/assets/status';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Asset' };

const AUDIT_LABELS: Record<string, string> = {
  asset_assign: 'Assigned',
  asset_transfer: 'Transferred',
  asset_status_change: 'Status changed',
};

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('assets:view');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const locale = await getRequestLocale();
  const allowedPropertyIds = user.scopedPropertyIds.length ? user.scopedPropertyIds : null;
  const scope = { organizationId: user.organizationId, allowedPropertyIds };

  let asset: Awaited<ReturnType<typeof getAsset>>;
  try {
    asset = await getAsset(scope, id);
  } catch {
    notFound();
  }

  const canEdit = can(user, 'assets:edit');
  const canDelete = can(user, 'assets:delete');
  const disposed = asset.status === 'decommissioned';

  const [maintenance, history, reference] = await Promise.all([
    getAssetMaintenanceHistory(user.organizationId, id),
    getAssetAuditHistory(user.organizationId, id),
    canEdit || canDelete ? getAssetFormReferenceData(user.organizationId) : Promise.resolve({ properties: [], buildings: [], vendors: [] }),
  ]);

  const currency = (value: number | string | null) => formatCurrency(Number(value ?? 0), { locale });
  const day = (value: string | null) => (value ? formatDate(value, { locale, style: 'medium' }) : '—');

  const target: AssetActionTarget = {
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
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Assets', href: '/assets' }, { label: asset.code }]}
        title={asset.nameEn}
        badge={<StatusBadge status={asset.status} tone={assetStatusTone(asset.status)} size="md" label={humanizeAssetType(asset.status)} />}
        meta={
          <>
            <MetaItem icon={<ShieldCheck />}>{asset.code}</MetaItem>
            <MetaItem icon={<Building2 />}>{asset.propertyName}</MetaItem>
            {asset.buildingName ? <MetaItem icon={<MapPin />}>{asset.buildingName}</MetaItem> : null}
            <span className="text-[var(--color-text-secondary)]">{humanizeAssetType(asset.assetType)}</span>
          </>
        }
        actions={<AssetDetailActions target={target} reference={reference} permissions={{ canEdit, canDelete }} />}
      />

      {disposed ? (
        <Card>
          <CardBody className="text-[13px] text-[var(--color-text-secondary)]">
            This asset has been disposed (decommissioned) and is retained for historical reference. It cannot be edited, assigned, transferred, or reactivated.
          </CardBody>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Details" />
          <CardBody>
            <DetailList>
              <DetailRow label="Asset Code" value={asset.code} />
              <DetailRow label="Name (EN)" value={asset.nameEn} />
              <DetailRow label="Name (AR)" value={asset.nameAr ?? '—'} />
              <DetailRow label="Type" value={humanizeAssetType(asset.assetType)} />
              <DetailRow label="Status" value={<StatusBadge status={asset.status} tone={assetStatusTone(asset.status)} label={humanizeAssetType(asset.status)} dot={false} />} />
              <DetailRow label="Property" value={<Link href={`/properties/${asset.propertyId}`} className="hover:text-[var(--color-info)]">{asset.propertyName}</Link>} />
              <DetailRow label="Building" value={asset.buildingName ?? '—'} />
              <DetailRow label="Location" value={asset.location ?? '—'} />
              <DetailRow label="Supplier / Vendor" value={asset.vendorName ?? '—'} />
              <DetailRow label="Manufacturer" value={asset.manufacturer ?? '—'} />
              <DetailRow label="Model" value={asset.modelNumber ?? '—'} />
              <DetailRow label="Serial Number" value={asset.serialNumber ?? '—'} />
            </DetailList>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Acquisition & Service" />
          <CardBody>
            <DetailList>
              <DetailRow label="Purchase Date" value={day(asset.purchaseDate)} />
              <DetailRow label="Purchase Cost" value={asset.purchaseCost ? currency(asset.purchaseCost) : '—'} />
              <DetailRow label="Warranty Expiry" value={day(asset.warrantyExpiryDate)} />
              <DetailRow label="Lifetime Maintenance" value={currency(asset.lifetimeMaintenanceCost)} />
              <DetailRow label="Last Service" value={day(asset.lastServiceDate)} />
              <DetailRow label="Next Service" value={day(asset.nextServiceDate)} />
              <DetailRow label="Created" value={formatDateTime(asset.createdAt, { locale })} />
              <DetailRow label="Updated" value={formatDateTime(asset.updatedAt, { locale })} />
            </DetailList>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Maintenance History" description="Work orders linked to this asset." />
        {maintenance.length === 0 ? (
          <EmptyState icon={<Wrench />} title="No maintenance history" description="Work orders raised against this asset will appear here." />
        ) : (
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH>Work Order</TH>
                  <TH>Title</TH>
                  <TH alignment="center">Priority</TH>
                  <TH alignment="center">Status</TH>
                  <TH alignment="end">Raised</TH>
                </TR>
              </THead>
              <TBody>
                {maintenance.map((wo) => (
                  <TR key={wo.id} interactive>
                    <TD>
                      <Link href={`/maintenance/${wo.id}`} className="font-medium hover:text-[var(--color-info)]">{wo.code}</Link>
                    </TD>
                    <TD className="text-[var(--color-text-secondary)]">{wo.title}</TD>
                    <TD alignment="center"><StatusBadge status={wo.priority} dot={false} /></TD>
                    <TD alignment="center"><StatusBadge status={wo.status} dot={false} /></TD>
                    <TD alignment="end" className="whitespace-nowrap text-[var(--color-text-secondary)]">{formatDate(wo.createdAt, { locale, style: 'short' })}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        )}
      </Card>

      <Card>
        <CardHeader title="Activity" description="Lifecycle and audit history for this asset." />
        {history.length === 0 ? (
          <EmptyState icon={<ShieldCheck />} title="No activity yet" />
        ) : (
          <CardBody className="flex flex-col gap-3">
            {history.map((entry) => {
              const reason = entry.reason ?? '';
              const disposeReason = reason.startsWith('asset_dispose:') ? reason.slice('asset_dispose:'.length).trim() : null;
              const label = disposeReason
                ? 'Disposed'
                : AUDIT_LABELS[reason] ?? entry.action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
              return (
                <div key={entry.id} className="flex items-start justify-between gap-4 border-b border-[var(--color-border-subtle)] pb-3 last:border-0 last:pb-0">
                  <div>
                    <span className="text-[13px] font-medium text-[var(--color-text-primary)]">{label}</span>
                    {disposeReason ? <span className="block text-[12px] text-[var(--color-text-secondary)]">{disposeReason}</span> : null}
                    {entry.changedFields?.length ? (
                      <span className="block text-[11.5px] text-[var(--color-text-tertiary)]">{entry.changedFields.join(', ')}</span>
                    ) : null}
                    <span className="block text-[11.5px] text-[var(--color-text-tertiary)]">by {entry.actorLabel}</span>
                  </div>
                  <span className="whitespace-nowrap text-[11.5px] text-[var(--color-text-tertiary)]">{formatDateTime(entry.createdAt, { locale })}</span>
                </div>
              );
            })}
          </CardBody>
        )}
      </Card>
    </div>
  );
}
