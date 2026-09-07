import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { HTMLAttributes, ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from './misc';

/**
 * Accessible data table primitives. Wide tables scroll inside their own
 * container so the page body never scrolls horizontally.
 */

export function TableContainer({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('w-full overflow-x-auto', className)}>{children}</div>;
}

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full min-w-full border-collapse text-[13px]', className)} {...props} />;
}

export function THead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn('border-b border-[var(--color-border-base)] bg-[var(--color-surface-muted)]', className)}
      {...props}
    />
  );
}

export function TBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-[var(--color-border-subtle)]', className)} {...props} />;
}

export function TR({
  className,
  interactive,
  ...props
}: HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }) {
  return (
    <tr
      className={cn(
        interactive && 'cursor-pointer transition-colors hover:bg-[var(--color-surface-muted)]',
        className,
      )}
      {...props}
    />
  );
}

export function TH({
  className,
  alignment = 'start',
  ...props
}: Omit<ThHTMLAttributes<HTMLTableCellElement>, 'align'> & {
  alignment?: 'start' | 'center' | 'end';
}) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap px-4 py-2.5 text-[11.5px] font-medium text-[var(--color-text-secondary)]',
        alignment === 'start' && 'text-start',
        alignment === 'center' && 'text-center',
        alignment === 'end' && 'text-end',
        className,
      )}
      {...props}
    />
  );
}

export function TD({
  className,
  alignment = 'start',
  numeric,
  ...props
}: Omit<TdHTMLAttributes<HTMLTableCellElement>, 'align'> & {
  alignment?: 'start' | 'center' | 'end';
  numeric?: boolean;
}) {
  return (
    <td
      className={cn(
        'px-4 py-3 text-[13px] text-[var(--color-text-primary)]',
        alignment === 'start' && 'text-start',
        alignment === 'center' && 'text-center',
        alignment === 'end' && 'text-end',
        numeric && 'tabular',
        className,
      )}
      {...props}
    />
  );
}

export function TableSkeleton({ rows = 5, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div className="divide-y divide-[var(--color-border-subtle)]">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-4 px-4 py-3.5">
          {Array.from({ length: columns }).map((__, colIndex) => (
            <Skeleton key={colIndex} className={cn('h-3.5', colIndex === 0 ? 'w-40' : 'w-20')} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pagination                                                                  */
/* -------------------------------------------------------------------------- */

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  /** Builds the href for a page — keeps pagination server-rendered and linkable. */
  buildHref: (page: number) => string;
  labels?: { showing: string; of: string; previous: string; next: string };
}

export function Pagination({ page, pageSize, total, buildHref, labels }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const text = labels ?? { showing: 'Showing', of: 'of', previous: 'Previous', next: 'Next' };

  const pages = buildPageList(page, totalPages);

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border-subtle)] px-4 py-3"
      aria-label="Pagination"
    >
      <p className="text-[12px] text-[var(--color-text-secondary)] tabular">
        {text.showing} {from}-{to} {text.of} {total.toLocaleString()}
      </p>
      <div className="flex items-center gap-1">
        <PageLink
          href={buildHref(page - 1)}
          disabled={page <= 1}
          label={text.previous}
          icon={<ChevronLeft className="size-4 rtl-flip" aria-hidden />}
        />
        {pages.map((entry, index) =>
          entry === 'ellipsis' ? (
            <span key={`gap-${index}`} className="px-1.5 text-[12px] text-[var(--color-text-tertiary)]">
              …
            </span>
          ) : (
            <Link
              key={entry}
              href={buildHref(entry)}
              aria-current={entry === page ? 'page' : undefined}
              className={cn(
                'inline-flex h-8 min-w-8 items-center justify-center rounded-[6px] px-2 text-[12.5px] font-medium transition-colors',
                entry === page
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]',
              )}
            >
              {entry}
            </Link>
          ),
        )}
        <PageLink
          href={buildHref(page + 1)}
          disabled={page >= totalPages}
          label={text.next}
          icon={<ChevronRight className="size-4 rtl-flip" aria-hidden />}
        />
      </div>
    </nav>
  );
}

function PageLink({
  href,
  disabled,
  label,
  icon,
}: {
  href: string;
  disabled: boolean;
  label: string;
  icon: ReactNode;
}) {
  const className =
    'inline-flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--color-text-secondary)] transition-colors';
  if (disabled) {
    return (
      <span className={cn(className, 'cursor-not-allowed opacity-40')} aria-disabled aria-label={label}>
        {icon}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} className={cn(className, 'hover:bg-[var(--color-surface-alt)]')}>
      {icon}
    </Link>
  );
}

function buildPageList(current: number, total: number): Array<number | 'ellipsis'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: Array<number | 'ellipsis'> = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push('ellipsis');
  for (let i = start; i <= end; i += 1) pages.push(i);
  if (end < total - 1) pages.push('ellipsis');
  pages.push(total);
  return pages;
}
