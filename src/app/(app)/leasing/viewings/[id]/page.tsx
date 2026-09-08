import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Building2, Pencil, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DetailList, DetailRow, MetaItem, PageHeader } from '@/components/ui/page';
import { StatusBadge } from '@/components/ui/status-badge';
import { ViewingStatusActions } from '@/features/leasing/viewing-status-actions';
import { can, requirePermission } from '@/lib/auth/guard';
import { formatDate } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { isUuid } from '@/lib/utils';
import { getViewingDetail } from '@/services/viewing-service';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Viewing' };

const OPEN = ['scheduled', 'confirmed', 'rescheduled'];

export default async function ViewingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('viewings:view');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const locale = await getRequestLocale();
  const data = await getViewingDetail(user.organizationId, id);
  if (!data) notFound();
  const { viewing, feedback } = data;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Viewings', href: '/leasing/viewings' }, { label: viewing.code }]}
        title={viewing.code}
        badge={<StatusBadge status={viewing.status} size="md" />}
        meta={<><MetaItem icon={<User />}>{viewing.customerName}</MetaItem><MetaItem icon={<Building2 />}>{viewing.propertyName}</MetaItem>{viewing.unitNumber ? <span className="text-[var(--color-text-tertiary)]">Unit {viewing.unitNumber}</span> : null}</>}
        actions={
          <>
            {can(user, 'viewings:edit') && OPEN.includes(viewing.status) ? (
              <Button variant="secondary" asChild><Link href={`/leasing/viewings/${id}/edit`}><Pencil />Edit</Link></Button>
            ) : null}
            <ViewingStatusActions viewingId={id} status={viewing.status} canEdit={can(user, 'viewings:edit')} />
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Viewing Details" />
          <CardBody className="pt-0">
            <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
              <DetailList>
                <DetailRow label="Customer" value={viewing.customerName} href={`/leasing/customers/${viewing.customerId}`} />
                <DetailRow label="Mobile" value={viewing.mobile ?? '—'} />
                <DetailRow label="Property" value={viewing.propertyName} href={`/properties/${viewing.propertyId}`} />
                <DetailRow label="Unit" value={viewing.unitNumber ?? '—'} href={viewing.unitId ? `/units/${viewing.unitId}` : undefined} />
                {viewing.leadId ? <DetailRow label="Lead" value="View lead" href={`/leasing/leads/${viewing.leadId}`} /> : null}
              </DetailList>
              <DetailList>
                <DetailRow label="Date" value={formatDate(viewing.scheduledDate, { locale })} />
                <DetailRow label="Time" value={viewing.scheduledTime?.slice(0, 5)} />
                <DetailRow label="Agent" value={viewing.agentName ?? '—'} />
                <DetailRow label="Meeting Point" value={viewing.meetingPoint ?? '—'} />
                {viewing.completedAt ? <DetailRow label="Completed" value={formatDate(viewing.completedAt, { locale })} /> : null}
              </DetailList>
            </div>
            {viewing.notes ? (
              <div className="mt-4 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)] p-3">
                <p className="text-[11.5px] font-semibold text-[var(--color-text-secondary)]">Notes</p>
                <p className="mt-1 text-[12.5px] text-[var(--color-text-primary)]">{viewing.notes}</p>
              </div>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Feedback" />
          <CardBody className="pt-0">
            {feedback ? (
              <DetailList>
                <DetailRow label="Interest" value={feedback.interestLevel != null ? `${feedback.interestLevel}/5` : '—'} />
                <DetailRow label="Price" value={feedback.priceSuitability != null ? `${feedback.priceSuitability}/5` : '—'} />
                <DetailRow label="Area" value={feedback.areaSuitability != null ? `${feedback.areaSuitability}/5` : '—'} />
                <DetailRow label="Location" value={feedback.locationSuitability != null ? `${feedback.locationSuitability}/5` : '—'} />
                <DetailRow label="Unit" value={feedback.unitSuitability != null ? `${feedback.unitSuitability}/5` : '—'} />
                <DetailRow label="Likelihood" value={feedback.likelihoodToLease != null ? `${feedback.likelihoodToLease}/5` : '—'} />
                <DetailRow label="Next Action" value={feedback.nextAction ?? '—'} />
              </DetailList>
            ) : (
              <p className="py-2 text-[12.5px] text-[var(--color-text-secondary)]">Feedback is recorded when the viewing is completed.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
