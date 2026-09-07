import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './schema';

/**
 * Driver-agnostic database type. Every repository and service depends on this
 * rather than on a concrete driver, so swapping PGlite for a managed
 * PostgreSQL instance is an environment change, not a code change.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

/** The handle passed inside `db.transaction(...)`. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Accepts either the root database or an open transaction. */
export type DbExecutor = Database | Transaction;
