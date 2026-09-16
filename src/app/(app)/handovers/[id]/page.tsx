import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Building2, MapPin, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DetailList, DetailRow, MetaItem, PageHeader } from '@/components/ui/page';
import { StatusBadge } from '@/components/ui/status-badge';
import { HandoverChecklistPanel } from '@/features/handovers/handover-checklist-panel';
import { can, requirePermission } from '@/lib/auth/guard';
import { getRequestLocale } from '@/lib/locale';
import { getMessages } from '@/i18n';
import { getHandover } from '@/services/handover-service';
import { isUuid } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Handover' };

export default async function HandoverDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('handovers:view');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  const t = m.handovers;

  const data = await getHandover(user.organizationId, id);
  if (!data) notFound();
  const { handover, balance } = data;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: t.title, href: '/handovers' }, { label: data.contractNumber }]}
        title={`${t.handover} — ${data.contractNumber}`}
        badge={<StatusBadge status={handover.status} size="md" />}
        meta={
          <>
            <MetaItem icon={<User />}>{data.tenantName}</MetaItem>
            <MetaItem icon={<Building2 />}>{data.propertyName}</MetaItem>
            <MetaItem icon={<MapPin />}>{m.contracts.unit} {data.unitNumber}</MetaItem>
            <Badge tone="neutral" size="sm">{handover.handoverType === 'move_out' ? t.moveOut : t.handoverType}</Badge>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <HandoverChecklistPanel
            handoverId={id}
            status={handover.status}
            contractSigned={handover.contractSigned}
            paymentReceived={handover.paymentReceived}
            depositReceived={handover.depositReceived}
            unitReady={handover.unitReady}
            keysHandedOver={handover.keysHandedOver}
            accessCards={handover.accessCards}
            parkingCards={handover.parkingCards}
            electricityMeterReading={handover.electricityMeterReading}
            waterMeterReading={handover.waterMeterReading}
            unitCondition={handover.unitCondition}
            notes={handover.notes}
            totalBilled={balance.totalBilled}
            totalPaid={balance.totalPaid}
            outstanding={balance.outstanding}
            canEdit={can(user, 'handovers:edit')}
            canApprove={can(user, 'handovers:approve')}
            locale={locale}
          />
        </div>
        <Card>
          <CardHeader title={t.contract} />
          <CardBody className="pt-0">
            <DetailList>
              <DetailRow label={m.contracts.contract} value={<Link href={`/contracts/${handover.contractId}`} className="hover:text-[var(--color-info)]">{data.contractNumber}</Link>} />
              <DetailRow label={m.contracts.status} value={<StatusBadge status={data.contractStatus} />} />
              <DetailRow label={t.unit} value={<Link href={`/units/${handover.unitId}`} className="hover:text-[var(--color-info)]">{data.unitNumber}</Link>} />
            </DetailList>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
