'use client';

import { LayoutGrid, List, RotateCcw, Search } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterDefinition {
  key: string;
  placeholder: string;
  options: FilterOption[];
}

/**
 * URL-driven filter bar. All state lives in the query string so a filtered
 * view is shareable, bookmarkable and server-rendered (BRD 132).
 */
export function FilterBar({
  searchPlaceholder,
  filters,
  view,
  extra,
}: {
  searchPlaceholder: string;
  filters: FilterDefinition[];
  view?: { current: 'grid' | 'list' };
  extra?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [searchValue, setSearchValue] = useState(searchParams.get('search') ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSearchValue(searchParams.get('search') ?? '');
  }, [searchParams]);

  function commit(next: URLSearchParams) {
    next.delete('page');
    const query = next.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
  }

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams.toString());
    if (!value || value === '__all__') next.delete(key);
    else next.set(key, value);
    commit(next);
  }

  function onSearchChange(value: string) {
    setSearchValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setParam('search', value.trim() || null), 300);
  }

  const hasActiveFilters =
    filters.some((filter) => searchParams.get(filter.key)) || Boolean(searchParams.get('search'));

  function clearAll() {
    const next = new URLSearchParams();
    if (view && searchParams.get('view')) next.set('view', searchParams.get('view') as string);
    startTransition(() => router.push(next.toString() ? `${pathname}?${next.toString()}` : pathname));
    setSearchValue('');
  }

  function setView(mode: 'grid' | 'list') {
    setParam('view', mode);
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-pending={pending || undefined}>
      <div className="relative min-w-52 flex-1">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-text-tertiary)]"
          aria-hidden
        />
        <input
          type="search"
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          className="h-9.5 w-full rounded-[var(--radius-control)] border border-[var(--color-border-base)] bg-[var(--color-surface)] ps-9 pe-3 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-gold-400)] focus:outline-none focus:ring-2 focus:ring-[var(--color-gold-200)]"
        />
      </div>

      {filters.map((filter) => (
        <Select
          key={filter.key}
          value={searchParams.get(filter.key) ?? '__all__'}
          onValueChange={(value) => setParam(filter.key, value)}
        >
          <SelectTrigger className="w-auto min-w-36 bg-[var(--color-surface)]">
            <SelectValue placeholder={filter.placeholder} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{filter.placeholder}</SelectItem>
            {filter.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}

      {hasActiveFilters ? (
        <button
          type="button"
          onClick={clearAll}
          className="inline-flex h-9.5 items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 text-[12.5px] font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-alt)]"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Clear filters
        </button>
      ) : null}

      <div className="ms-auto flex items-center gap-2">
        {extra}
        {view ? (
          <div className="flex overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-border-base)]">
            <button
              type="button"
              onClick={() => setView('grid')}
              aria-pressed={view.current === 'grid'}
              aria-label="Grid view"
              className={cn(
                'flex size-9 items-center justify-center transition-colors',
                view.current === 'grid'
                  ? 'bg-[var(--color-surface-alt)] text-[var(--color-text-primary)]'
                  : 'bg-[var(--color-surface)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]',
              )}
            >
              <LayoutGrid className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setView('list')}
              aria-pressed={view.current === 'list'}
              aria-label="List view"
              className={cn(
                'flex size-9 items-center justify-center border-s border-[var(--color-border-base)] transition-colors',
                view.current === 'list'
                  ? 'bg-[var(--color-surface-alt)] text-[var(--color-text-primary)]'
                  : 'bg-[var(--color-surface)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]',
              )}
            >
              <List className="size-4" aria-hidden />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
