/**
 * Idempotent Integration Hub catalog sync.
 *
 * `seedReference` writes one `integrations` row per `INTEGRATION_CATALOG`
 * entry once, at initial seed time. When the catalog gains a new connector
 * afterwards (as Phase 18 does with `dynamics_ax2012`), existing organizations
 * need that row added without re-running the full seed — which would create a
 * duplicate organization and duplicate demo data. This script only inserts
 * what's missing.
 *
 * Safe to run repeatedly. Never deletes or modifies an existing row.
 */
import 'dotenv/config';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { integrations, organizations } from './schema';
import { INTEGRATION_CATALOG } from '@/config/integrations-catalog';
import type { Database } from './types';

export async function syncIntegrations(db: Database): Promise<{ integrationsAdded: number }> {
  const orgs = await db.select({ id: organizations.id }).from(organizations);

  let integrationsAdded = 0;
  for (const org of orgs) {
    const existing = await db
      .select({ key: integrations.key })
      .from(integrations)
      .where(eq(integrations.organizationId, org.id));
    const existingKeys = new Set(existing.map((row) => row.key));

    const missing = INTEGRATION_CATALOG.filter((spec) => !existingKeys.has(spec.key));
    if (missing.length > 0) {
      await db.insert(integrations).values(
        missing.map((spec) => ({
          organizationId: org.id,
          key: spec.key,
          name: spec.name,
          description: spec.description,
          category: spec.category,
          systemOfRecord: spec.systemOfRecord,
          requiredEnvKeys: spec.requiredEnvKeys,
        })),
      );
      integrationsAdded += missing.length;
    }
  }

  return { integrationsAdded };
}

async function main() {
  const { getConnection } = await import('./client');
  const { db } = await getConnection();
  const result = await syncIntegrations(db);
  console.info(`[sync-integrations] added ${result.integrationsAdded} integration row(s)`);
  process.exit(0);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]).replace(/\.ts$/, '') === path.resolve(import.meta.dirname, 'sync-integrations');

if (invokedDirectly) {
  main().catch((error) => {
    console.error('[sync-integrations] failed:', error);
    process.exit(1);
  });
}
