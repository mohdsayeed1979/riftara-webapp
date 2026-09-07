import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral:
          'bg-[var(--color-neutral-soft)] text-[var(--color-text-secondary)] border-[var(--color-neutral-border)]',
        success:
          'bg-[var(--color-success-soft)] text-[var(--color-success)] border-[var(--color-success-border)]',
        warning:
          'bg-[var(--color-warning-soft)] text-[#b97a08] border-[var(--color-warning-border)]',
        error: 'bg-[var(--color-error-soft)] text-[var(--color-error)] border-[var(--color-error-border)]',
        info: 'bg-[var(--color-info-soft)] text-[var(--color-info)] border-[var(--color-info-border)]',
        gold: 'bg-[var(--color-gold-100)] text-[var(--color-gold-700)] border-[var(--color-gold-200)]',
        espresso:
          'bg-[var(--color-espresso-800)] text-[var(--color-text-inverse)] border-[var(--color-espresso-800)]',
        outline: 'bg-transparent text-[var(--color-text-secondary)] border-[var(--color-border-strong)]',
      },
      size: {
        sm: 'px-2 py-0.5 text-[11px] leading-4',
        md: 'px-2.5 py-1 text-[11.5px] leading-4',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'sm' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
  icon?: ReactNode;
}

export function Badge({ className, tone, size, dot, icon, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size }), className)} {...props}>
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden /> : null}
      {icon}
      {children}
    </span>
  );
}

export { badgeVariants };
