import type { Metadata } from 'next';
import Link from 'next/link';
import { ClipboardList, Clock, FileText, KeyRound, Plus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { EmptyState } from '@/components/ui/misc';
import { KpiGrid, PageHeader } from '@/components/ui/page';
import { StatusBadge } from '@/components/ui/status-badge';
import { Pagination, Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { PipelineBoard } from '@/features/leasing/pipeline-board';
import { can, requirePermission } from '@/lib/auth/guard';
import { formatRelativeTime } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { cn } from '@/lib/utils';
import {
  getLeasingKpis,
  getPipeline,
  listLeads,
  type LeadListFilters,
} from '@/services/lead-service';

export const metadata: Metadata = { title: 'Leasing CRM' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

export default async function LeasingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission('leasing:view');
  const params = await searchParams;
  const locale = await getRequestLocale();
  const view = params.view === 'list' ? 'list' : 'pipeline';
  const page = Math.max(1, Number(params.page) || 1);
  const allowedPropertyIds = user.scopedPropertyIds.length ? user.scopedPropertyIds : null;

  const scope = { organizationId: user.organizationId, allowedPropertyIds };
  const canEdit = can(user, 'leasing:edit');

  const kpis = await getLeasingKpis(scope);

  const tabLink = (target: 'pipeline' | 'list') => {
    const query = new URLSearchParams();
    if (target === 'list') query.set('view', 'list');
    return query.toString() ? `/leasing?${query.toString()}` : '/leasing';
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Leasing CRM"
        subtitle="Manage leads from inquiry to signed contract."
        actions={
          can(user, 'leasing:create') ? (
            <Button asChild>
              <Link href="/leasing/leads/new">
                <Plus />
                Add Lead
              </Link>
            </Button>
          ) : undefined
        }
      />

      <KpiGrid columns={6}>
        <KpiCard label="Total Leads" value={kpis.totalLeads.toLocaleString()} icon={<Users />} tone="neutral" />
        <KpiCard label="New Inquiries" value={kpis.newInquiries.toLocaleString()} caption="This month" icon={<ClipboardList />} tone="info" />
        <KpiCard label="Site Viewings" value={kpis.siteViewings.toLocaleString()} caption="This month" icon={<KeyRound />} tone="warning" href="/leasing/viewings" />
        <KpiCard label="Proposals Sent" value={kpis.proposalsSent.toLocaleString()} caption="This month" icon={<FileText />} tone="gold" href="/leasing/proposals" />
        <KpiCard label="Reservations" value={kpis.reservations.toLocaleString()} caption="Active" icon={<Clock />} tone="warning" href="/leasing/reservations" />
        <KpiCard label="Contracts Signed" value={kpis.contractsSigned.toLocaleString()} caption="This month" icon={<FileText />} tone="success" href="/contracts" />
      </KpiGrid>

      <div className="flex items-center gap-1 border-b border-[var(--color-border-base)]">
        <Link
          href={tabLink('pipeline')}
          className={cn(
            'border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors',
            view === 'pipeline'
              ? 'border-[var(--color-primary)] text-[var(--color-text-primary)]'
              : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
          )}
        >
          Pipeline
        </Link>
        <Link
          href={tabLink('list')}
          className={cn(
            'border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors',
            view === 'list'
              ? 'border-[var(--color-primary)] text-[var(--color-text-primary)]'
              : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
          )}
        >
          List
        </Link>
      </div>

      {view === 'pipeline' ? (
        <PipelineView scope={scope} canEdit={canEdit} locale={locale} />
      ) : (
        <ListView
          filters={{
            ...scope,
            search: params.search,
            stageKey: params.stage,
            page,
            pageSize: PAGE_SIZE,
          }}
          params={params}
          locale={locale}
        />
      )}
    </div>
  );
}

async function PipelineView({
  scope,
  canEdit,
  locale,
}: {
  scope: { organizationId: string; allowedPropertyIds: string[] | null };
  canEdit: boolean;
  locale: 'en' | 'ar';
}) {
  const columns = await getPipeline(scope);
  return <PipelineBoard columns={columns} canEdit={canEdit} locale={locale} />;
}

async function ListView({
  filters,
  params,
  locale,
}: {
  filters: LeadListFilters;
  params: Record<string, string | undefined>;
  locale: 'en' | 'ar';
}) {
  const { items, total } = await listLeads(filters);

  const buildHref = (targetPage: number) => {
    const query = new URLSearchParams({ view: 'list' });
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== 'page' && key !== 'view') query.set(key, value);
    }
    query.set('page', String(targetPage));
    return `/leasing?${query.toString()}`;
  };

  if (items.length === 0) {
    return (
      <Card>
        <EmptyState icon={<Users />} title="No leads found" description="New inquiries will appear here." />
      </Card>
    );
  }

  return (
    <Card>
      <TableContainer>
        <Table>
          <THead>
            <TR>
              <TH>Lead</TH>
              <TH>Property</TH>
              <TH>Stage</TH>
              <TH>Source</TH>
              <TH>Assigned</TH>
              <TH>Next Action</TH>
              <TH alignment="end">Created</TH>
            </TR>
          </THead>
          <TBody>
            {items.map((lead) => (
              <TR key={lead.id} interactive>
                <TD>
                  <Link href={`/leasing/leads/${lead.id}`} className="font-medium hover:text-[var(--color-info)]">
                    {lead.companyName ?? lead.customerName}
                  </Link>
                  <span className="block text-[11px] text-[var(--color-text-tertiary)]">
                    {lead.code}
                    {lead.slaBreached ? (
                      <span className="ms-1.5 text-[var(--color-error)]">· SLA breached</span>
                    ) : null}
                  </span>
                </TD>
                <TD className="text-[var(--color-text-secondary)]">{lead.propertyName ?? '—'}</TD>
                <TD>
                  <StatusBadge status={lead.stageKey} label={lead.stageLabel} />
                </TD>
                <TD className="text-[var(--color-text-secondary)]">{lead.sourceName ?? '—'}</TD>
                <TD className="text-[var(--color-text-secondary)]">{lead.assignedName ?? '—'}</TD>
                <TD className="max-w-48 truncate text-[var(--color-text-secondary)]">
                  {lead.nextAction ?? '—'}
                </TD>
                <TD alignment="end" className="whitespace-nowrap text-[var(--color-text-secondary)]">
                  {formatRelativeTime(lead.createdAt, { locale })}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableContainer>
      <Pagination page={filters.page} pageSize={filters.pageSize} total={total} buildHref={buildHref} />
    </Card>
  );
}
