/**
 * Migration runner.
 *
 * 1. Applies the Drizzle-generated schema migrations.
 * 2. Applies the hand-written integrity constraints (triggers, partial unique
 *    indexes, check constraints) which Drizzle Kit does not model. These files
 *    are idempotent and safe to re-run on every deploy.
 */
import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env';
import type { ScriptRunner } from './client';
import type { Database } from './types';

const MIGRATIONS_DIR = path.join(process.cwd(), 'src', 'db', 'migrations');
const CONSTRAINTS_DIR = path.join(process.cwd(), 'src', 'db', 'constraints');

export async function runMigrations(db: Database, runScript: ScriptRunner): Promise<void> {
  if (env.DATABASE_DRIVER === 'postgres') {
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(db as any, { migrationsFolder: MIGRATIONS_DIR });
  } else {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(db as any, { migrationsFolder: MIGRATIONS_DIR });
  }

  await applyConstraints(runScript);
}

export async function applyConstraints(runScript: ScriptRunner): Promise<string[]> {
  const applied: string[] = [];
  let files: string[];
  try {
    files = (await readdir(CONSTRAINTS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    return applied;
  }

  for (const file of files) {
    const contents = await readFile(path.join(CONSTRAINTS_DIR, file), 'utf8');
    await runScript(contents);
    applied.push(file);
  }
  return applied;
}

async function main() {
  const { getConnection } = await import('./client');
  const { db, runScript } = await getConnection();
  console.info(`[migrate] driver=${env.DATABASE_DRIVER}`);
  await runMigrations(db, runScript);
  console.info('[migrate] schema + integrity constraints applied');
  process.exit(0);
}

/** Run only when executed directly (`npm run db:migrate`), not when imported. */
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]).replace(/\.ts$/, '') === path.resolve(import.meta.dirname, 'migrate');

if (invokedDirectly) {
  main().catch((error) => {
    console.error('[migrate] failed:', error);
    process.exit(1);
  });
}
