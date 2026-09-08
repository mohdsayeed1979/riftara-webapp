import type { Metadata } from 'next';
import Link from 'next/link';
import { FileText, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FilterBar } from '@/components/app/filter-bar';
import { EmptyState } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/page';
import { StatusBadge } from '@/components/ui/status-badge';
import { Pagination, Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { can, requirePermission } from '@/lib/auth/guard';
import { formatCompactCurrency, formatDate } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { listProposals } from '@/services/proposal-service';

export const metadata: Metadata = { title: 'Proposals' };
export const dynamic = 'force-dynamic';
const PAGE_SIZE = 20;

export default async function ProposalsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission('proposals:view');
  const params = await searchParams;
  const locale = await getRequestLocale();
  const page = Math.max(1, Number(params.page) || 1);

  const { items, total } = await listProposals({ organizationId: user.organizationId, status: params.status, search: params.search, page, pageSize: PAGE_SIZE });

  const buildHref = (targetPage: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value && key !== 'page') query.set(key, value);
    query.set('page', String(targetPage));
    return `/leasing/proposals?${query.toString()}`;
  };
  const addButton = can(user, 'proposals:create') ? (<Button asChild><Link href="/leasing/proposals/new"><Plus />Create Proposal</Link></Button>) : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader breadcrumbs={[{ label: 'Leasing CRM', href: '/leasing' }, { label: 'Proposals' }]} title="Proposals" subtitle="Commercial offers routed through pricing approval." actions={addButton ?? undefined} />
      <FilterBar searchPlaceholder="Search by reference or customer..." filters={[{ key: 'status', placeholder: 'All Statuses', options: [
        { value: 'draft', label: 'Draft' }, { value: 'pending_approval', label: 'Pending Approval' }, { value: 'approved', label: 'Approved' },
        { value: 'sent', label: 'Sent' }, { value: 'accepted', label: 'Accepted' }, { value: 'rejected', label: 'Rejected' },
        { value: 'expired', label: 'Expired' }, { value: 'superseded', label: 'Superseded' },
      ] }]} />
      <Card>
        {items.length === 0 ? (
          <EmptyState icon={<FileText />} title="No proposals found" description="Create a commercial offer for a customer." action={addButton ?? undefined} />
        ) : (
          <>
            <TableContainer>
              <Table>
                <THead><TR><TH>Proposal</TH><TH>Customer</TH><TH>Property / Unit</TH><TH alignment="end">Annual Rent</TH><TH alignment="end">Valid Until</TH><TH alignment="center">Status</TH><TH alignment="end">Actions</TH></TR></THead>
                <TBody>
                  {items.map((p) => (
                    <TR key={p.id} interactive>
                      <TD><Link href={`/leasing/proposals/${p.id}`} className="font-medium hover:text-[var(--color-info)]">{p.reference}</Link><span className="block text-[11px] text-[var(--color-text-tertiary)]">v{p.version}</span></TD>
                      <TD className="text-[var(--color-text-secondary)]">{p.customerName}</TD>
                      <TD className="text-[var(--color-text-secondary)]">{p.propertyName}<span className="block text-[11px] text-[var(--color-text-tertiary)]">Unit {p.unitNumber}</span></TD>
                      <TD alignment="end" numeric>{formatCompactCurrency(Number(p.annualRent), { locale })}</TD>
                      <TD alignment="end" className="whitespace-nowrap">{p.validUntil ? formatDate(p.validUntil, { locale, style: 'short' }) : '—'}</TD>
                      <TD alignment="center"><StatusBadge status={p.status} /></TD>
                      <TD alignment="end" className="whitespace-nowrap">
                        <Link href={`/leasing/proposals/${p.id}`} className="text-[12px] font-medium text-[var(--color-info)] hover:underline">View</Link>
                        {can(user, 'proposals:edit') && p.status === 'draft' ? (
                          <Link href={`/leasing/proposals/${p.id}/edit`} className="ms-3 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"><Pencil className="size-3" />Edit</Link>
                        ) : null}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} buildHref={buildHref} />
          </>
        )}
      </Card>
    </div>
  );
}
