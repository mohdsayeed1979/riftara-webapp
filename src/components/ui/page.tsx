import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className={cn('flex items-center gap-1 text-[12px]', className)}>
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1">
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={
                    isLast ? 'font-medium text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'
                  }
                  aria-current={isLast ? 'page' : undefined}
                >
                  {item.label}
                </span>
              )}
              {!isLast ? (
                <ChevronRight
                  className="size-3.5 text-[var(--color-text-tertiary)] rtl-flip"
                  aria-hidden
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function PageHeader({
  title,
  subtitle,
  breadcrumbs,
  actions,
  badge,
  meta,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
  badge?: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-5', className)}>
      {breadcrumbs?.length ? <Breadcrumbs items={breadcrumbs} className="mb-3" /> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[26px] font-semibold leading-9 tracking-[-0.02em] text-[var(--color-text-primary)]">
              {title}
            </h1>
            {badge}
          </div>
          {subtitle ? (
            <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">{subtitle}</p>
          ) : null}
          {meta ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-[var(--color-text-secondary)]">
              {meta}
            </div>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/** Single fact in a detail header, e.g. "Riyadh, Saudi Arabia". */
export function MetaItem({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 [&_svg]:size-3.5 [&_svg]:text-[var(--color-text-tertiary)]">
      {icon}
      {children}
    </span>
  );
}

/** Responsive KPI strip: 5 across on desktop, stacking down to 1 on mobile. */
export function KpiGrid({
  columns = 5,
  className,
  children,
}: {
  columns?: 3 | 4 | 5 | 6;
  className?: string;
  children: ReactNode;
}) {
  const layouts = {
    3: 'sm:grid-cols-2 lg:grid-cols-3',
    4: 'sm:grid-cols-2 lg:grid-cols-4',
    5: 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5',
    // Six across only on very wide screens; three keeps figures readable at 1440px.
    6: 'sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6',
  } as const;
  return <div className={cn('grid grid-cols-1 gap-3', layouts[columns], className)}>{children}</div>;
}

export function SectionTitle({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-3', className)}>
      <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">{children}</h2>
      {action}
    </div>
  );
}

/** Label/value pair used across all detail panels. */
export function DetailRow({
  label,
  value,
  href,
  className,
}: {
  label: string;
  value: ReactNode;
  href?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-[var(--color-border-subtle)] py-2.5 last:border-b-0',
        className,
      )}
    >
      <dt className="shrink-0 text-[12.5px] text-[var(--color-text-secondary)]">{label}</dt>
      <dd className="min-w-0 text-end text-[13px] font-medium text-[var(--color-text-primary)]">
        {href ? (
          <Link href={href} className="text-[var(--color-info)] hover:underline">
            {value}
          </Link>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

export function DetailList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('flex flex-col', className)}>{children}</dl>;
}
