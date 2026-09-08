import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page';
import { requirePermission } from '@/lib/auth/guard';
import { isUuid } from '@/lib/utils';
import { getProposalForEdit, getProposalFormReferenceData } from '@/services/proposal-service';
import { ProposalForm, type ProposalFormInitial } from '@/features/leasing/proposal-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Edit Proposal' };

function str(v: unknown): string | undefined {
  return v === null || v === undefined ? undefined : String(v);
}

export default async function EditProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('proposals:edit');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [proposal, reference] = await Promise.all([getProposalForEdit(user.organizationId, id), getProposalFormReferenceData(user.organizationId)]);
  if (!proposal) notFound();
  if (proposal.status !== 'draft') notFound();

  const initial: ProposalFormInitial = {
    customerId: proposal.customerId,
    leadId: proposal.leadId ?? undefined,
    propertyId: proposal.propertyId,
    unitId: proposal.unitId,
    leasableArea: str(proposal.leasableArea),
    annualRent: str(proposal.annualRent),
    serviceCharges: str(proposal.serviceCharges),
    depositAmount: str(proposal.depositAmount),
    contractDurationMonths: str(proposal.contractDurationMonths),
    paymentTerms: proposal.paymentTerms,
    escalationPercent: str(proposal.escalationPercent),
    gracePeriodDays: str(proposal.gracePeriodDays),
    fitOutPeriodDays: str(proposal.fitOutPeriodDays),
    parkingSpaces: str(proposal.parkingSpaces),
    utilitiesTerms: proposal.utilitiesTerms ?? undefined,
    specialTerms: proposal.specialTerms ?? undefined,
    validUntil: str(proposal.validUntil),
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Proposals', href: '/leasing/proposals' }, { label: proposal.reference, href: `/leasing/proposals/${id}` }, { label: 'Edit' }]}
        title={`Edit ${proposal.reference}`}
        subtitle="Only draft proposals can be edited. Create a new version to change an approved proposal."
      />
      <ProposalForm reference={reference} initial={initial} mode="edit" proposalId={id} />
    </div>
  );
}
