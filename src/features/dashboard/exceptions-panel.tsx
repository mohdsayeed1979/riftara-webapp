import { AlertTriangle, ArrowRight, CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { Card, CardHeader } from '@/components/ui/card';
import type { ExceptionItem } from '@/services/metrics-service';
import { cn } from '@/lib/utils';

/**
 * Executive exceptions (BRD 74, 147): overview → exception → drill down →
 * action. Every row links straight to the records that need attention.
 */
export function ExceptionsPanel({ exceptions }: { exceptions: ExceptionItem[] }) {
  return (
    <Card>
      <CardHeader
        title="Requires attention"
        description="Items breaching the thresholds configured under Settings › KPI Thresholds."
      />
      <ul className="divide-y divide-[var(--color-border-subtle)] border-t border-[var(--color-border-subtle)]">
        {exceptions.map((exception) => (
          <li key={exception.key}>
            <Link
              href={exception.href}
              className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-[var(--color-surface-muted)]"
            >
              <span
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-[10px]',
                  exception.severity === 'error'
                    ? 'bg-[var(--color-error-soft)] text-[var(--color-error)]'
                    : 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]',
                )}
                aria-hidden
              >
                {exception.severity === 'error' ? (
                  <CircleAlert className="size-4" />
                ) : (
                  <AlertTriangle className="size-4" />
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-[var(--color-text-primary)]">
                  {exception.title}
                </span>
                <span className="block truncate text-[11.5px] text-[var(--color-text-secondary)]">
                  {exception.detail}
                </span>
              </span>

              <span className="shrink-0 text-[12.5px] font-semibold text-[var(--color-text-primary)] tabular">
                {exception.value}
              </span>
              <ArrowRight
                className="size-4 shrink-0 text-[var(--color-text-tertiary)] rtl-flip"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
