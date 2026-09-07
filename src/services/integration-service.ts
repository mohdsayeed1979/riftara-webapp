import 'server-only';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { integrationLogs, integrations } from '@/db/schema';
import { integrationCredentials } from '@/config/env';
import { INTEGRATION_BY_KEY } from '@/config/integrations-catalog';

/**
 * Integration Hub service (BRD 108).
 *
 * Connection status is NEVER faked (BRD 47, 65). It is derived at read time
 * from whether the connector's credentials are actually configured:
 *   no credentials       -> not_connected
 *   partial credentials  -> configuration_required
 *   full credentials     -> connected (or error if the last sync failed)
 */

export type DerivedStatus = 'not_connected' | 'configuration_required' | 'connected' | 'error';

export interface IntegrationView {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: string;
  systemOfRecord: string;
  status: DerivedStatus;
  statusLabel: string;
  accountLabel: string | null;
  lastSyncAt: Date | null;
  lastSuccessfulSyncAt: Date | null;
  failedTransactionCount: number;
  lastErrorMessage: string | null;
  tokenStatus: string;
  requiredEnvKeys: string[];
  missingEnvKeys: string[];
}

/** Which of a connector's required env keys are actually present. */
function credentialState(key: string): { configured: boolean; partial: boolean; missing: string[] } {
  const spec = INTEGRATION_BY_KEY.get(key);
  if (!spec) return { configured: false, partial: false, missing: [] };

  // Connectors with no required keys (webhooks, BI export) are always available.
  if (spec.requiredEnvKeys.length === 0) return { configured: true, partial: false, missing: [] };

  const present = spec.requiredEnvKeys.filter((envKey) => Boolean(process.env[envKey]));
  const missing = spec.requiredEnvKeys.filter((envKey) => !process.env[envKey]);

  // The credentialKey gives a definitive "fully configured" signal.
  const fullyConfigured = spec.credentialKey ? integrationCredentials[spec.credentialKey] : present.length === spec.requiredEnvKeys.length;

  return {
    configured: fullyConfigured,
    partial: !fullyConfigured && present.length > 0,
    missing,
  };
}

const STATUS_LABEL: Record<DerivedStatus, string> = {
  not_connected: 'Not Connected',
  configuration_required: 'Configuration Required',
  connected: 'Connected',
  error: 'Error',
};

export async function listIntegrations(organizationId: string): Promise<IntegrationView[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(integrations)
    .where(eq(integrations.organizationId, organizationId))
    .orderBy(integrations.category, integrations.name);

  return rows.map((row) => {
    const state = credentialState(row.key);
    const spec = INTEGRATION_BY_KEY.get(row.key);

    let status: DerivedStatus;
    if (!state.configured && !state.partial) status = 'not_connected';
    else if (state.partial) status = 'configuration_required';
    else if (row.failedTransactionCount > 0 && row.lastErrorMessage) status = 'error';
    else status = 'connected';

    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      category: row.category,
      systemOfRecord: row.systemOfRecord,
      status,
      statusLabel: STATUS_LABEL[status],
      accountLabel: row.accountLabel,
      lastSyncAt: row.lastSyncAt,
      lastSuccessfulSyncAt: row.lastSuccessfulSyncAt,
      failedTransactionCount: row.failedTransactionCount,
      lastErrorMessage: row.lastErrorMessage,
      tokenStatus: state.configured ? 'valid' : 'missing',
      requiredEnvKeys: spec?.requiredEnvKeys ?? [],
      missingEnvKeys: state.missing,
    };
  });
}

export async function getIntegrationLogs(integrationId: string, limit = 50) {
  const db = await getDb();
  return db
    .select()
    .from(integrationLogs)
    .where(eq(integrationLogs.integrationId, integrationId))
    .orderBy(desc(integrationLogs.createdAt))
    .limit(limit);
}

/** BR-018: records the outcome of an integration operation. */
export async function logIntegrationEvent(
  integrationId: string,
  input: {
    operation: string;
    direction?: string;
    result: 'success' | 'failure' | 'skipped';
    httpStatus?: number;
    durationMs?: number;
    entityType?: string;
    entityId?: string;
    errorMessage?: string;
  },
): Promise<void> {
  const db = await getDb();
  await db.insert(integrationLogs).values({
    integrationId,
    operation: input.operation,
    direction: input.direction ?? 'outbound',
    result: input.result,
    httpStatus: input.httpStatus ?? null,
    durationMs: input.durationMs ?? null,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    errorMessage: input.errorMessage ?? null,
  });

  if (input.result === 'failure') {
    const { sql } = await import('drizzle-orm');
    await db
      .update(integrations)
      .set({
        failedTransactionCount: sql`${integrations.failedTransactionCount} + 1`,
        lastErrorMessage: input.errorMessage ?? 'Integration operation failed.',
        lastSyncAt: new Date(),
      })
      .where(eq(integrations.id, integrationId));
  }
}

export function groupIntegrationsByCategory(views: IntegrationView[]) {
  const labels: Record<string, string> = {
    website: 'Website',
    marketing: 'Marketing',
    government: 'Government',
    accounting: 'Accounting & ERP',
    crm: 'CRM',
    automation: 'Automation',
    bi: 'Business Intelligence',
    communication: 'Communication',
    payments: 'Payments',
  };

  const grouped = new Map<string, { label: string; items: IntegrationView[] }>();
  for (const view of views) {
    const entry = grouped.get(view.category) ?? { label: labels[view.category] ?? view.category, items: [] };
    entry.items.push(view);
    grouped.set(view.category, entry);
  }
  return Array.from(grouped.values());
}
