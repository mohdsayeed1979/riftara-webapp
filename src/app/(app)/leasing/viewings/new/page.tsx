import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/page';
import { requirePermission } from '@/lib/auth/guard';
import { isUuid } from '@/lib/utils';
import { getViewingFormReferenceData } from '@/services/viewing-service';
import { ViewingForm, type ViewingFormInitial } from '@/features/leasing/viewing-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New Viewing' };

export default async function NewViewingPage({ searchParams }: { searchParams: Promise<{ leadId?: string; customerId?: string; unitId?: string }> }) {
  const user = await requirePermission('viewings:create');
  const sp = await searchParams;
  const reference = await getViewingFormReferenceData(user.organizationId);
  const initial: ViewingFormInitial = {};
  if (sp.leadId && isUuid(sp.leadId)) {
    const lead = reference.leads.find((l) => l.id === sp.leadId);
    if (lead) { initial.leadId = lead.id; initial.customerId = lead.customerId; }
  }
  if (sp.customerId && isUuid(sp.customerId) && reference.customers.some((c) => c.id === sp.customerId)) initial.customerId = sp.customerId;
  if (sp.unitId && isUuid(sp.unitId)) {
    const unit = reference.units.find((u) => u.id === sp.unitId);
    if (unit) { initial.unitId = unit.id; initial.propertyId = unit.propertyId; }
  }
  return (
    <div className="flex flex-col gap-5">
      <PageHeader breadcrumbs={[{ label: 'Viewings', href: '/leasing/viewings' }, { label: 'New Viewing' }]} title="Schedule Viewing" subtitle="Schedule a customer visit to a unit." />
      <ViewingForm reference={reference} initial={initial} />
    </div>
  );
}
