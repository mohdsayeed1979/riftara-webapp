'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Chart primitives wired to the RIFTARA palette. Every chart in the platform
 * is fed real database rows — there are no decorative charts (BRD 67).
 */

export const CHART_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
  'var(--color-chart-6)',
  'var(--color-chart-7)',
  'var(--color-chart-8)',
];

const AXIS_STYLE = {
  fontSize: 11,
  fill: 'var(--color-text-tertiary)',
} as const;

const GRID_COLOR = 'var(--color-border-subtle)';

interface TooltipPayloadEntry {
  name?: string | number;
  value?: string | number;
  color?: string;
  dataKey?: string | number;
}

function ChartTooltip({
  active,
  payload,
  label,
  formatter,
  labelFormatter,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string | number;
  formatter?: (value: number, name: string) => string;
  labelFormatter?: (label: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[8px] border border-[var(--color-border-base)] bg-[var(--color-surface)] px-3 py-2 shadow-[var(--shadow-overlay)]">
      <p className="mb-1 text-[11px] font-medium text-[var(--color-text-secondary)]">
        {labelFormatter ? labelFormatter(String(label ?? '')) : String(label ?? '')}
      </p>
      {payload.map((entry, index) => (
        <p
          key={index}
          className="flex items-center gap-2 text-[12.5px] font-semibold text-[var(--color-text-primary)] tabular"
        >
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: entry.color }}
            aria-hidden
          />
          <span className="font-normal text-[var(--color-text-secondary)]">{String(entry.name ?? '')}</span>
          {formatter
            ? formatter(Number(entry.value ?? 0), String(entry.name ?? ''))
            : Number(entry.value ?? 0).toLocaleString()}
        </p>
      ))}
    </div>
  );
}

export interface SeriesConfig {
  key: string;
  label: string;
  color?: string;
}

