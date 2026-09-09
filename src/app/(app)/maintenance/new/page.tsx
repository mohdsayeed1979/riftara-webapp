import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/page';
import { requirePermission } from '@/lib/auth/guard';
import { isUuid } from '@/lib/utils';
import { getWorkOrderFormReferenceData } from '@/services/maintenance-service';
import { WorkOrderForm, type WorkOrderFormInitial } from '@/features/maintenance/work-order-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New Work Order' };

export default async function NewWorkOrderPage({ searchParams }: { searchParams: Promise<{ propertyId?: string; unitId?: string }> }) {
  const user = await requirePermission('maintenance:create');
  const sp = await searchParams;
  const reference = await getWorkOrderFormReferenceData(user.organizationId);

  const initial: WorkOrderFormInitial = {};
  if (sp.unitId && isUuid(sp.unitId)) {
    const unit = reference.units.find((u) => u.id === sp.unitId);
    if (unit) { initial.unitId = unit.id; initial.propertyId = unit.propertyId; }
  } else if (sp.propertyId && isUuid(sp.propertyId) && reference.properties.some((p) => p.id === sp.propertyId)) {
    initial.propertyId = sp.propertyId;
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Maintenance', href: '/maintenance' }, { label: 'New Work Order' }]}
        title="Create Work Order"
        subtitle="Raise a corrective, preventive or emergency work order against a property or unit."
      />
      <WorkOrderForm reference={reference} initial={initial} />
    </div>
  );
}
