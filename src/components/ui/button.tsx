import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:bg-[var(--color-espresso-900)] active:bg-[var(--color-espresso-950)] shadow-[var(--shadow-card)]',
        secondary:
          'bg-[var(--color-surface)] text-[var(--color-text-primary)] border border-[var(--color-border-strong)] hover:bg-[var(--color-surface-alt)]',
        ghost:
          'bg-transparent text-[var(--color-text-primary)] hover:bg-[var(--color-surface-alt)] border border-transparent',
        outline:
          'bg-transparent text-[var(--color-text-primary)] border border-[var(--color-border-base)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-alt)]',
        gold: 'bg-[var(--color-brand-gold)] text-[var(--color-espresso-900)] hover:bg-[var(--color-gold-500)] font-semibold',
        destructive:
          'bg-[var(--color-error)] text-white hover:bg-[#d93b3b] shadow-[var(--shadow-card)]',
        success: 'bg-[var(--color-success)] text-white hover:bg-[#128a3e]',
        link: 'bg-transparent text-[var(--color-secondary)] underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        sm: 'h-8 px-3 text-[13px] [&_svg]:size-3.5',
        md: 'h-9.5 px-4 text-[13.5px] [&_svg]:size-4',
        lg: 'h-11 px-6 text-sm [&_svg]:size-4.5',
        icon: 'h-9.5 w-9.5 [&_svg]:size-4',
        'icon-sm': 'h-8 w-8 [&_svg]:size-3.5',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, loading = false, disabled, children, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="animate-spin" aria-hidden />
          {children}
        </>
      ) : (
        children
      )}
    </Comp>
  );
});

export { buttonVariants };
