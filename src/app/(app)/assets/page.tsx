import type { Metadata } from 'next';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { ShieldCheck } from 'lucide-react';
import { getDb } from '@/db/client';
import { maintenanceAssets, properties, vendors } from '@/db/schema';
import { Card } from '@/components/ui/card';
import { FilterBar } from '@/components/app/filter-bar';
import { KpiCard } from '@/components/ui/kpi-card';
import { EmptyState } from '@/components/ui/misc';
import { KpiGrid, PageHeader } from '@/components/ui/page';
import { StatusBadge } from '@/components/ui/status-badge';
import { Pagination, Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { requirePermission } from '@/lib/auth/guard';
import { formatCompactCurrency, formatDate } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';

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
  const db = await getDb();

  const where = and(
    eq(maintenanceAssets.organizationId, user.organizationId),
    isNull(maintenanceAssets.deletedAt),
    params.assetType ? eq(maintenanceAssets.assetType, params.assetType) : undefined,
  );

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: maintenanceAssets.id,
        code: maintenanceAssets.code,
        nameEn: maintenanceAssets.nameEn,
        assetType: maintenanceAssets.assetType,
        propertyName: properties.nameEn,
        location: maintenanceAssets.location,
        status: maintenanceAssets.status,
        purchaseCost: maintenanceAssets.purchaseCost,
        warrantyExpiryDate: maintenanceAssets.warrantyExpiryDate,
        nextServiceDate: maintenanceAssets.nextServiceDate,
        lifetimeMaintenanceCost: maintenanceAssets.lifetimeMaintenanceCost,
        vendorName: vendors.nameEn,
      })
      .from(maintenanceAssets)
      .innerJoin(properties, eq(properties.id, maintenanceAssets.propertyId))
      .leftJoin(vendors, eq(vendors.id, maintenanceAssets.supplierVendorId))
      .where(where)
      .orderBy(maintenanceAssets.code)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({
        total: sql<number>`count(*)::int`,
        operational: sql<number>`count(*) filter (where ${maintenanceAssets.status} = 'operational')::int`,
        purchaseValue: sql<number>`coalesce(sum(${maintenanceAssets.purchaseCost}), 0)::float8`,
        lifetimeCost: sql<number>`coalesce(sum(${maintenanceAssets.lifetimeMaintenanceCost}), 0)::float8`,
      })
      .from(maintenanceAssets)
      .where(and(eq(maintenanceAssets.organizationId, user.organizationId), isNull(maintenanceAssets.deletedAt))),
  ]);

  const summary = totals[0];
  const money = (value: number) => formatCompactCurrency(value, { locale });

  const buildHref = (targetPage: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== 'page') query.set(key, value);
    }
    query.set('page', String(targetPage));
    return `/assets?${query.toString()}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Asset Register" subtitle="Operational equipment across the portfolio." />

      <KpiGrid columns={4}>
        <KpiCard label="Total Assets" value={String(Number(summary?.total ?? 0))} icon={<ShieldCheck />} tone="neutral" />
        <KpiCard label="Operational" value={String(Number(summary?.operational ?? 0))} tone="success" ringValue={Number(summary?.total) > 0 ? (Number(summary?.operational) / Number(summary?.total)) * 100 : 0} />
        <KpiCard label="Purchase Value" value={money(Number(summary?.purchaseValue ?? 0))} tone="gold" />
        <KpiCard label="Lifetime Maintenance" value={money(Number(summary?.lifetimeCost ?? 0))} tone="warning" higherIsBetter={false} />
      </KpiGrid>

      <FilterBar
        searchPlaceholder="Search assets..."
        filters={[
          {
            key: 'assetType',
            placeholder: 'All Types',
            options: [
              { value: 'elevator', label: 'Elevators' },
              { value: 'chiller', label: 'Chillers' },
              { value: 'generator', label: 'Generators' },
              { value: 'pump', label: 'Pumps' },
              { value: 'fire_panel', label: 'Fire Panels' },
              { value: 'cctv', label: 'CCTV' },
              { value: 'access_control', label: 'Access Control' },
            ],
          },
        ]}
      />

      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<ShieldCheck />} title="No assets found" />
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
                  </TR>
                </THead>
                <TBody>
                  {rows.map((asset) => (
                    <TR key={asset.id}>
                      <TD>
                        <span className="font-medium">{asset.nameEn}</span>
                        <span className="block text-[11px] text-[var(--color-text-tertiary)]">{asset.code}</span>
                      </TD>
                      <TD className="capitalize text-[var(--color-text-secondary)]">{asset.assetType.replace(/_/g, ' ')}</TD>
                      <TD className="text-[var(--color-text-secondary)]">{asset.propertyName}</TD>
                      <TD className="text-[var(--color-text-secondary)]">{asset.location ?? '—'}</TD>
                      <TD alignment="end" className="whitespace-nowrap">{asset.nextServiceDate ? formatDate(asset.nextServiceDate, { locale, style: 'short' }) : '—'}</TD>
                      <TD alignment="end" numeric>{money(Number(asset.lifetimeMaintenanceCost))}</TD>
                      <TD alignment="center"><StatusBadge status={asset.status === 'operational' ? 'active' : asset.status === 'under_maintenance' ? 'in_progress' : 'neutral'} label={asset.status.replace(/_/g, ' ')} dot={false} /></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
            <Pagination page={page} pageSize={PAGE_SIZE} total={Number(summary?.total ?? 0)} buildHref={buildHref} />
          </>
        )}
      </Card>
    </div>
  );
}
