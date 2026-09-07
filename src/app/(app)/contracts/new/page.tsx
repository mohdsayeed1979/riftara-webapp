import type { Metadata } from 'next';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { reservations, tenants } from '@/db/schema';
import { PageHeader } from '@/components/ui/page';
import { requirePermission } from '@/lib/auth/guard';
import { isUuid } from '@/lib/utils';
import { getContractFormReferenceData } from '@/services/contract-service';
import { ContractForm, type ContractFormInitial } from '@/features/contracts/contract-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New Contract' };

export default async function NewContractPage({
  searchParams,
}: {
  searchParams: Promise<{ unitId?: string; tenantId?: string; reservationId?: string }>;
}) {
  const user = await requirePermission('contracts:create');
  const sp = await searchParams;
  const reference = await getContractFormReferenceData(user.organizationId);

  const initial: ContractFormInitial = {};

  // Contextual prefill from an approved reservation: unit + (customer's) tenant.
  if (sp.reservationId && isUuid(sp.reservationId)) {
    const db = await getDb();
    const [reservation] = await db
      .select({ unitId: reservations.unitId, customerId: reservations.customerId, status: reservations.status })
      .from(reservations)
      .where(and(eq(reservations.id, sp.reservationId), eq(reservations.organizationId, user.organizationId), isNull(reservations.deletedAt)))
      .limit(1);
    if (reservation) {
      initial.reservationId = sp.reservationId;
      if (!sp.unitId) sp.unitId = reservation.unitId;
      const [tenant] = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(and(eq(tenants.customerId, reservation.customerId), eq(tenants.organizationId, user.organizationId), isNull(tenants.deletedAt)))
        .limit(1);
      if (tenant) initial.tenantId = tenant.id;
    }
  }

  // Prefill from a unit: resolve its property/building/floor for the selects.
  if (sp.unitId && isUuid(sp.unitId)) {
    const unit = reference.units.find((u) => u.id === sp.unitId);
    if (unit) {
      initial.unitId = unit.id;
      initial.propertyId = unit.propertyId;
      initial.buildingId = unit.buildingId ?? undefined;
      initial.floorId = unit.floorId ?? undefined;
    }
  }

  // Prefill from a tenant.
  if (sp.tenantId && isUuid(sp.tenantId) && reference.tenants.some((t) => t.id === sp.tenantId)) {
    initial.tenantId = sp.tenantId;
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Contracts', href: '/contracts' }, { label: 'New Contract' }]}
        title="Create Contract"
        subtitle="Draft a lease contract. Signing later generates the payment schedule and invoices."
      />
      <ContractForm reference={reference} initial={initial} />
    </div>
  );
}