export function ChartFrame({
  height = 260,
  children,
  className,
}: {
  height?: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('w-full', className)} style={{ height }}>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function TrendAreaChart({
  data,
  series,
  xKey = 'label',
  height = 260,
  valueFormatter,
  yTickFormatter,
  domain,
}: {
  data: Array<Record<string, string | number>>;
  series: SeriesConfig[];
  xKey?: string;
  height?: number;
  valueFormatter?: (value: number, name: string) => string;
  yTickFormatter?: (value: number) => string;
  domain?: [number | 'auto', number | 'auto'];
}) {
  return (
    <ChartFrame height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color ?? CHART_COLORS[i]} stopOpacity={0.22} />
                <stop offset="100%" stopColor={s.color ?? CHART_COLORS[i]} stopOpacity={0.01} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={xKey} tick={AXIS_STYLE} tickLine={false} axisLine={false} dy={6} />
          <YAxis
            tick={AXIS_STYLE}
            tickLine={false}
            axisLine={false}
            width={52}
            domain={domain}
            tickFormatter={yTickFormatter}
          />
          <Tooltip content={<ChartTooltip formatter={valueFormatter} />} />
          {series.length > 1 ? (
            <Legend
              verticalAlign="top"
              align="right"
              height={28}
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 11.5, color: 'var(--color-text-secondary)' }}
            />
          ) : null}
          {series.map((s, i) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color ?? CHART_COLORS[i]}
              strokeWidth={2}
              fill={`url(#grad-${s.key})`}
              dot={{ r: 2.5, strokeWidth: 0, fill: s.color ?? CHART_COLORS[i] }}
              activeDot={{ r: 4 }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function TrendLineChart({
  data,
  series,
  xKey = 'label',
  height = 260,
  valueFormatter,
  yTickFormatter,
}: {
  data: Array<Record<string, string | number>>;
  series: SeriesConfig[];
  xKey?: string;
  height?: number;
  valueFormatter?: (value: number, name: string) => string;
  yTickFormatter?: (value: number) => string;
}) {
  return (
    <ChartFrame height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={xKey} tick={AXIS_STYLE} tickLine={false} axisLine={false} dy={6} />
          <YAxis
            tick={AXIS_STYLE}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={yTickFormatter}
          />
          <Tooltip content={<ChartTooltip formatter={valueFormatter} />} />
          <Legend
            verticalAlign="top"
            align="right"
            height={28}
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11.5, color: 'var(--color-text-secondary)' }}
          />
          {series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color ?? CHART_COLORS[i]}
              strokeWidth={2}
              dot={{ r: 2.5, strokeWidth: 0, fill: s.color ?? CHART_COLORS[i] }}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function ColumnChart({
  data,
  series,
  xKey = 'label',
  height = 260,
  stacked = false,
  valueFormatter,
  yTickFormatter,
}: {
  data: Array<Record<string, string | number>>;
  series: SeriesConfig[];
  xKey?: string;
  height?: number;
  stacked?: boolean;
  valueFormatter?: (value: number, name: string) => string;
  yTickFormatter?: (value: number) => string;
}) {
  return (
    <ChartFrame height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={xKey} tick={AXIS_STYLE} tickLine={false} axisLine={false} dy={6} />
          <YAxis
            tick={AXIS_STYLE}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={yTickFormatter}
          />
          <Tooltip
            cursor={{ fill: 'var(--color-surface-alt)' }}
            content={<ChartTooltip formatter={valueFormatter} />}
          />
          {series.length > 1 ? (
            <Legend
              verticalAlign="top"
              align="right"
              height={28}
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 11.5, color: 'var(--color-text-secondary)' }}
            />
          ) : null}
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={s.color ?? CHART_COLORS[i]}
              radius={[4, 4, 0, 0]}
              stackId={stacked ? 'stack' : undefined}
              maxBarSize={38}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
  href?: string;
}

export function DonutChart({
  data,
  centerValue,
  centerLabel,
  height = 200,
  innerRadius = 58,
  outerRadius = 82,
}: {
  data: DonutSlice[];
  centerValue?: string;
  centerLabel?: string;
  height?: number;
  innerRadius?: number;
  outerRadius?: number;
}) {
  // The chart is square. Fixing the width stops the responsive container from
  // collapsing to zero inside a flex row, which would render nothing.
  const total = data.reduce((sum, slice) => sum + slice.value, 0);
  const chartData = total > 0 ? data : [{ label: 'No data', value: 1, color: 'var(--color-border-base)' }];

  return (
    <div className="relative shrink-0" style={{ height, width: height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="label"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            paddingAngle={total > 0 ? 1 : 0}
            stroke="var(--color-surface)"
            strokeWidth={2}
          >
            {chartData.map((slice, index) => (
              <Cell key={index} fill={slice.color} />
            ))}
          </Pie>
          {total > 0 ? <Tooltip content={<ChartTooltip />} /> : null}
        </PieChart>
      </ResponsiveContainer>
      {centerValue ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[22px] font-semibold leading-7 text-[var(--color-text-primary)] tabular">
            {centerValue}
          </span>
          {centerLabel ? (
            <span className="text-[11px] text-[var(--color-text-secondary)]">{centerLabel}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Legend rows shown beside the donut, with value and share of total. */
export function DonutLegend({
  data,
  total,
  hrefBuilder,
}: {
  data: DonutSlice[];
  total: number;
  hrefBuilder?: (slice: DonutSlice) => string | undefined;
}) {
  return (
    <ul className="flex flex-col gap-2.5">
      {data.map((slice) => {
        const share = total > 0 ? Math.round((slice.value / total) * 100) : 0;
        const href = slice.href ?? hrefBuilder?.(slice);
        const row = (
          <div className="flex items-center gap-2.5">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: slice.color }}
              aria-hidden
            />
            <span className="flex-1 truncate text-[12.5px] text-[var(--color-text-secondary)]">
              {slice.label}
            </span>
            <span className="w-10 text-end text-[13px] font-semibold text-[var(--color-text-primary)] tabular">
              {slice.value.toLocaleString()}
            </span>
            <span className="w-10 text-end text-[12px] text-[var(--color-text-tertiary)] tabular">
              {share}%
            </span>
          </div>
        );
        return (
          <li key={slice.label}>
            {href ? (
              <a href={href} className="block rounded-[6px] transition-colors hover:bg-[var(--color-surface-muted)]">
                {row}
              </a>
            ) : (
              row
            )}
          </li>
        );
      })}
    </ul>
  );
}
