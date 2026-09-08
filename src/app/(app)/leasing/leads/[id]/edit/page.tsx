import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page';
import { requirePermission } from '@/lib/auth/guard';
import { isUuid } from '@/lib/utils';
import { getLeadForEdit, getLeadFormReferenceData } from '@/services/lead-service';
import { LeadForm, type LeadFormInitial } from '@/features/leasing/lead-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Edit Lead' };

function str(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(value);
}

export default async function EditLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('leasing:edit');
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [lead, reference] = await Promise.all([
    getLeadForEdit(user.organizationId, id),
    getLeadFormReferenceData(user.organizationId),
  ]);
  if (!lead) notFound();

  const initial: LeadFormInitial = {
    sourceId: lead.sourceId ?? undefined,
    assignedUserId: lead.assignedUserId ?? undefined,
    requestedPropertyId: lead.requestedPropertyId ?? undefined,
    requestedUnitId: lead.requestedUnitId ?? undefined,
    requestedUnitTypeId: lead.requestedUnitTypeId ?? undefined,
    requiredArea: str(lead.requiredArea),
    budgetMin: str(lead.budgetMin),
    budgetMax: str(lead.budgetMax),
    moveInDate: str(lead.moveInDate),
    priority: lead.priority,
    nextAction: lead.nextAction ?? undefined,
    notes: lead.notes ?? undefined,
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[
          { label: 'Leasing CRM', href: '/leasing' },
          { label: lead.code, href: `/leasing/leads/${id}` },
          { label: 'Edit' },
        ]}
        title={`Edit ${lead.code}`}
        subtitle="Update lead details. Stage changes are made from the pipeline; the customer link is fixed."
      />
      <LeadForm reference={reference} initial={initial} mode="edit" leadId={id} />
    </div>
  );
}
