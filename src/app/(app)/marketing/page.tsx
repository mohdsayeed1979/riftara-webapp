import type { Metadata } from 'next';
import { Target, TrendingUp, Users, Wallet } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { EmptyState } from '@/components/ui/misc';
import { KpiGrid, PageHeader } from '@/components/ui/page';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { DonutChart, DonutLegend, TrendLineChart } from '@/components/charts/primitives';
import { requirePermission } from '@/lib/auth/guard';
import { formatCompactCurrency, formatCurrency, formatNumber } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import {
  aggregateMarketing,
  getLeadsByChannel,
  getMarketingTrend,
  getPlatformSummaries,
  getTopCampaigns,
} from '@/services/marketing-service';

export const metadata: Metadata = { title: 'Marketing' };
export const dynamic = 'force-dynamic';

export default async function MarketingPage() {
  const user = await requirePermission('marketing:view');
  const locale = await getRequestLocale();

  const [platforms, leadsByChannel, trend, campaigns] = await Promise.all([
    getPlatformSummaries(user.organizationId, 6),
    getLeadsByChannel(user.organizationId, 6),
    getMarketingTrend(user.organizationId, 6),
    getTopCampaigns(user.organizationId, 6),
  ]);

  const totals = aggregateMarketing(platforms);
  const money = (value: number) => formatCompactCurrency(value, { locale });
  const totalLeads = leadsByChannel.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Marketing & Attribution"
        subtitle="Measure marketing performance and drive high-quality leasing leads."
      />

      <KpiGrid columns={6}>
        <KpiCard label="Marketing Spend" value={money(totals.spend)} caption="Last 6 months" icon={<Wallet />} tone="neutral" higherIsBetter={false} />
        <KpiCard label="Leads" value={formatNumber(totals.leads, { locale })} caption={`${formatNumber(totals.qualifiedLeads, { locale })} qualified`} icon={<Users />} tone="info" />
        <KpiCard label="Cost per Lead" value={formatCurrency(totals.cpl, { locale })} icon={<Target />} tone="warning" higherIsBetter={false} />
        <KpiCard label="Contracts" value={formatNumber(totals.contracts, { locale })} caption="Attributed" icon={<TrendingUp />} tone="success" />
        <KpiCard label="Contract Value" value={money(totals.contractValue)} caption="Attributed revenue" icon={<Wallet />} tone="gold" />
        <KpiCard label="ROAS" value={`${totals.roas.toFixed(1)}x`} caption={`${totals.roi.toFixed(0)}% ROI`} icon={<TrendingUp />} tone="success" />
      </KpiGrid>

      {/* Platform cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {platforms.map((platform) => (
          <Card key={platform.platformId}>
            <CardBody>
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: platform.brandColor ?? 'var(--color-neutral)' }} aria-hidden />
                <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">{platform.name}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Stat label="Leads" value={formatNumber(platform.leads, { locale })} />
                <Stat label="Contracts" value={formatNumber(platform.contracts, { locale })} />
                <Stat label="CPL" value={formatCurrency(platform.cpl, { locale })} />
                <Stat label="ROAS" value={`${platform.roas.toFixed(1)}x`} tone="success" />
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Leads & Contracts Trend" description="Last 6 months" />
          <CardBody className="pt-0">
            {trend.length === 0 ? (
              <EmptyState title="No campaign data" />
            ) : (
              <TrendLineChart
                data={trend}
                series={[
                  { key: 'Leads', label: 'Leads', color: 'var(--color-chart-2)' },
                  { key: 'Contracts', label: 'Contracts', color: 'var(--color-chart-1)' },
                ]}
                height={250}
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Leads by Channel" />
          <CardBody className="pt-0">
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <DonutChart data={leadsByChannel} centerValue={formatNumber(totalLeads, { locale })} centerLabel="Total Leads" height={188} />
              <div className="w-full flex-1">
                <DonutLegend data={leadsByChannel} total={totalLeads} />
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Campaign Performance" description="Top campaigns by attributed contract value" />
        {campaigns.length === 0 ? (
          <EmptyState title="No campaigns" />
        ) : (
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH>Campaign</TH>
                  <TH>Platform</TH>
                  <TH>Property</TH>
                  <TH alignment="end">Spend</TH>
                  <TH alignment="end">Leads</TH>
                  <TH alignment="end">CPL</TH>
                  <TH alignment="end">Contracts</TH>
                  <TH alignment="end">ROAS</TH>
                </TR>
              </THead>
              <TBody>
                {campaigns.map((campaign) => (
                  <TR key={campaign.id}>
                    <TD className="font-medium">{campaign.name}</TD>
                    <TD className="text-[var(--color-text-secondary)]">{campaign.platformName}</TD>
                    <TD className="text-[var(--color-text-secondary)]">{campaign.propertyName ?? '—'}</TD>
                    <TD alignment="end" numeric>{money(campaign.spend)}</TD>
                    <TD alignment="end" numeric>{campaign.leads}</TD>
                    <TD alignment="end" numeric>{formatCurrency(campaign.cpl, { locale })}</TD>
                    <TD alignment="end" numeric>{campaign.contracts}</TD>
                    <TD alignment="end" numeric className="font-medium text-[var(--color-success)]">{campaign.roas.toFixed(1)}x</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'success' }) {
  return (
    <div>
      <p className="text-[10.5px] text-[var(--color-text-tertiary)]">{label}</p>
      <p className={tone === 'success' ? 'text-[14px] font-semibold text-[var(--color-success)] tabular' : 'text-[14px] font-semibold text-[var(--color-text-primary)] tabular'}>
        {value}
      </p>
    </div>
  );
}
