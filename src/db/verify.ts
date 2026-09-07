/**
 * Schema self-check. Prints the object counts created by the migrations and
 * asserts that the critical integrity guarantees are actually installed.
 * Run with: npx tsx src/db/verify.ts
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb } from './client';
import { firstRow } from './rows';

async function scalar(query: ReturnType<typeof sql>): Promise<number> {
  const db = await getDb();
  return Number(firstRow<{ n: number }>(await db.execute(query))?.n ?? 0);
}

async function main() {
  const tables = await scalar(
    sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  const triggers = await scalar(sql`SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal`);
  const indexes = await scalar(sql`SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname = 'public'`);
  const checks = await scalar(sql`SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'c'`);
  const foreignKeys = await scalar(sql`SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f'`);
  const uniques = await scalar(sql`SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'u'`);

  console.info('RIFTARA schema objects');
  console.info(`  tables        ${tables}`);
  console.info(`  indexes       ${indexes}`);
  console.info(`  foreign keys  ${foreignKeys}`);
  console.info(`  unique keys   ${uniques}`);
  console.info(`  check rules   ${checks}`);
  console.info(`  triggers      ${triggers}`);

  const required = [
    'reservations_one_active_per_unit',
    'valuations_one_current_per_property',
    'contracts_active_unit_idx',
    'invoices_outstanding_idx',
  ];
  for (const name of required) {
    const found = await scalar(
      sql`SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${name}`,
    );
    if (found === 0) throw new Error(`Missing required index: ${name}`);
  }

  const requiredTriggers = [
    'trg_contracts_no_overlap',
    'trg_contracts_protect_delete',
    'trg_invoices_block_delete',
    'trg_payments_block_delete',
    'trg_audit_logs_append_only',
    'trg_price_history_append_only',
  ];
  for (const name of requiredTriggers) {
    const found = await scalar(
      sql`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = ${name} AND NOT tgisinternal`,
    );
    if (found === 0) throw new Error(`Missing required trigger: ${name}`);
  }

  console.info('All required integrity objects present.');
  process.exit(0);
}

main().catch((error) => {
  console.error('[verify] failed:', error);
  process.exit(1);
});
