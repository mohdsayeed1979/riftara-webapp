import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Building2, MapPin, User } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DetailList, DetailRow, MetaItem, PageHeader } from '@/components/ui/page';
import { StatusBadge } from '@/components/ui/status-badge';
import { RenewalWorkflowPanel } from '@/features/renewals/renewal-workflow-panel';
import { can, requirePermission } from '@/lib/auth/guard';
import { formatDate } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { getMessages } from '@/i18n';
import { getRenewalById, renewalRequiresApproval } from '@/services/renewal-service';
import { isUuid } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Renewal' };

export default async function RenewalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('renewals:view');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  const t = m.renewals;

  const data = await getRenewalById(user.organizationId, id);
  if (!data) notFound();
  const { renewal } = data;
  const requiresApproval = await renewalRequiresApproval(user.organizationId, id);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: t.title, href: '/renewals' }, { label: data.contractNumber }]}
        title={`${t.renewal} — ${data.contractNumber}`}
        badge={<StatusBadge status={renewal.status} size="md" />}
        meta={
          <>
            <MetaItem icon={<User />}>{data.tenantName}</MetaItem>
            <MetaItem icon={<Building2 />}>{data.propertyName}</MetaItem>
            <MetaItem icon={<MapPin />}>{m.contracts.unit} {data.unitNumber}</MetaItem>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RenewalWorkflowPanel
            renewalId={id}
            status={renewal.status}
            currentRent={Number(renewal.currentRent)}
            proposedRent={renewal.proposedRent !== null ? Number(renewal.proposedRent) : null}
            marketRent={renewal.marketRent !== null ? Number(renewal.marketRent) : null}
            agreedRent={renewal.agreedRent !== null ? Number(renewal.agreedRent) : null}
            probability={renewal.probability}
            notes={renewal.notes}
            decidedAt={renewal.decidedAt ? renewal.decidedAt.toISOString() : null}
            requiresApproval={requiresApproval}
            canEdit={can(user, 'renewals:edit')}
            canApprove={can(user, 'renewals:approve')}
            locale={locale}
          />
        </div>
        <Card>
          <CardHeader title={t.contract} />
          <CardBody className="pt-0">
            <DetailList>
              <DetailRow label={m.contracts.contract} value={<Link href={`/contracts/${renewal.contractId}`} className="hover:text-[var(--color-info)]">{data.contractNumber}</Link>} />
              <DetailRow label={m.contracts.status} value={<StatusBadge status={data.contractStatus} />} />
              <DetailRow label={m.contracts.endDate} value={formatDate(data.contractEndDate, { locale })} />
              <DetailRow label={t.noticeDueDate} value={formatDate(renewal.noticeDueDate, { locale })} />
              {renewal.newContractId ? (
                <DetailRow
                  label={t.newContract}
                  value={<Link href={`/contracts/${renewal.newContractId}`} className="hover:text-[var(--color-info)]">{m.contracts.view}</Link>}
                />
              ) : null}
            </DetailList>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
