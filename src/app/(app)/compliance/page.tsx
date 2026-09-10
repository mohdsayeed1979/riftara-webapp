import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, Boxes, CalendarClock, FileText, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { EmptyState } from '@/components/ui/misc';
import { KpiGrid, PageHeader } from '@/components/ui/page';
import { Pagination, Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { can, requireUser } from '@/lib/auth/guard';
import { formatDate } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { cn } from '@/lib/utils';
import {
  COMPLIANCE_CATEGORIES,
  getComplianceItems,
  isComplianceCategory,
  type ComplianceCategory,
  type ComplianceStatusFilter,
} from '@/services/compliance-service';

export const metadata: Metadata = { title: 'Compliance' };
export const dynamic = 'force-dynamic';

const CATEGORY_LABEL: Record<ComplianceCategory, string> = { document: 'Documents', warranty: 'Warranties', contract: 'Contracts' };
const STATUS_FILTERS: ComplianceStatusFilter[] = ['all', 'expiring', 'expired'];
const STATUS_LABEL: Record<ComplianceStatusFilter, string> = { all: 'All', expiring: 'Expiring soon', expired: 'Expired' };
const PAGE_SIZE = 20;

export default async function CompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; filter?: string; page?: string }>;
}) {
  const user = await requireUser();
  const locale = await getRequestLocale();
  const params = await searchParams;

  const canView = can(user, 'documents:view') || can(user, 'assets:view') || can(user, 'contracts:view');
  if (!canView) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Compliance" subtitle="Expiry tracking across documents, warranties and contracts." />
        <Card>
          <EmptyState icon={<ShieldAlert />} title="No access" description="You do not have permission to view compliance data." />
        </Card>
      </div>
    );
  }

  const activeType = params.type && isComplianceCategory(params.type) ? params.type : null;
  const activeFilter: ComplianceStatusFilter = params.filter && STATUS_FILTERS.includes(params.filter as ComplianceStatusFilter) ? (params.filter as ComplianceStatusFilter) : 'all';
  const page = Math.max(1, Number(params.page) || 1);

  const result = await getComplianceItems(
    { organizationId: user.organizationId, permissions: user.permissions, allowedPropertyIds: user.scopedPropertyIds.length > 0 ? user.scopedPropertyIds : null },
    { type: activeType, filter: activeFilter, page, pageSize: PAGE_SIZE },
  );

  const chip = (next: { type?: string | null; filter?: string | null }) => {
    const qs = new URLSearchParams();
    const type = next.type !== undefined ? next.type : activeType;
    const filter = next.filter !== undefined ? next.filter : activeFilter;
    if (type) qs.set('type', type);
    if (filter && filter !== 'all') qs.set('filter', filter);
    return `/compliance${qs.toString() ? `?${qs.toString()}` : ''}`;
  };
  const buildHref = (target: number) => {
    const qs = new URLSearchParams();
    if (activeType) qs.set('type', activeType);
    if (activeFilter !== 'all') qs.set('filter', activeFilter);
    qs.set('page', String(target));
    return `/compliance?${qs.toString()}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Compliance" subtitle="Approaching and overdue expiries across documents, warranties and contracts." />

      <KpiGrid columns={5}>
        <KpiCard label="Expiring Soon" value={String(result.kpis.expiringSoon)} icon={<CalendarClock />} tone="warning" higherIsBetter={false} />
        <KpiCard label="Expired" value={String(result.kpis.expired)} icon={<AlertTriangle />} tone="error" higherIsBetter={false} />
        <KpiCard label="Documents" value={String(result.kpis.documents)} icon={<FileText />} tone="neutral" />
        <KpiCard label="Warranties" value={String(result.kpis.warranties)} icon={<ShieldCheck />} tone="neutral" />
        <KpiCard label="Contracts" value={String(result.kpis.contracts)} icon={<Boxes />} tone="neutral" />
      </KpiGrid>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          <FilterChip href={chip({ type: null })} active={!activeType} label="All" />
          {COMPLIANCE_CATEGORIES.map((c) => (
            <FilterChip key={c} href={chip({ type: c })} active={activeType === c} label={CATEGORY_LABEL[c]} />
          ))}
        </div>
        <span className="hidden h-4 w-px bg-[var(--color-border-base)] sm:inline-block" />
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((s) => (
            <FilterChip key={s} href={chip({ filter: s })} active={activeFilter === s} label={STATUS_LABEL[s]} subtle />
          ))}
        </div>
      </div>

      <Card>
        {result.items.length === 0 ? (
          <EmptyState icon={<ShieldCheck />} title="Nothing needs attention" description="No documents, warranties or contracts match the selected filters." />
        ) : (
          <>
            <TableContainer>
              <Table>
                <THead>
                  <TR>
                    <TH>Category</TH>
                    <TH>Record</TH>
                    <TH>Context</TH>
                    <TH alignment="end">Expiry</TH>
                    <TH alignment="end">Remaining</TH>
                    <TH alignment="center">Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {result.items.map((item) => (
                    <TR key={`${item.category}-${item.id}`} interactive>
                      <TD><Badge tone="neutral" dot={false}>{item.badge}</Badge></TD>
                      <TD>
                        <Link href={item.href} className="font-medium hover:text-[var(--color-info)]">{item.title}</Link>
                        {item.subtitle ? <span className="block text-[11px] text-[var(--color-text-tertiary)]">{item.subtitle}</span> : null}
                      </TD>
                      <TD className="text-[var(--color-text-secondary)]">{item.propertyName ?? '—'}</TD>
                      <TD alignment="end" className="whitespace-nowrap">{formatDate(item.expiryDate, { locale, style: 'medium' })}</TD>
                      <TD alignment="end" numeric className={item.daysRemaining < 0 ? 'text-[var(--color-error)]' : 'text-[var(--color-text-secondary)]'}>
                        {item.daysRemaining < 0 ? `${Math.abs(item.daysRemaining)}d overdue` : `${item.daysRemaining}d`}
                      </TD>
                      <TD alignment="center">
                        <Badge tone={item.status === 'expired' ? 'error' : 'warning'} dot={false}>{item.status === 'expired' ? 'Expired' : 'Expiring'}</Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
            <Pagination page={result.page} pageSize={result.pageSize} total={result.total} buildHref={buildHref} />
          </>
        )}
      </Card>
    </div>
  );
}

function FilterChip({ href, active, label, subtle }: { href: string; active: boolean; label: string; subtle?: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        'rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
        active
          ? subtle
            ? 'border-[var(--color-border-strong)] bg-[var(--color-surface-alt)] text-[var(--color-text-primary)]'
            : 'border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
          : 'border-[var(--color-border-base)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]',
      )}
    >
      {label}
    </Link>
  );
}
