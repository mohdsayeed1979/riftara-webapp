'use client';

import { ColumnChart, TrendAreaChart } from '@/components/charts/primitives';
import { formatCompactCurrency } from '@/lib/format';
import type { Locale } from '@/i18n/config';

export function AgingAnalysisChart({
  data,
  locale,
}: {
  data: Array<{ label: string; Amount: number }>;
  locale: Locale;
}) {
  return (
    <ColumnChart
      data={data}
      series={[{ key: 'Amount', label: 'Outstanding' }]}
      height={230}
      yTickFormatter={(value) => formatCompactCurrency(value, { locale }).replace('SAR ', '')}
      valueFormatter={(value) => formatCompactCurrency(value, { locale })}
    />
  );
}

export function CollectionTrendChart({
  data,
  locale,
}: {
  data: Array<{ label: string; Billed: number; Collected: number }>;
  locale: Locale;
}) {
  return (
    <TrendAreaChart
      data={data}
      series={[
        { key: 'Billed', label: 'Billed', color: 'var(--color-chart-3)' },
        { key: 'Collected', label: 'Collected', color: 'var(--color-chart-1)' },
      ]}
      height={230}
      yTickFormatter={(value) => formatCompactCurrency(value, { locale }).replace('SAR ', '')}
      valueFormatter={(value) => formatCompactCurrency(value, { locale })}
    />
  );
}
