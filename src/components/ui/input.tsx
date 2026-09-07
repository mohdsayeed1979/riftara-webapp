'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import { Search } from 'lucide-react';
import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const controlBase =
  'w-full rounded-[var(--radius-control)] border border-[var(--color-border-base)] bg-[var(--color-surface)] text-[13.5px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] transition-colors hover:border-[var(--color-border-strong)] focus:border-[var(--color-gold-400)] focus:outline-none focus:ring-2 focus:ring-[var(--color-gold-200)] disabled:cursor-not-allowed disabled:bg-[var(--color-surface-alt)] disabled:text-[var(--color-text-tertiary)] aria-[invalid=true]:border-[var(--color-error)] aria-[invalid=true]:ring-[var(--color-error-soft)]';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(controlBase, 'h-9.5 px-3', className)} {...props} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 4, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={cn(controlBase, 'px-3 py-2 leading-5 resize-y', className)}
        {...props}
      />
    );
  },
);

export const Label = forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & { required?: boolean }
>(function Label({ className, required, children, ...props }, ref) {
  return (
    <LabelPrimitive.Root
      ref={ref}
      className={cn(
        'text-[12.5px] font-medium text-[var(--color-text-secondary)] peer-disabled:opacity-60',
        className,
      )}
      {...props}
    >
      {children}
      {required ? (
        <span className="ms-0.5 text-[var(--color-error)]" aria-hidden>
          *
        </span>
      ) : null}
    </LabelPrimitive.Root>
  );
});

/** Label + control + validation message, the standard form row. */
export function Field({
  label,
  htmlFor,
  required,
  error,
  hint,
  children,
  className,
}: {
  label?: ReactNode;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label ? (
        <Label htmlFor={htmlFor} required={required}>
          {label}
        </Label>
      ) : null}
      {children}
      {error ? (
        <p className="text-[11.5px] text-[var(--color-error)]" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[11.5px] text-[var(--color-text-tertiary)]">{hint}</p>
      ) : null}
    </div>
  );
}

export function SearchInput({
  className,
  containerClassName,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { containerClassName?: string }) {
  return (
    <div className={cn('relative', containerClassName)}>
      <Search
        className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-text-tertiary)]"
        aria-hidden
      />
      <Input type="search" className={cn('ps-9', className)} {...props} />
    </div>
  );
}
