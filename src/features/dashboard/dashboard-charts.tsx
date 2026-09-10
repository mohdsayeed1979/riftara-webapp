'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { MetricRow } from '@/components/ui/kpi-card';
import { DonutChart, DonutLegend, TrendAreaChart, type DonutSlice } from '@/components/charts/primitives';
import { SaudiPortfolioMap, type MapMarker } from '@/components/charts/saudi-map';
import type { CityBreakdownRow, StatusBreakdownRow, TrendPoint } from '@/services/metrics-service';
import { formatCompactCurrency, formatPercent } from '@/lib/format';
import { getMessages } from '@/i18n';
import type { Locale } from '@/i18n/config';

const STATUS_COLOR: Record<string, string> = {
  available: 'var(--color-status-available)',
  reserved: 'var(--color-status-reserved)',
  leased: 'var(--color-status-leased)',
  maintenance: 'var(--color-status-maintenance)',
  blocked: 'var(--color-status-blocked)',
  neutral: 'var(--color-neutral)',
};

export interface DashboardSummaryFigures {
  marketValue: number;
  bookValue: number;
  annualRentalValue: number;
  contractedRevenue: number;
  collectedRevenue: number;
  outstanding: number;
  collectionRate: number;
}

export function DashboardCharts({
  trend,
  statusBreakdown,
  totalUnits,
  cityBreakdown,
  summary,
  periodLabel,
  locale,
}: {
  trend: TrendPoint[];
  statusBreakdown: StatusBreakdownRow[];
  totalUnits: number;
  cityBreakdown: CityBreakdownRow[];
  summary: DashboardSummaryFigures;
  periodLabel: string;
  locale: Locale;
}) {
  const d = getMessages(locale).dashboard;
  const occupancySeries = trend.map((point) => ({
    label: point.label,
    Occupied: point.occupancyRate,
    Vacant: point.vacancyRate,
  }));

  const collectionSeries = trend.map((point) => ({
    label: point.label,
    Billed: point.billed,
    Collected: point.collected,
  }));

  // Only statuses that actually have units are charted.
  const donutData: DonutSlice[] = statusBreakdown
    .filter((row) => row.count > 0)
    .map((row) => ({
      label: row.label,
      value: row.count,
      color: STATUS_COLOR[row.colorToken] ?? STATUS_COLOR.neutral,
      href: `/units?status=${row.key}`,
    }));

  const markers: MapMarker[] = cityBreakdown.map((city) => ({
    id: city.cityId,
    name: city.cityName,
    latitude: city.latitude,
    longitude: city.longitude,
    value: city.totalUnits,
    valueLabel: `${city.totalUnits} units`,
    href: `/properties?cityId=${city.cityId}`,
  }));

  const money = (value: number) => formatCompactCurrency(value, { locale });

  return (
    <>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr_0.9fr]">
        <Card>
          <CardHeader title={d.occupancyTrend} description={periodLabel} />
          <CardBody className="pt-0">
            <TrendAreaChart
              data={occupancySeries}
              series={[
                { key: 'Occupied', label: d.occupied, color: 'var(--color-espresso-800)' },
                { key: 'Vacant', label: d.vacant, color: 'var(--color-border-strong)' },
              ]}
              height={252}
              domain={[0, 100]}
              yTickFormatter={(value) => `${value}%`}
              valueFormatter={(value) => `${value.toFixed(1)}%`}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={d.unitStatusOverview}
            action={
              <Link
                href="/units"
                aria-label="Open unit inventory"
                className="rounded-[6px] p-1 text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)]"
              >
                <ArrowRight className="size-4 rtl-flip" aria-hidden />
              </Link>
            }
          />
          <CardBody className="pt-0">
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <DonutChart
                data={donutData}
                centerValue={totalUnits.toLocaleString()}
                centerLabel={d.totalUnits}
                height={188}
              />
              <div className="w-full min-w-0 flex-1">
                <DonutLegend data={donutData} total={totalUnits} />
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={d.portfolioValueTrend} />
          <CardBody className="pt-0">
            <p className="text-[24px] font-semibold leading-8 text-[var(--color-text-primary)] tabular">
              {money(summary.marketValue)}
            </p>
            <p className="mb-2 text-[11.5px] text-[var(--color-text-secondary)]">
              {d.marketValuation}
            </p>
            <MetricRow
              label={d.bookValue}
              value={money(summary.bookValue)}
              href="/financials/valuations"
            />
            <MetricRow
              label={d.annualRentalValue}
              value={money(summary.annualRentalValue)}
              href="/units"
            />
            <MetricRow
              label={d.contractedRevenue}
              value={money(summary.contractedRevenue)}
              href="/contracts"
            />
            <MetricRow
              label={d.collectedRevenue}
              value={money(summary.collectedRevenue)}
              href="/collections"
            />
            <MetricRow
              label={d.outstanding}
              value={money(summary.outstanding)}
              tone={summary.outstanding > 0 ? 'warning' : 'default'}
              href="/collections?status=overdue"
            />
            <MetricRow
              label={d.collectionRate}
              value={formatPercent(summary.collectionRate, { locale })}
              tone={summary.collectionRate >= 95 ? 'success' : 'warning'}
              href="/collections"
            />
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title={d.collectionTrend} description={periodLabel} />
          <CardBody className="pt-0">
            <TrendAreaChart
              data={collectionSeries}
              series={[
                { key: 'Billed', label: d.billed, color: 'var(--color-chart-3)' },
                { key: 'Collected', label: d.collected, color: 'var(--color-chart-1)' },
              ]}
              height={240}
              yTickFormatter={(value) => formatCompactCurrency(value, { locale }).replace('SAR ', '')}
              valueFormatter={(value) => formatCompactCurrency(value, { locale })}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={d.unitsByCity} />
          <CardBody className="pt-0">
            <SaudiPortfolioMap markers={markers} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
