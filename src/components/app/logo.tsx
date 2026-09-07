import { cn } from '@/lib/utils';

/**
 * RIFTARA wordmark. Letter-spaced serif capitals in brand gold over espresso,
 * matching the design package cover and sidebar treatment.
 */
export function RiftaraLogo({
  subtitle = 'LEASING PORTAL',
  compact = false,
  tone = 'light',
  className,
}: {
  subtitle?: string;
  compact?: boolean;
  tone?: 'light' | 'dark';
  className?: string;
}) {
  if (compact) {
    return (
      <span
        className={cn(
          'font-[var(--font-serif)] text-[19px] font-bold leading-none tracking-[0.08em]',
          tone === 'light' ? 'text-[var(--color-brand-gold)]' : 'text-[var(--color-espresso-800)]',
          className,
        )}
        aria-label="RIFTARA"
      >
        R
      </span>
    );
  }

  return (
    <span className={cn('flex flex-col', className)}>
      <span
        className={cn(
          'font-[var(--font-serif)] text-[21px] font-bold leading-none tracking-[0.16em]',
          tone === 'light' ? 'text-[var(--color-brand-gold)]' : 'text-[var(--color-espresso-800)]',
        )}
      >
        RIFTARA
      </span>
      {subtitle ? (
        <span
          className={cn(
            'mt-1 text-[8.5px] font-medium leading-none tracking-[0.24em]',
            tone === 'light'
              ? 'text-[var(--color-sidebar-foreground)]/70'
              : 'text-[var(--color-text-tertiary)]',
          )}
        >
          {subtitle}
        </span>
      ) : null}
    </span>
  );
}
