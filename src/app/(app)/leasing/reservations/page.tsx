import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarClock, Plus } from 'lucide-react';
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
import { listReservations } from '@/services/reservation-service';

export const metadata: Metadata = { title: 'Reservations' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

export default async function ReservationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission('reservations:view');
  const params = await searchParams;
  const locale = await getRequestLocale();
  const page = Math.max(1, Number(params.page) || 1);

  const { items, total } = await listReservations({
    organizationId: user.organizationId,
    status: params.status,
    search: params.search,
    page,
    pageSize: PAGE_SIZE,
  });

  const buildHref = (targetPage: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value && key !== 'page') query.set(key, value);
    query.set('page', String(targetPage));
    return `/leasing/reservations?${query.toString()}`;
  };

  const addButton = can(user, 'reservations:create') ? (
    <Button asChild><Link href="/leasing/reservations/new"><Plus />New Reservation</Link></Button>
  ) : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Leasing CRM', href: '/leasing' }, { label: 'Reservations' }]}
        title="Reservations"
        subtitle="Units held for customers pending a contract."
        actions={addButton ?? undefined}
      />

      <FilterBar
        searchPlaceholder="Search by reservation code, customer or unit..."
        filters={[
          {
            key: 'status',
            placeholder: 'All Statuses',
            options: [
              { value: 'active', label: 'Active' },
              { value: 'pending', label: 'Pending' },
              { value: 'converted', label: 'Converted' },
              { value: 'expired', label: 'Expired' },
              { value: 'cancelled', label: 'Cancelled' },
            ],
          },
        ]}
      />

      <Card>
        {items.length === 0 ? (
          <EmptyState icon={<CalendarClock />} title="No reservations found" description="Hold a unit for a customer by creating a reservation." action={addButton ?? undefined} />
        ) : (
          <>
            <TableContainer>
              <Table>
                <THead>
                  <TR>
                    <TH>Reservation</TH>
                    <TH>Customer</TH>
                    <TH>Property / Unit</TH>
                    <TH alignment="end">Reserved</TH>
                    <TH alignment="end">Expires</TH>
                    <TH alignment="end">Amount</TH>
                    <TH alignment="center">Status</TH>
                    <TH alignment="end">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {items.map((r) => (
                    <TR key={r.id} interactive>
                      <TD>
                        <Link href={`/leasing/reservations/${r.id}`} className="font-medium hover:text-[var(--color-info)]">{r.code}</Link>
                      </TD>
                      <TD className="text-[var(--color-text-secondary)]">{r.customerName}</TD>
                      <TD className="text-[var(--color-text-secondary)]">{r.propertyName}<span className="block text-[11px] text-[var(--color-text-tertiary)]">Unit {r.unitNumber}</span></TD>
                      <TD alignment="end" className="whitespace-nowrap">{formatDate(r.reservationDate, { locale, style: 'short' })}</TD>
                      <TD alignment="end" className="whitespace-nowrap">{formatDate(r.expiryDate, { locale, style: 'short' })}</TD>
                      <TD alignment="end" numeric>{formatCompactCurrency(Number(r.reservationAmount), { locale })}</TD>
                      <TD alignment="center"><StatusBadge status={r.status} /></TD>
                      <TD alignment="end" className="whitespace-nowrap">
                        <Link href={`/leasing/reservations/${r.id}`} className="text-[12px] font-medium text-[var(--color-info)] hover:underline">View</Link>
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
