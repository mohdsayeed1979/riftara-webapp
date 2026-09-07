import type { Metadata } from 'next';
import { AlertCircle, CheckCircle2, Circle, Settings2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { PageHeader, SectionTitle } from '@/components/ui/page';
import { requirePermission } from '@/lib/auth/guard';
import { formatRelativeTime } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import {
  groupIntegrationsByCategory,
  listIntegrations,
  type DerivedStatus,
  type IntegrationView,
} from '@/services/integration-service';

export const metadata: Metadata = { title: 'Integrations' };
export const dynamic = 'force-dynamic';

const STATUS_STYLE: Record<DerivedStatus, { tone: 'success' | 'warning' | 'error' | 'neutral'; icon: typeof CheckCircle2 }> = {
  connected: { tone: 'success', icon: CheckCircle2 },
  configuration_required: { tone: 'warning', icon: Settings2 },
  error: { tone: 'error', icon: AlertCircle },
  not_connected: { tone: 'neutral', icon: Circle },
};

export default async function IntegrationsPage() {
  const user = await requirePermission('integrations:view');
  const locale = await getRequestLocale();
  const canManage = user.permissions.includes('integrations:manage');

  const views = await listIntegrations(user.organizationId);
  const groups = groupIntegrationsByCategory(views);

  const connected = views.filter((view) => view.status === 'connected').length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Integrations"
        subtitle="Connect your tools and automate data sync across the platform."
        meta={
          <span>
            {connected} of {views.length} connectors active
          </span>
        }
      />

      <div className="flex items-start gap-2.5 rounded-[var(--radius-control)] border border-[var(--color-info-border)] bg-[var(--color-info-soft)] px-3.5 py-2.5">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-[var(--color-info)]" aria-hidden />
        <p className="text-[12px] leading-4 text-[var(--color-info)]">
          Connection status is derived from real credentials. Connectors show <strong>Not Connected</strong> or{' '}
          <strong>Configuration Required</strong> until their environment variables are configured — no integration is
          ever shown as connected without valid credentials.
        </p>
      </div>

      {groups.map((group) => (
        <div key={group.label}>
          <SectionTitle>{group.label}</SectionTitle>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {group.items.map((integration) => (
              <IntegrationCard key={integration.id} integration={integration} canManage={canManage} locale={locale} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function IntegrationCard({
  integration,
  canManage,
  locale,
}: {
  integration: IntegrationView;
  canManage: boolean;
  locale: 'en' | 'ar';
}) {
  const style = STATUS_STYLE[integration.status];
  const Icon = style.icon;

  return (
    <Card>
      <CardBody className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-[var(--color-text-primary)]">{integration.name}</p>
            <p className="mt-0.5 line-clamp-2 text-[11.5px] text-[var(--color-text-secondary)]">{integration.description}</p>
          </div>
          <Badge tone={style.tone} icon={<Icon className="size-3" />}>
            {integration.statusLabel}
          </Badge>
        </div>

        <div className="mt-3 flex flex-col gap-1 text-[11px] text-[var(--color-text-tertiary)]">
          <span>
            System of record: <span className="capitalize text-[var(--color-text-secondary)]">{integration.systemOfRecord}</span>
          </span>
          {integration.lastSuccessfulSyncAt ? (
            <span>Last sync: {formatRelativeTime(integration.lastSuccessfulSyncAt, { locale })}</span>
          ) : (
            <span>Never synced</span>
          )}
          {integration.status === 'error' && integration.lastErrorMessage ? (
            <span className="text-[var(--color-error)]">{integration.lastErrorMessage}</span>
          ) : null}
        </div>

        {integration.missingEnvKeys.length > 0 ? (
          <div className="mt-2 rounded-[6px] bg-[var(--color-surface-muted)] px-2.5 py-1.5">
            <p className="text-[10.5px] text-[var(--color-text-tertiary)]">
              Configure: <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">{integration.missingEnvKeys.join(', ')}</span>
            </p>
          </div>
        ) : null}

        <div className="mt-auto flex items-center gap-2 pt-3">
          {canManage ? (
            <Button variant="secondary" size="sm" disabled={integration.status === 'not_connected' && integration.requiredEnvKeys.length > 0} title={integration.requiredEnvKeys.length > 0 ? 'Add credentials in the environment to enable configuration.' : undefined}>
              {integration.status === 'connected' ? 'Configure' : 'Connect'}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm">
            View Logs
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
