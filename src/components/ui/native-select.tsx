'use client';

import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
}

const controlClass =
  'h-9.5 w-full rounded-[var(--radius-control)] border border-[var(--color-border-base)] bg-[var(--color-surface)] px-3 text-[13.5px] text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-strong)] focus:border-[var(--color-gold-400)] focus:outline-none focus:ring-2 focus:ring-[var(--color-gold-200)] disabled:cursor-not-allowed disabled:bg-[var(--color-surface-alt)] disabled:text-[var(--color-text-tertiary)] aria-[invalid=true]:border-[var(--color-error)]';

/** Styled native <select> that submits reliably via `name` and matches the
 *  design-system controls. Accepts either {value,label} options or {id,name}. */
export function NativeSelect({
  name,
  value,
  defaultValue,
  onChange,
  placeholder,
  options,
  invalid,
  disabled,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  options: ReadonlyArray<SelectOption | { id: string; name: string }>;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const normalized: SelectOption[] = options.map((o) =>
    'value' in o ? { value: o.value, label: o.label } : { value: o.id, label: o.name },
  );
  return (
    <select
      name={name}
      value={value}
      defaultValue={defaultValue}
      disabled={disabled}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      aria-invalid={invalid || undefined}
      className={cn(controlClass, 'appearance-none bg-[right_0.6rem_center] bg-no-repeat pe-8')}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239a9a9a' stroke-width='2'><path d='M6 9l6 6 6-6'/></svg>\")",
      }}
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {normalized.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
