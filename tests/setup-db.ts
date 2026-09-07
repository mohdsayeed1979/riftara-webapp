import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Spins up an isolated PGlite database for integration tests: a fresh temp
 * data directory, migrations + constraints applied, and the demo seed loaded.
 * Each test file that imports this gets the same seeded organization.
 */
export async function bootstrapTestDb() {
  const dir = mkdtempSync(join(tmpdir(), 'riftara-test-'));
  process.env.DATABASE_DRIVER = 'pglite';
  process.env.PGLITE_DATA_DIR = dir;
  process.env.DEMO_MODE = 'true';
  process.env.AUTH_SECRET = 'test-secret-value-at-least-32-characters-long';
  process.env.SEED_DEFAULT_PASSWORD = 'Riftara#2025';

  const { getConnection } = await import('@/db/client');
  const { runMigrations } = await import('@/db/migrate');
  const { seedDatabase } = await import('@/db/seed');

  const { db, runScript } = await getConnection();
  await runMigrations(db, runScript);
  await seedDatabase(db);

  return {
    db,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    },
  };
}
