/**
 * Drops all data and re-applies migrations + seed from scratch.
 * Run with: npm run db:reset
 */
import 'dotenv/config';
import { getConnection } from './client';
import { runMigrations } from './migrate';
import { resetDatabase, seedDatabase } from './seed';

async function main() {
  const { db, runScript } = await getConnection();
  console.info('[reset] applying migrations...');
  await runMigrations(db, runScript);
  console.info('[reset] clearing data...');
  await resetDatabase(runScript);
  console.info('[reset] seeding...');
  await seedDatabase(db);
  console.info('[reset] done');
  process.exit(0);
}

main().catch((error) => {
  console.error('[reset] failed:', error);
  process.exit(1);
});
