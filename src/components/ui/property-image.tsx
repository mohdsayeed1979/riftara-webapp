import { Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Property/unit thumbnail. When no image is stored it renders a branded
 * placeholder rather than a broken image — the seed ships without binary
 * assets, so this is the normal path in the demo.
 */
export function PropertyImage({
  src,
  alt,
  className,
  iconClassName,
}: {
  src?: string | null;
  alt: string;
  className?: string;
  iconClassName?: string;
}) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} className={cn('object-cover', className)} loading="lazy" />;
  }
  return (
    <div
      className={cn(
        'flex items-center justify-center bg-gradient-to-br from-[var(--color-espresso-100)] to-[var(--color-espresso-200)]',
        className,
      )}
      role="img"
      aria-label={alt}
    >
      <Building2 className={cn('size-6 text-[var(--color-espresso-400)]', iconClassName)} aria-hidden />
    </div>
  );
}
