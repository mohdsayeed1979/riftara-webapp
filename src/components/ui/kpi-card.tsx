import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { ProgressRing } from './misc';

export type KpiTone = 'neutral' | 'success' | 'warning' | 'info' | 'error' | 'gold';

const TONE_STYLES: Record<KpiTone, { surface: string; icon: string; label: string; ring: string }> = {
  neutral: {
    surface: 'bg-[var(--color-surface-alt)] border-[var(--color-border-base)]',
    icon: 'bg-[var(--color-surface)] text-[var(--color-text-secondary)]',
    label: 'text-[var(--color-text-secondary)]',
    ring: 'var(--color-neutral)',
  },
  success: {
    surface: 'bg-[var(--color-success-soft)] border-[var(--color-success-border)]',
    icon: 'bg-white/70 text-[var(--color-success)]',
    label: 'text-[var(--color-success)]',
    ring: 'var(--color-success)',
  },
  warning: {
    surface: 'bg-[var(--color-warning-soft)] border-[var(--color-warning-border)]',
    icon: 'bg-white/70 text-[var(--color-warning)]',
    label: 'text-[#b97a08]',
    ring: 'var(--color-warning)',
  },
  info: {
    surface: 'bg-[var(--color-info-soft)] border-[var(--color-info-border)]',
    icon: 'bg-white/70 text-[var(--color-info)]',
    label: 'text-[var(--color-info)]',
    ring: 'var(--color-info)',
  },
  error: {
    surface: 'bg-[var(--color-error-soft)] border-[var(--color-error-border)]',
    icon: 'bg-white/70 text-[var(--color-error)]',
    label: 'text-[var(--color-error)]',
    ring: 'var(--color-error)',
  },
  gold: {
    surface: 'bg-[var(--color-gold-50)] border-[var(--color-gold-200)]',
    icon: 'bg-white/70 text-[var(--color-gold-600)]',
    label: 'text-[var(--color-gold-700)]',
    ring: 'var(--color-brand-gold)',
  },
};

export interface KpiCardProps {
  label: string;
  value: string;
  caption?: string;
  icon?: ReactNode;
  tone?: KpiTone;
  /** Percentage change versus the comparison period. */
  delta?: number | null;
  /** Set false when a rising value is bad (e.g. vacancy, OPEX). */
  higherIsBetter?: boolean;
  /** Renders the progress ring shown on the dashboard status cards. */
  ringValue?: number | null;
  /** Every important KPI drills down (BRD 69). */
  href?: string;
  className?: string;
}

export function KpiCard({
  label,
  value,
  caption,
  icon,
  tone = 'neutral',
  delta,
  higherIsBetter = true,
  ringValue,
  href,
  className,
}: KpiCardProps) {
  const styles = TONE_STYLES[tone];
  const hasDelta = typeof delta === 'number' && Number.isFinite(delta);
  const positive = hasDelta ? (higherIsBetter ? delta >= 0 : delta < 0) : true;
  const hasRing = typeof ringValue === 'number';

  const content = (
    <div
      className={cn(
        '@container flex h-full items-start gap-3 rounded-[var(--radius-card)] border p-4 transition-shadow',
        styles.surface,
        href && 'hover:shadow-[var(--shadow-card-hover)]',
        className,
      )}
    >
      {icon && !hasRing ? (
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-[10px] [&_svg]:size-4.5',
            styles.icon,
          )}
          aria-hidden
        >
          {icon}
        </span>
      ) : null}

      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-[11.5px] font-medium', styles.label)}>{label}</p>
        <p className="mt-1 text-[22px] font-semibold leading-8 text-[var(--color-text-primary)] tabular @[210px]:text-[24px]">
          {value}
        </p>
        <div className="mt-0.5 flex items-center gap-2">
          {caption ? (
            <span className="truncate text-[11.5px] text-[var(--color-text-secondary)]">{caption}</span>
          ) : null}
          {hasDelta ? (
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-0.5 text-[11.5px] font-medium tabular',
                positive ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]',
              )}
            >
              {delta >= 0 ? (
                <ArrowUpRight className="size-3" aria-hidden />
              ) : (
                <ArrowDownRight className="size-3" aria-hidden />
              )}
              {Math.abs(delta).toFixed(delta % 1 === 0 ? 0 : 1)}%
            </span>
          ) : null}
        </div>
      </div>

      {hasRing ? (
        <ProgressRing value={ringValue} color={styles.ring} label={`${label}: ${value}`} />
      ) : null}
    </div>
  );

  if (!href) return content;

  return (
    <Link href={href} className="block h-full rounded-[var(--radius-card)] focus-visible:outline-none">
      {content}
    </Link>
  );
}

/** Compact figure row used inside the Portfolio Value panel. */
export function MetricRow({
  label,
  value,
  tone,
  href,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'success' | 'error' | 'warning';
  href?: string;
}) {
  const valueClass = cn(
    'text-[13px] font-semibold tabular',
    tone === 'success' && 'text-[var(--color-success)]',
    tone === 'error' && 'text-[var(--color-error)]',
    tone === 'warning' && 'text-[#b97a08]',
    (!tone || tone === 'default') && 'text-[var(--color-text-primary)]',
  );

  const body = (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] py-2.5 last:border-b-0">
      <span className="text-[12.5px] text-[var(--color-text-secondary)]">{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  );

  if (!href) return body;
  return (
    <Link href={href} className="block transition-colors hover:bg-[var(--color-surface-muted)]">
      {body}
    </Link>
  );
}
