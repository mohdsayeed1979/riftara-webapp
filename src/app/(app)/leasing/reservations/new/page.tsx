import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/page';
import { requirePermission } from '@/lib/auth/guard';
import { isUuid } from '@/lib/utils';
import { getReservationFormReferenceData } from '@/services/reservation-service';
import { ReservationForm, type ReservationFormInitial } from '@/features/leasing/reservation-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New Reservation' };

export default async function NewReservationPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; unitId?: string; leadId?: string }>;
}) {
  const user = await requirePermission('reservations:create');
  const sp = await searchParams;
  const reference = await getReservationFormReferenceData(user.organizationId);

  const initial: ReservationFormInitial = {};
  if (sp.customerId && isUuid(sp.customerId) && reference.customers.some((c) => c.id === sp.customerId)) initial.customerId = sp.customerId;
  if (sp.leadId && isUuid(sp.leadId) && reference.leads.some((l) => l.id === sp.leadId)) {
    initial.leadId = sp.leadId;
    if (!initial.customerId) initial.customerId = reference.leads.find((l) => l.id === sp.leadId)?.customerId;
  }
  if (sp.unitId && isUuid(sp.unitId)) {
    const unit = reference.units.find((u) => u.id === sp.unitId);
    if (unit) { initial.unitId = unit.id; initial.propertyId = unit.propertyId; }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Reservations', href: '/leasing/reservations' }, { label: 'New Reservation' }]}
        title="Create Reservation"
        subtitle="Hold a unit for a customer. An active reservation blocks other reservations on the same unit (BR-002)."
      />
      <ReservationForm reference={reference} initial={initial} />
    </div>
  );
}
