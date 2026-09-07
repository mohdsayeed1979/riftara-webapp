import type { Locale } from '@/i18n/config';

/**
 * Locale-aware formatting. Every currency, number, area, percentage and date
 * shown in the UI passes through here so English/Arabic and SAR presentation
 * stay consistent across the platform.
 */

const localeTag: Record<Locale, string> = { en: 'en-US', ar: 'ar-SA' };

function tag(locale: Locale = 'en'): string {
  return localeTag[locale] ?? 'en-US';
}

export function formatCurrency(
  value: number | null | undefined,
  options: { locale?: Locale; currency?: string; decimals?: number; compact?: boolean } = {},
): string {
  const { locale = 'en', currency = 'SAR', decimals = 0, compact = false } = options;
  const amount = value ?? 0;
  const formatted = new Intl.NumberFormat(tag(locale), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    notation: compact ? 'compact' : 'standard',
    compactDisplay: 'short',
  }).format(amount);
  return `${currency} ${formatted}`;
}

/** Executive-scale money: SAR 2.8B / SAR 180.0M / SAR 450.5K. */
export function formatCompactCurrency(
  value: number | null | undefined,
  options: { locale?: Locale; currency?: string } = {},
): string {
  const { locale = 'en', currency = 'SAR' } = options;
  const amount = value ?? 0;
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';

  const units: Array<[number, string]> = [
    [1_000_000_000, 'B'],
    [1_000_000, 'M'],
    [1_000, 'K'],
  ];
  for (const [threshold, suffix] of units) {
    if (abs >= threshold) {
      const scaled = abs / threshold;
      const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
      return `${currency} ${sign}${trimZeros(scaled.toFixed(decimals))}${suffix}`;
    }
  }
  return `${currency} ${sign}${new Intl.NumberFormat(tag(locale)).format(abs)}`;
}

function trimZeros(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

export function formatNumber(
  value: number | null | undefined,
  options: { locale?: Locale; decimals?: number } = {},
): string {
  const { locale = 'en', decimals = 0 } = options;
  return new Intl.NumberFormat(tag(locale), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value ?? 0);
}

export function formatPercent(
  value: number | null | undefined,
  options: { locale?: Locale; decimals?: number } = {},
): string {
  const { locale = 'en', decimals = 0 } = options;
  return `${new Intl.NumberFormat(tag(locale), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value ?? 0)}%`;
}

/** Signed delta for trend indicators: +12% / -5%. */
export function formatDelta(value: number | null | undefined, decimals = 0): string {
  const amount = value ?? 0;
  const sign = amount > 0 ? '+' : '';
  return `${sign}${amount.toFixed(decimals)}%`;
}

export function formatArea(
  value: number | null | undefined,
  options: { locale?: Locale; decimals?: number } = {},
): string {
  const { locale = 'en', decimals = 0 } = options;
  return `${formatNumber(value, { locale, decimals })} m²`;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(
  value: Date | string | null | undefined,
  options: { locale?: Locale; style?: 'short' | 'medium' | 'long' } = {},
): string {
  const date = toDate(value);
  if (!date) return '—';
  const { locale = 'en', style = 'medium' } = options;
  const formats: Record<string, Intl.DateTimeFormatOptions> = {
    short: { day: '2-digit', month: '2-digit', year: 'numeric' },
    medium: { day: 'numeric', month: 'short', year: 'numeric' },
    long: { day: 'numeric', month: 'long', year: 'numeric' },
  };
  return new Intl.DateTimeFormat(tag(locale), formats[style]).format(date);
}

export function formatDateTime(
  value: Date | string | null | undefined,
  options: { locale?: Locale } = {},
): string {
  const date = toDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat(tag(options.locale ?? 'en'), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatMonth(
  value: Date | string | null | undefined,
  options: { locale?: Locale } = {},
): string {
  const date = toDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat(tag(options.locale ?? 'en'), {
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/** Compact relative time for activity feeds: "2h ago", "3d ago". */
export function formatRelativeTime(
  value: Date | string | null | undefined,
  options: { locale?: Locale; now?: Date } = {},
): string {
  const date = toDate(value);
  if (!date) return '—';
  const now = options.now ?? new Date();
  const diffSeconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(tag(options.locale ?? 'en'), { numeric: 'auto' });

  const divisions: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.34524, 'week'],
    [12, 'month'],
    [Number.POSITIVE_INFINITY, 'year'],
  ];

  let duration = diffSeconds;
  for (const [amount, unit] of divisions) {
    if (Math.abs(duration) < amount) return formatter.format(Math.round(duration), unit);
    duration /= amount;
  }
  return formatter.format(Math.round(duration), 'year');
}

export function daysBetween(from: Date | string, to: Date | string): number {
  const a = toDate(from);
  const b = toDate(to);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Days from today until `value`; negative when in the past. */
export function daysUntil(value: Date | string | null | undefined, now = new Date()): number {
  const date = toDate(value);
  if (!date) return 0;
  return Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
}

export function formatDuration(hours: number | null | undefined): string {
  const value = hours ?? 0;
  if (value < 24) return `${value.toFixed(1)}h`;
  return `${(value / 24).toFixed(1)} days`;
}

/** ISO date string (YYYY-MM-DD) as stored in PostgreSQL `date` columns. */
export function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
