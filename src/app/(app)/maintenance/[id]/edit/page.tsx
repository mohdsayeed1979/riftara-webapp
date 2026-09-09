import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page';
import { requirePermission } from '@/lib/auth/guard';
import { isUuid } from '@/lib/utils';
import { getWorkOrderDetail, getWorkOrderFormReferenceData } from '@/services/maintenance-service';
import { WorkOrderForm, type WorkOrderFormInitial } from '@/features/maintenance/work-order-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Edit Work Order' };

export default async function EditWorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('maintenance:edit');
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [data, reference] = await Promise.all([
    getWorkOrderDetail(user.organizationId, id),
    getWorkOrderFormReferenceData(user.organizationId),
  ]);
  if (!data) notFound();
  const { workOrder } = data;

  const initial: WorkOrderFormInitial = {
    title: workOrder.title,
    description: workOrder.description ?? undefined,
    maintenanceType: workOrder.maintenanceType,
    categoryId: workOrder.categoryId ?? undefined,
    propertyId: workOrder.propertyId,
    unitId: workOrder.unitId ?? undefined,
    tenantId: workOrder.tenantId ?? undefined,
    priority: workOrder.priority,
    estimatedCost: String(workOrder.estimatedCost ?? ''),
    resolutionNotes: workOrder.resolutionNotes ?? undefined,
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Maintenance', href: '/maintenance' }, { label: workOrder.code, href: `/maintenance/${id}` }, { label: 'Edit' }]}
        title={`Edit ${workOrder.code}`}
        subtitle="Update work-order details. Assignment and status are managed from the work-order page."
      />
      <WorkOrderForm reference={reference} initial={initial} mode="edit" workOrderId={id} />
    </div>
  );
}
