import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page';
import { requirePermission } from '@/lib/auth/guard';
import { isUuid } from '@/lib/utils';
import { getViewingForEdit, getViewingFormReferenceData } from '@/services/viewing-service';
import { ViewingForm, type ViewingFormInitial } from '@/features/leasing/viewing-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Edit Viewing' };

function str(v: unknown): string | undefined { return v === null || v === undefined ? undefined : String(v); }

export default async function EditViewingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('viewings:edit');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [viewing, reference] = await Promise.all([getViewingForEdit(user.organizationId, id), getViewingFormReferenceData(user.organizationId)]);
  if (!viewing) notFound();
  const initial: ViewingFormInitial = {
    customerId: viewing.customerId, leadId: viewing.leadId ?? undefined, propertyId: viewing.propertyId, unitId: viewing.unitId ?? undefined,
    assignedUserId: viewing.assignedUserId ?? undefined, meetingPoint: viewing.meetingPoint ?? undefined,
    scheduledDate: str(viewing.scheduledDate), scheduledTime: viewing.scheduledTime?.slice(0, 5), notes: viewing.notes ?? undefined,
  };
  return (
    <div className="flex flex-col gap-5">
      <PageHeader breadcrumbs={[{ label: 'Viewings', href: '/leasing/viewings' }, { label: viewing.code, href: `/leasing/viewings/${id}` }, { label: 'Edit' }]} title={`Edit ${viewing.code}`} subtitle="Update the scheduled viewing." />
      <ViewingForm reference={reference} initial={initial} mode="edit" viewingId={id} />
    </div>
  );
}
