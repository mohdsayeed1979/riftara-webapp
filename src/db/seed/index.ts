/**
 * RIFTARA demo seed.
 *
 * Produces a realistic, internally consistent Saudi real-estate portfolio:
 * seven properties across four cities, their buildings, floors and units,
 * the full leasing pipeline, live contracts with a complete financial trail,
 * maintenance operations, operating expenses, valuations, marketing campaigns
 * and computed historical KPI snapshots.
 *
 * Every seeded row carries `is_demo = true` so demonstration data is never
 * mistaken for production data (BRD 65).
 *
 * Run with: npm run db:seed
 */
import 'dotenv/config';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { firstRow } from '../rows';
import { env } from '@/config/env';
import type { Database } from '../types';
import { seedLeasing } from './leasing';
import { seedOperations } from './operations';
import { seedPipeline } from './pipeline';
import { seedPortfolio } from './portfolio';
import { seedReference } from './reference';
import { seedSnapshots } from './snapshots';
import { createRng } from './util';

/** Tables cleared before reseeding, ordered so foreign keys never block. */
const TRUNCATE_ORDER = [
  'audit_logs',
  'notifications',
  'integration_logs',
  'webhook_deliveries',
  'webhooks',
  'integrations',
  'import_errors',
  'import_batches',
  'report_runs',
  'website_listings',
  'saved_views',
  'kpi_thresholds',
  'kpi_definitions',
  'business_rule_configs',
  'settings',
  'documents',
  'marketing_attributions',
  'campaign_metrics',
  'campaigns',
  'marketing_platforms',
  'consents',
  'performance_snapshots',
  'vacancy_periods',
  'budget_lines',
  'budgets',
  'operating_expenses',
  'valuations',
  'maintenance_costs',
  'preventive_maintenance_schedules',
  'work_orders',
  'maintenance_assets',
  'collection_actions',
  'tenant_ledger_entries',
  'payment_allocations',
  'payments',
  'invoices',
  'payment_schedules',
  'handovers',
  'renewals',
  'contract_versions',
  'contracts',
  'tenants',
  'reservations',
  'proposals',
  'viewing_feedback',
  'viewings',
  'lead_activities',
  'leads',
  'customer_identifiers',
  'customers',
  'tasks',
  'pricing_approvals',
  'price_history',
  'unit_pricing',
  'units',
  'floors',
  'buildings',
  'property_ownerships',
  'properties',
  'vendors',
  'loss_reasons',
  'maintenance_categories',
  'expense_categories',
  'document_categories',
  'lead_stages',
  'lead_sources',
  'unit_statuses',
  'unit_types',
  'property_types',
  'districts',
  'cities',
  'regions',
  'portfolios',
  'login_attempts',
  'sessions',
  'api_keys',
  'user_scopes',
  'user_roles',
  'role_permissions',
  'permissions',
  'roles',
  'users',
  'organizations',
];

export async function resetDatabase(runScript: (sqlText: string) => Promise<void>): Promise<void> {
  // Triggers guard financial and audit tables against DELETE. TRUNCATE with
  // the session-replication role disabled is the supported reset path and is
  // available only to this maintenance script — never to the application.
  const statements = [
    "SET session_replication_role = 'replica';",
    ...TRUNCATE_ORDER.map((table) => `TRUNCATE TABLE ${table} CASCADE;`),
    "SET session_replication_role = 'origin';",
  ];
  await runScript(statements.join('\n'));
}

export async function seedDatabase(db: Database): Promise<void> {
  const started = Date.now();
  const rng = createRng();

  console.info('[seed] reference data (organization, RBAC, taxonomies, settings, KPIs)...');
  const reference = await seedReference(db);

  console.info('[seed] portfolio (properties, buildings, floors, units, pricing, valuations)...');
  const portfolio = await seedPortfolio(db, reference, rng);
  console.info(
    `[seed]   ${portfolio.properties.length} properties, ${portfolio.units.length} units`,
  );

  console.info('[seed] leasing (customers, tenants, contracts, invoices, payments, ledger)...');
  const leasing = await seedLeasing(db, reference, portfolio, rng);
  console.info(`[seed]   ${leasing.contracts.length} active contracts`);

  console.info('[seed] pipeline (leads, viewings, proposals, approvals, reservations)...');
  await seedPipeline(db, reference, portfolio, leasing, rng);

  console.info('[seed] operations (assets, work orders, OPEX, budgets, marketing)...');
  await seedOperations(db, reference, portfolio, rng);

  console.info('[seed] computing historical KPI snapshots and notifications...');
  await seedSnapshots(db, reference, portfolio);

  console.info(`[seed] complete in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

async function main() {
  const { getConnection } = await import('../client');
  const { db, runScript } = await getConnection();

  const existing = firstRow<{ count: number }>(
    await db.execute(sql`SELECT count(*)::int AS count FROM organizations`),
  );

  if (Number(existing?.count ?? 0) > 0) {
    console.info('[seed] existing data found — resetting before reseeding.');
    await resetDatabase(runScript);
  }

  await seedDatabase(db);

  console.info('');
  console.info('  Demo accounts (password: %s)', env.SEED_DEFAULT_PASSWORD);
  console.info('    sayeed.almousa@riftara.sa   Super Admin');
  console.info('    khalid.alrashid@riftara.sa  Executive Management');
  console.info('    sarah.mohammed@riftara.sa   Leasing Manager');
  console.info('    omar.alqahtani@riftara.sa   Finance');
  console.info('    ali.kamal@riftara.sa        Maintenance Manager');
  console.info('    tariq.alnasser@riftara.sa   Auditor (read-only + audit trail)');
  console.info('');
  process.exit(0);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]).replace(/\.tsx?$/, '') ===
    path.resolve(import.meta.dirname, 'index');

if (invokedDirectly) {
  main().catch((error) => {
    console.error('[seed] failed:', error);
    process.exit(1);
  });
}
