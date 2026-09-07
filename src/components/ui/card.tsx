import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { interactive?: boolean }>(
  function Card({ className, interactive, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          'surface-card',
          interactive &&
            'transition-shadow hover:shadow-[var(--shadow-card-hover)] focus-within:shadow-[var(--shadow-card-hover)]',
          className,
        )}
        {...props}
      />
    );
  },
);

export function CardHeader({
  title,
  description,
  action,
  className,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 px-5 pt-4 pb-3',
        className,
      )}
    >
      <div className="min-w-0">
        {title ? (
          <h3 className="text-[15px] font-semibold text-[var(--color-text-primary)] tracking-[-0.01em]">
            {title}
          </h3>
        ) : null}
        {description ? (
          <p className="mt-0.5 text-[12.5px] text-[var(--color-text-secondary)]">{description}</p>
        ) : null}
        {children}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pb-5', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 border-t border-[var(--color-border-subtle)] px-5 py-3',
        className,
      )}
      {...props}
    />
  );
}

/** Section divider inside a card, used between grouped field sets. */
export function CardDivider({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-[var(--color-border-subtle)]', className)} />;
}
