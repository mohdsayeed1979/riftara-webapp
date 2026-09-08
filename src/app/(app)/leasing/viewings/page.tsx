import type { Metadata } from 'next';
import Link from 'next/link';
import { KeyRound, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FilterBar } from '@/components/app/filter-bar';
import { EmptyState } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/page';
import { StatusBadge } from '@/components/ui/status-badge';
import { Pagination, Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { can, requirePermission } from '@/lib/auth/guard';
import { formatDate } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { listViewings } from '@/services/viewing-service';

export const metadata: Metadata = { title: 'Viewings' };
export const dynamic = 'force-dynamic';
const PAGE_SIZE = 20;

export default async function ViewingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission('viewings:view');
  const params = await searchParams;
  const locale = await getRequestLocale();
  const page = Math.max(1, Number(params.page) || 1);

  const { items, total } = await listViewings({ organizationId: user.organizationId, status: params.status, search: params.search, page, pageSize: PAGE_SIZE });

  const buildHref = (targetPage: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value && key !== 'page') query.set(key, value);
    query.set('page', String(targetPage));
    return `/leasing/viewings?${query.toString()}`;
  };
  const addButton = can(user, 'viewings:create') ? (<Button asChild><Link href="/leasing/viewings/new"><Plus />Schedule Viewing</Link></Button>) : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader breadcrumbs={[{ label: 'Leasing CRM', href: '/leasing' }, { label: 'Viewings' }]} title="Viewings" subtitle="Scheduled and completed unit viewings." actions={addButton ?? undefined} />
      <FilterBar searchPlaceholder="Search by code or customer..." filters={[{ key: 'status', placeholder: 'All Statuses', options: [
        { value: 'scheduled', label: 'Scheduled' }, { value: 'confirmed', label: 'Confirmed' }, { value: 'completed', label: 'Completed' },
        { value: 'cancelled', label: 'Cancelled' }, { value: 'no_show', label: 'No Show' }, { value: 'rescheduled', label: 'Rescheduled' },
      ] }]} />
      <Card>
        {items.length === 0 ? (
          <EmptyState icon={<KeyRound />} title="No viewings found" description="Schedule a customer visit to a unit." action={addButton ?? undefined} />
        ) : (
          <>
            <TableContainer>
              <Table>
                <THead><TR><TH>Viewing</TH><TH>Customer</TH><TH>Property / Unit</TH><TH alignment="end">Date</TH><TH>Agent</TH><TH alignment="center">Status</TH><TH alignment="end">Actions</TH></TR></THead>
                <TBody>
                  {items.map((v) => (
                    <TR key={v.id} interactive>
                      <TD><Link href={`/leasing/viewings/${v.id}`} className="font-medium hover:text-[var(--color-info)]">{v.code}</Link></TD>
                      <TD className="text-[var(--color-text-secondary)]">{v.customerName}</TD>
                      <TD className="text-[var(--color-text-secondary)]">{v.propertyName}{v.unitNumber ? <span className="block text-[11px] text-[var(--color-text-tertiary)]">Unit {v.unitNumber}</span> : null}</TD>
                      <TD alignment="end" className="whitespace-nowrap">{formatDate(v.scheduledDate, { locale, style: 'short' })} {v.scheduledTime?.slice(0, 5)}</TD>
                      <TD className="text-[var(--color-text-secondary)]">{v.agentName ?? '—'}</TD>
                      <TD alignment="center"><StatusBadge status={v.status} /></TD>
                      <TD alignment="end" className="whitespace-nowrap">
                        <Link href={`/leasing/viewings/${v.id}`} className="text-[12px] font-medium text-[var(--color-info)] hover:underline">View</Link>
                        {can(user, 'viewings:edit') && ['scheduled', 'confirmed', 'rescheduled'].includes(v.status) ? (
                          <Link href={`/leasing/viewings/${v.id}/edit`} className="ms-3 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"><Pencil className="size-3" />Edit</Link>
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
