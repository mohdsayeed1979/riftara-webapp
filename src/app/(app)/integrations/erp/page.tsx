import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/page';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DetailList, DetailRow } from '@/components/ui/page';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErpIntegrationPanel } from '@/features/integrations/erp-integration-panel';
import { can, requirePermission } from '@/lib/auth/guard';
import { formatRelativeTime } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { getMessages } from '@/i18n';
import { listIntegrations } from '@/services/integration-service';
import { getQueueSummary, listErpEvents, listMappings } from '@/integrations/erp/erp-service';

export const metadata: Metadata = { title: 'ERP Integration' };
export const dynamic = 'force-dynamic';

export default async function ErpIntegrationPage() {
  const user = await requirePermission('erp_integration:view');
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  const t = m.erp;

  const [integrations, queue, events, mappings] = await Promise.all([
    listIntegrations(user.organizationId),
    getQueueSummary(user.organizationId),
    listErpEvents({ organizationId: user.organizationId, pageSize: 25 }),
    listMappings(user.organizationId),
  ]);
  const integration = integrations.find((i) => i.key === 'dynamics_ax2012') ?? null;
  const mappedCount = mappings.filter((row) => row.status === 'mapped').length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: m.nav.integrations, href: '/integrations' }, { label: t.title }]}
        title={t.title}
        subtitle={t.subtitle}
        badge={<StatusBadge status={integration?.status ?? 'not_connected'} size="md" />}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title={t.erpSystem} />
          <CardBody className="pt-0">
            <DetailList>
              <DetailRow label={t.erpSystem} value="Microsoft Dynamics AX 2012 R3" />
              <DetailRow label={t.connection} value={<StatusBadge status={integration?.status ?? 'not_connected'} dot={false} />} />
              <DetailRow label={t.adapter} value={t.mockAdapter} />
              <DetailRow label={t.environment} value={t.notConfigured} />
              <DetailRow label={t.lastSync} value={integration?.lastSuccessfulSyncAt ? formatRelativeTime(integration.lastSuccessfulSyncAt, { locale }) : t.neverSynced} />
            </DetailList>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t.queue} />
          <CardBody className="grid grid-cols-3 gap-3 pt-0 text-center">
            {[
              [t.pending, queue.pending],
              [t.processing, queue.processing],
              [t.retrying, queue.retrying],
              [t.succeeded, queue.succeeded],
              [t.failed, queue.failed],
              [t.deadLetter, queue.dead_letter],
            ].map(([label, value]) => (
              <div key={label as string}>
                <p className="text-[11px] text-[var(--color-text-tertiary)]">{label}</p>
                <p className="text-[18px] font-semibold tabular">{value}</p>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t.mappingStatus} />
          <CardBody className="pt-0">
            <DetailList>
              <DetailRow label={t.mappingStatus} value={`${mappedCount} / ${mappings.length}`} />
            </DetailList>
          </CardBody>
        </Card>
      </div>

      <ErpIntegrationPanel
        events={events.items.map((event) => ({
          id: event.id,
          eventType: event.eventType,
          entityType: event.entityType,
          entityId: event.entityId,
          status: event.status,
          attemptCount: event.attemptCount,
          externalReference: event.externalReference,
          errorMessage: event.errorMessage,
          createdAt: event.createdAt.toISOString(),
        }))}
        canManage={can(user, 'erp_integration:manage')}
        canRetry={can(user, 'erp_integration:retry')}
        canReconcile={can(user, 'erp_integration:reconcile')}
        locale={locale}
      />
    </div>
  );
}
