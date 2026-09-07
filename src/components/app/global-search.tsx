'use client';

import { Loader2, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { cn } from '@/lib/utils';

export interface SearchResultItem {
  id: string;
  title: string;
  subtitle?: string | null;
  href: string;
  badge?: string | null;
}

export interface SearchResultGroup {
  entityType: string;
  label: string;
  items: SearchResultItem[];
}

/**
 * Global search (BRD 131). Results are grouped by entity type and every result
 * navigates to the underlying record.
 */
export function GlobalSearch({ className }: { className?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<SearchResultGroup[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const flatItems = groups.flatMap((group) => group.items);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setGroups([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/v1/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Search failed');
        const payload = (await response.json()) as { data: SearchResultGroup[] };
        setGroups(payload.data ?? []);
        setActiveIndex(0);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setGroups([]);
      } finally {
        setLoading(false);
      }
    }, 220);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const navigate = useCallback(
    (href: string) => {
      setOpen(false);
      setQuery('');
      router.push(href);
    },
    [router],
  );

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || flatItems.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % flatItems.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + flatItems.length) % flatItems.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = flatItems[activeIndex];
      if (item) navigate(item.href);
    }
  }

  let runningIndex = -1;

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-text-tertiary)]"
          aria-hidden
        />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls="global-search-results"
          aria-autocomplete="list"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t('common.searchPlaceholder')}
          className="h-9.5 w-full rounded-[var(--radius-control)] border border-[var(--color-border-base)] bg-[var(--color-surface)] ps-9 pe-16 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-gold-400)] focus:outline-none focus:ring-2 focus:ring-[var(--color-gold-200)]"
        />
        <span className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2">
          {loading ? (
            <Loader2 className="size-3.5 animate-spin text-[var(--color-text-tertiary)]" aria-hidden />
          ) : (
            <kbd className="rounded border border-[var(--color-border-base)] bg-[var(--color-surface-alt)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-tertiary)]">
              ⌘K
            </kbd>
          )}
        </span>
      </div>

      {open && query.trim().length >= 2 ? (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute inset-x-0 top-full z-50 mt-1.5 max-h-[70vh] overflow-y-auto rounded-[var(--radius-card)] border border-[var(--color-border-base)] bg-[var(--color-surface)] py-1.5 shadow-[var(--shadow-overlay)]"
        >
          {groups.length === 0 && !loading ? (
            <p className="px-4 py-6 text-center text-[12.5px] text-[var(--color-text-secondary)]">
              {t('common.noResults')}
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.entityType} className="pb-1">
                <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-tertiary)]">
                  {group.label}
                </p>
                {group.items.map((item) => {
                  runningIndex += 1;
                  const isActive = runningIndex === activeIndex;
                  return (
                    <button
                      key={`${group.entityType}-${item.id}`}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onClick={() => navigate(item.href)}
                      className={cn(
                        'flex w-full items-center gap-3 px-3 py-2 text-start transition-colors',
                        isActive ? 'bg-[var(--color-surface-alt)]' : 'hover:bg-[var(--color-surface-muted)]',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-[var(--color-text-primary)]">
                          {item.title}
                        </span>
                        {item.subtitle ? (
                          <span className="block truncate text-[11.5px] text-[var(--color-text-secondary)]">
                            {item.subtitle}
                          </span>
                        ) : null}
                      </span>
                      {item.badge ? (
                        <span className="shrink-0 rounded-full bg-[var(--color-surface-alt)] px-2 py-0.5 text-[10.5px] text-[var(--color-text-secondary)]">
                          {item.badge}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
