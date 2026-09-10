import type { Metadata } from 'next';
import { BarChart3, ShieldCheck, Wrench } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';
import { KpiCard } from '@/components/ui/kpi-card';
import { KpiGrid, PageHeader } from '@/components/ui/page';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { requirePermission } from '@/lib/auth/guard';
import { formatCompactCurrency, formatCurrency } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import {
  getAssetDepreciationTotals,
  getAssetLifecycleBreakdown,
  getAssetMaintenanceAnalytics,
} from '@/services/asset-service';
import { assetStatusTone, humanizeAssetType } from '@/features/assets/status';

export const metadata: Metadata = { title: 'Asset Analytics' };
export const dynamic = 'force-dynamic';

export default async function AssetAnalyticsPage() {
  const user = await requirePermission('assets:view');
  const locale = await getRequestLocale();
  const allowedPropertyIds = user.scopedPropertyIds.length ? user.scopedPropertyIds : null;
  const scope = { organizationId: user.organizationId, allowedPropertyIds };

  const [lifecycle, maintenance, depreciation] = await Promise.all([
    getAssetLifecycleBreakdown(scope),
    getAssetMaintenanceAnalytics(scope),
    getAssetDepreciationTotals(scope),
  ]);

  const money = (v: number) => formatCompactCurrency(v, { locale });
  const currency = (v: number) => formatCurrency(v, { locale });
  const totalAssets = lifecycle.byStatus.reduce((sum, r) => sum + r.count, 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Assets', href: '/assets' }, { label: 'Analytics' }]}
        title="Asset Portfolio Analytics"
        subtitle="Lifecycle, maintenance-cost and calculated depreciation analytics."
      />

      {totalAssets === 0 ? (
        <Card>
          <EmptyState icon={<BarChart3 />} title="No assets to analyze" description="Register assets to see portfolio analytics." />
        </Card>
      ) : (
        <>
          {/* Depreciation — clearly labelled as calculated */}
          <KpiGrid columns={4}>
            <KpiCard label="Total Purchase Cost" value={money(depreciation.totalPurchaseCost)} tone="gold" />
            <KpiCard label="Accumulated Depreciation" value={money(depreciation.totalAccumulatedDepreciation)} caption="Calculated" tone="warning" higherIsBetter={false} />
            <KpiCard label="Net Book Value" value={money(depreciation.totalNetBookValue)} caption="Calculated" tone="success" />
            <KpiCard label="Depreciable Assets" value={String(depreciation.depreciableAssets)} caption={`${depreciation.missingInputs} missing inputs`} tone="neutral" />
          </KpiGrid>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Calculated Depreciation by Property" description="Straight-line, read-only — not posted to any ledger." />
              {depreciation.byProperty.length === 0 ? (
                <EmptyState icon={<ShieldCheck />} title="No depreciable assets" />
              ) : (
                <TableContainer>
                  <Table>
                    <THead><TR><TH>Property</TH><TH alignment="end">Purchase Cost</TH><TH alignment="end">Accumulated</TH><TH alignment="end">Net Book Value</TH></TR></THead>
                    <TBody>
                      {depreciation.byProperty.map((r) => (
                        <TR key={r.propertyId}>
                          <TD>{r.propertyName}</TD>
                          <TD alignment="end" numeric>{currency(r.purchaseCost)}</TD>
                          <TD alignment="end" numeric>{currency(r.accumulatedDepreciation)}</TD>
                          <TD alignment="end" numeric>{currency(r.netBookValue)}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableContainer>
              )}
            </Card>

            <Card>
              <CardHeader title="Calculated Depreciation by Asset Type" />
              {depreciation.byAssetType.length === 0 ? (
                <EmptyState icon={<ShieldCheck />} title="No depreciable assets" />
              ) : (
                <TableContainer>
                  <Table>
                    <THead><TR><TH>Type</TH><TH alignment="end">Purchase Cost</TH><TH alignment="end">Net Book Value</TH></TR></THead>
                    <TBody>
                      {depreciation.byAssetType.map((r) => (
                        <TR key={r.assetType}>
                          <TD>{humanizeAssetType(r.assetType)}</TD>
                          <TD alignment="end" numeric>{currency(r.purchaseCost)}</TD>
                          <TD alignment="end" numeric>{currency(r.netBookValue)}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableContainer>
              )}
            </Card>
          </div>

          {/* Maintenance analytics */}
          <KpiGrid columns={3}>
            <KpiCard label="Total Maintenance Spend" value={money(maintenance.totalSpend)} icon={<Wrench />} tone="warning" higherIsBetter={false} />
            <KpiCard label="Open Work Orders" value={String(maintenance.openWorkOrders)} tone="info" />
            <KpiCard label="Completed Work Orders" value={String(maintenance.completedWorkOrders)} tone="success" />
          </KpiGrid>

          <Card>
            <CardHeader title="Top Assets by Maintenance Cost" />
            {maintenance.topAssets.length === 0 ? (
              <EmptyState icon={<Wrench />} title="No maintenance costs recorded" />
            ) : (
              <TableContainer>
                <Table>
                  <THead><TR><TH>Asset</TH><TH>Code</TH><TH alignment="end">Total Cost</TH></TR></THead>
                  <TBody>
                    {maintenance.topAssets.map((r) => (
                      <TR key={r.assetId}>
                        <TD>{r.nameEn}</TD>
                        <TD className="text-[var(--color-text-tertiary)]">{r.code}</TD>
                        <TD alignment="end" numeric>{currency(r.totalCost)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableContainer>
            )}
          </Card>

          {/* Lifecycle breakdowns */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Assets by Status" />
              <CardBody className="flex flex-col gap-2">
                {lifecycle.byStatus.map((r) => (
                  <div key={r.key} className="flex items-center justify-between">
                    <StatusBadge status={r.key} tone={assetStatusTone(r.key)} label={humanizeAssetType(r.key)} dot={false} />
                    <span className="text-[13px] font-medium">{r.count}</span>
                  </div>
                ))}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Warranty & Configuration" />
              <CardBody className="flex flex-col gap-2 text-[13px]">
                <Row label="Valid (> 90 days)" value={lifecycle.warranty.valid} />
                <Row label="Expiring soon (≤ 90 days)" value={lifecycle.warranty.expiringSoon} />
                <Row label="Expired" value={lifecycle.warranty.expired} />
                <Row label="No warranty info" value={lifecycle.warranty.none} />
                <Row label="Missing depreciation config" value={lifecycle.missingDepreciationConfig} />
              </CardBody>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Assets by Type" />
              <TableContainer>
                <Table>
                  <THead><TR><TH>Type</TH><TH alignment="end">Count</TH></TR></THead>
                  <TBody>
                    {lifecycle.byAssetType.map((r) => (
                      <TR key={r.key}><TD>{humanizeAssetType(r.key)}</TD><TD alignment="end" numeric>{r.count}</TD></TR>
                    ))}
                  </TBody>
                </Table>
              </TableContainer>
            </Card>

            <Card>
              <CardHeader title="Assets by Property" />
              <TableContainer>
                <Table>
                  <THead><TR><TH>Property</TH><TH alignment="end">Count</TH></TR></THead>
                  <TBody>
                    {lifecycle.byProperty.map((r) => (
                      <TR key={r.propertyId}><TD>{r.propertyName}</TD><TD alignment="end" numeric>{r.count}</TD></TR>
                    ))}
                  </TBody>
                </Table>
              </TableContainer>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[var(--color-text-secondary)]">{label}</span>
      <span className="font-medium text-[var(--color-text-primary)]">{value}</span>
    </div>
  );
}
