import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Building2, FileSignature, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DetailList, DetailRow, MetaItem, PageHeader } from '@/components/ui/page';
import { StatusBadge } from '@/components/ui/status-badge';
import { CancelReservationButton } from '@/features/leasing/cancel-reservation-button';
import { can, requirePermission } from '@/lib/auth/guard';
import { formatCurrency, formatDate } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { isUuid } from '@/lib/utils';
import { getReservationDetail } from '@/services/reservation-service';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Reservation' };

const CANCELLABLE = ['active', 'pending'];

export default async function ReservationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('reservations:view');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const locale = await getRequestLocale();

  const data = await getReservationDetail(user.organizationId, id);
  if (!data) notFound();
  const { reservation, contract } = data;

  const canConvert = CANCELLABLE.includes(reservation.status) && !contract;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Reservations', href: '/leasing/reservations' }, { label: reservation.code }]}
        title={reservation.code}
        badge={<StatusBadge status={reservation.status} size="md" />}
        meta={
          <>
            <MetaItem icon={<User />}>{reservation.customerName}</MetaItem>
            <MetaItem icon={<Building2 />}>{reservation.propertyName}</MetaItem>
            <span className="text-[var(--color-text-tertiary)]">Unit {reservation.unitNumber}</span>
          </>
        }
        actions={
          <>
            {canConvert && can(user, 'contracts:create') ? (
              <Button asChild>
                <Link href={`/contracts/new?reservationId=${id}`}>
                  <FileSignature />
                  Create Contract
                </Link>
              </Button>
            ) : null}
            {CANCELLABLE.includes(reservation.status) && can(user, 'reservations:edit') ? (
              <CancelReservationButton reservationId={id} />
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Reservation Details" />
          <CardBody className="pt-0">
            <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
              <DetailList>
                <DetailRow label="Customer" value={reservation.customerName} href={`/leasing/customers/${reservation.customerId}`} />
                <DetailRow label="Mobile" value={reservation.mobile ?? '—'} />
                <DetailRow label="Email" value={reservation.email ?? '—'} />
                <DetailRow label="Property" value={reservation.propertyName} href={`/properties/${reservation.propertyId}`} />
                <DetailRow label="Unit" value={reservation.unitNumber} href={`/units/${reservation.unitId}`} />
              </DetailList>
              <DetailList>
                <DetailRow label="Reservation Date" value={formatDate(reservation.reservationDate, { locale })} />
                <DetailRow label="Expiry Date" value={formatDate(reservation.expiryDate, { locale })} />
                <DetailRow label="Amount" value={formatCurrency(Number(reservation.reservationAmount), { locale })} />
                <DetailRow label="Payment Status" value={<span className="capitalize">{reservation.paymentStatus}</span>} />
                {reservation.cancelledAt ? (
                  <DetailRow label="Cancelled" value={`${formatDate(reservation.cancelledAt, { locale })}${reservation.cancellationReason ? ` — ${reservation.cancellationReason}` : ''}`} />
                ) : null}
                {reservation.expiredAt ? <DetailRow label="Expired" value={formatDate(reservation.expiredAt, { locale })} /> : null}
              </DetailList>
            </div>
            {reservation.terms ? (
              <div className="mt-4 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)] p-3">
                <p className="text-[11.5px] font-semibold text-[var(--color-text-secondary)]">Terms</p>
                <p className="mt-1 text-[12.5px] text-[var(--color-text-primary)]">{reservation.terms}</p>
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Contract" />
          <CardBody className="pt-0">
            {contract ? (
              <DetailList>
                <DetailRow label="Contract" value={contract.contractNumber} href={`/contracts/${contract.id}`} />
                <DetailRow label="Status" value={<StatusBadge status={contract.status} />} />
              </DetailList>
            ) : (
              <p className="py-2 text-[12.5px] text-[var(--color-text-secondary)]">
                {canConvert ? 'Use “Create Contract” to draft a lease from this reservation.' : 'No contract is linked to this reservation.'}
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
