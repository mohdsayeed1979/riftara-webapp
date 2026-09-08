import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/page';
import { requirePermission } from '@/lib/auth/guard';
import { isUuid } from '@/lib/utils';
import { getProposalFormReferenceData } from '@/services/proposal-service';
import { ProposalForm, type ProposalFormInitial } from '@/features/leasing/proposal-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New Proposal' };

export default async function NewProposalPage({ searchParams }: { searchParams: Promise<{ leadId?: string; customerId?: string; unitId?: string }> }) {
  const user = await requirePermission('proposals:create');
  const sp = await searchParams;
  const reference = await getProposalFormReferenceData(user.organizationId);
  const initial: ProposalFormInitial = {};
  if (sp.leadId && isUuid(sp.leadId)) { const l = reference.leads.find((x) => x.id === sp.leadId); if (l) { initial.leadId = l.id; initial.customerId = l.customerId; } }
  if (sp.customerId && isUuid(sp.customerId) && reference.customers.some((c) => c.id === sp.customerId)) initial.customerId = sp.customerId;
  if (sp.unitId && isUuid(sp.unitId)) { const u = reference.units.find((x) => x.id === sp.unitId); if (u) { initial.unitId = u.id; initial.propertyId = u.propertyId; if (u.leasableArea) initial.leasableArea = String(u.leasableArea); } }
  return (
    <div className="flex flex-col gap-5">
      <PageHeader breadcrumbs={[{ label: 'Proposals', href: '/leasing/proposals' }, { label: 'New Proposal' }]} title="Create Proposal" subtitle="Draft a commercial offer. Submit for pricing approval (BR-004) before reserving." />
      <ProposalForm reference={reference} initial={initial} />
    </div>
  );
}
