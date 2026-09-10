import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Boxes,
  Building,
  Building2,
  ClipboardList,
  FileText,
  Home,
  KeyRound,
  ReceiptText,
  Search as SearchIcon,
  ShieldCheck,
  Users,
  UserSquare,
  Wallet,
  Wrench,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/page';
import { requireUser } from '@/lib/auth/guard';
import { cn } from '@/lib/utils';
import {
  MIN_QUERY_LENGTH,
  SEARCH_ENTITY_TYPES,
  isSearchEntityType,
  searchFlat,
  type NormalizedSearchResult,
} from '@/services/search-service';

export const metadata: Metadata = { title: 'Search' };
export const dynamic = 'force-dynamic';

const TYPE_META: Record<string, { label: string; icon: React.ReactNode }> = {
  property: { label: 'Properties', icon: <Building2 /> },
  building: { label: 'Buildings', icon: <Building /> },
  unit: { label: 'Units', icon: <Home /> },
  customer: { label: 'Customers', icon: <Users /> },
  tenant: { label: 'Tenants', icon: <UserSquare /> },
  lead: { label: 'Leads', icon: <ClipboardList /> },
  contract: { label: 'Contracts', icon: <FileText /> },
  invoice: { label: 'Invoices', icon: <ReceiptText /> },
  payment: { label: 'Payments', icon: <Wallet /> },
  work_order: { label: 'Maintenance', icon: <Wrench /> },
  asset: { label: 'Assets', icon: <ShieldCheck /> },
  ownership: { label: 'Ownership', icon: <KeyRound /> },
  document: { label: 'Documents', icon: <Boxes /> },
};

const PAGE_SIZE = 20;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; page?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const query = (params.q ?? '').trim();
  const activeType = params.type && isSearchEntityType(params.type) ? params.type : null;
  const page = Math.max(1, Number(params.page) || 1);

  const response =
    query.length >= MIN_QUERY_LENGTH
      ? await searchFlat(query, {
          organizationId: user.organizationId,
          permissions: user.permissions,
          allowedPropertyIds: user.scopedPropertyIds.length > 0 ? user.scopedPropertyIds : null,
        }, { type: activeType, page, pageSize: PAGE_SIZE })
      : { query, total: 0, page, pageSize: PAGE_SIZE, results: [] as NormalizedSearchResult[] };

  const chipHref = (type: string | null) => {
    const qs = new URLSearchParams();
    if (query) qs.set('q', query);
    if (type) qs.set('type', type);
    return `/search?${qs.toString()}`;
  };
  const pageHref = (target: number) => {
    const qs = new URLSearchParams();
    if (query) qs.set('q', query);
    if (activeType) qs.set('type', activeType);
    qs.set('page', String(target));
    return `/search?${qs.toString()}`;
  };

  // Group the current page's results by type for display (global rank preserved
  // for group ordering via SEARCH_ENTITY_TYPES).
  const grouped = SEARCH_ENTITY_TYPES.map((type) => ({
    type,
    items: response.results.filter((r) => r.type === type),
  })).filter((g) => g.items.length > 0);

  const totalPages = Math.max(1, Math.ceil(response.total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Search"
        subtitle={query.length >= MIN_QUERY_LENGTH ? `${response.total} result${response.total === 1 ? '' : 's'} for “${query}”` : 'Find any record across the portfolio.'}
      />

      <Card className="p-4">
        <form action="/search" method="get" className="flex items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-text-tertiary)]" aria-hidden />
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Search properties, units, customers, contracts, documents…"
              className="h-10 w-full rounded-[var(--radius-control)] border border-[var(--color-border-base)] bg-[var(--color-surface)] ps-9 pe-3 text-[14px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-gold-400)] focus:outline-none focus:ring-2 focus:ring-[var(--color-gold-200)]"
              autoFocus
            />
          </div>
          <Button type="submit"><SearchIcon />Search</Button>
        </form>
      </Card>

      {query.length >= MIN_QUERY_LENGTH ? (
        <>
          {/* Entity-type filters */}
          <div className="flex flex-wrap gap-1.5">
            <FilterChip href={chipHref(null)} active={!activeType} label="All" />
            {SEARCH_ENTITY_TYPES.map((type) => (
              <FilterChip key={type} href={chipHref(type)} active={activeType === type} label={TYPE_META[type]?.label ?? type} />
            ))}
          </div>

          {response.results.length === 0 ? (
            <Card>
              <EmptyState icon={<SearchIcon />} title="No results found" description="Try a different term, code, name, mobile number or reference." />
            </Card>
          ) : (
            <div className="flex flex-col gap-5">
              {grouped.map((group) => (
                <Card key={group.type}>
                  <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-4 py-3">
                    <span className="text-[var(--color-text-tertiary)] [&_svg]:size-4">{TYPE_META[group.type]?.icon}</span>
                    <h2 className="text-[13px] font-semibold text-[var(--color-text-primary)]">{TYPE_META[group.type]?.label ?? group.type}</h2>
                    <Badge tone="neutral" dot={false}>{group.items.length}</Badge>
                  </div>
                  <ul className="divide-y divide-[var(--color-border-subtle)]">
                    {group.items.map((item) => (
                      <li key={`${item.type}-${item.id}`}>
                        <Link href={item.url} className="flex items-center justify-between gap-4 px-4 py-2.5 hover:bg-[var(--color-surface-alt)]">
                          <span className="min-w-0">
                            <span className="block truncate text-[13.5px] font-medium text-[var(--color-text-primary)]">{item.title}</span>
                            {item.subtitle ? <span className="block truncate text-[12px] text-[var(--color-text-secondary)]">{item.subtitle}</span> : null}
                          </span>
                          {item.badge ? <Badge tone="neutral" dot={false} className="shrink-0 capitalize">{item.badge.replace(/_/g, ' ')}</Badge> : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}

              {totalPages > 1 ? (
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-[var(--color-text-secondary)]">Page {response.page} of {totalPages}</span>
                  <div className="flex gap-2">
                    {response.page > 1 ? <Button variant="secondary" size="sm" asChild><Link href={pageHref(response.page - 1)}>Previous</Link></Button> : null}
                    {response.page < totalPages ? <Button variant="secondary" size="sm" asChild><Link href={pageHref(response.page + 1)}>Next</Link></Button> : null}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </>
      ) : (
        <Card>
          <EmptyState icon={<SearchIcon />} title="Start typing to search" description={`Enter at least ${MIN_QUERY_LENGTH} characters.`} />
        </Card>
      )}
    </div>
  );
}

function FilterChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={cn(
        'rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
        active
          ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
          : 'border-[var(--color-border-base)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]',
      )}
    >
      {label}
    </Link>
  );
}
