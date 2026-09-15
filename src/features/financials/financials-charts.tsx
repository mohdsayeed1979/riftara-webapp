'use client';

import { ColumnChart } from '@/components/charts/primitives';
import { formatCompactCurrency } from '@/lib/format';
import type { Locale } from '@/i18n/config';

export function NoiOpexTrendChart({
  data,
  locale,
}: {
  data: Array<{ label: string; NOI: number; OPEX: number }>;
  locale: Locale;
}) {
  return (
    <ColumnChart
      data={data}
      series={[
        { key: 'NOI', label: 'NOI', color: 'var(--color-chart-1)' },
        { key: 'OPEX', label: 'OPEX', color: 'var(--color-chart-4)' },
      ]}
      height={250}
      yTickFormatter={(value) => formatCompactCurrency(value, { locale }).replace('SAR ', '')}
      valueFormatter={(value) => formatCompactCurrency(value, { locale })}
    />
  );
}
