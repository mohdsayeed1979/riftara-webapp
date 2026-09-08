import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Building2, GitBranch, Pencil, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DetailList, DetailRow, MetaItem, PageHeader } from '@/components/ui/page';
import { StatusBadge } from '@/components/ui/status-badge';
import { ProposalStatusActions } from '@/features/leasing/proposal-status-actions';
import { can, requirePermission } from '@/lib/auth/guard';
import { formatArea, formatCurrency, formatDate } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { isUuid } from '@/lib/utils';
import { getProposalDetail } from '@/services/proposal-service';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Proposal' };

export default async function ProposalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('proposals:view');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const locale = await getRequestLocale();
  const data = await getProposalDetail(user.organizationId, id);
  if (!data) notFound();
  const { proposal, approval } = data;
  const currency = (v: number | string | null) => formatCurrency(Number(v ?? 0), { locale });

  const reservationTarget = `/leasing/reservations/new?customerId=${proposal.customerId}&unitId=${proposal.unitId}&proposalId=${id}${proposal.leadId ? `&leadId=${proposal.leadId}` : ''}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Proposals', href: '/leasing/proposals' }, { label: proposal.reference }]}
        title={`${proposal.reference} · v${proposal.version}`}
        badge={<StatusBadge status={proposal.status} size="md" />}
        meta={<><MetaItem icon={<User />}>{proposal.customerName}</MetaItem><MetaItem icon={<Building2 />}>{proposal.propertyName}</MetaItem><span className="text-[var(--color-text-tertiary)]">Unit {proposal.unitNumber}</span></>}
        actions={
          <>
            {can(user, 'proposals:edit') && proposal.status === 'draft' ? (
              <Button variant="secondary" asChild><Link href={`/leasing/proposals/${id}/edit`}><Pencil />Edit</Link></Button>
            ) : null}
            {can(user, 'proposals:create') ? (
              <Button variant="secondary" asChild><Link href={`/leasing/proposals/${id}/version`}><GitBranch />New Version</Link></Button>
            ) : null}
            <ProposalStatusActions proposalId={id} status={proposal.status} canEdit={can(user, 'proposals:edit')} canApprove={can(user, 'proposals:approve')} canReserve={can(user, 'reservations:create')} reservationTarget={reservationTarget} />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Commercial Offer" />
          <CardBody className="pt-0">
            <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
              <DetailList>
                <DetailRow label="Customer" value={proposal.customerName} href={`/leasing/customers/${proposal.customerId}`} />
                <DetailRow label="Property" value={proposal.propertyName} href={`/properties/${proposal.propertyId}`} />
                <DetailRow label="Unit" value={proposal.unitNumber} href={`/units/${proposal.unitId}`} />
                {proposal.leadId ? <DetailRow label="Lead" value="View lead" href={`/leasing/leads/${proposal.leadId}`} /> : null}
                <DetailRow label="Leasable Area" value={formatArea(Number(proposal.leasableArea), { locale })} />
                <DetailRow label="Duration" value={`${proposal.contractDurationMonths} months`} />
                <DetailRow label="Valid Until" value={proposal.validUntil ? formatDate(proposal.validUntil, { locale }) : '—'} />
              </DetailList>
              <DetailList>
                <DetailRow label="Annual Rent" value={<span className="text-[15px] font-semibold">{currency(proposal.annualRent)}</span>} />
                <DetailRow label="Rent / m²" value={currency(proposal.rentPerSqm)} />
                <DetailRow label="VAT" value={currency(proposal.vatAmount)} />
                <DetailRow label="Service Charges" value={currency(proposal.serviceCharges)} />
                <DetailRow label="Deposit" value={currency(proposal.depositAmount)} />
                <DetailRow label="Escalation" value={`${Number(proposal.escalationPercent)}%`} />
                <DetailRow label="Total Contract Value" value={<span className="font-semibold">{currency(proposal.totalContractValue)}</span>} />
              </DetailList>
            </div>
            {proposal.specialTerms ? (
              <div className="mt-4 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)] p-3">
                <p className="text-[11.5px] font-semibold text-[var(--color-text-secondary)]">Special Terms</p>
                <p className="mt-1 text-[12.5px] text-[var(--color-text-primary)]">{proposal.specialTerms}</p>
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Pricing Approval" />
          <CardBody className="pt-0">
            {approval ? (
              <DetailList>
                <DetailRow label="Reference" value={approval.reference} />
                <DetailRow label="Status" value={<StatusBadge status={approval.status} />} />
                <DetailRow label="Required Role" value={approval.requiredRoleKey.replace(/_/g, ' ')} />
                <DetailRow label="Discount" value={`${Number(approval.discountPercent)}%`} />
                {approval.decisionNotes ? <DetailRow label="Notes" value={approval.decisionNotes} /> : null}
              </DetailList>
            ) : (
              <p className="py-2 text-[12.5px] text-[var(--color-text-secondary)]">
                {proposal.status === 'draft' ? 'Submit for approval to evaluate the rent against the pricing tiers (BR-004).' : 'This proposal did not require a pricing exception.'}
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
