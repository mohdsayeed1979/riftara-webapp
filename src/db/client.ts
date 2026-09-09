import { env } from '@/config/env';
import { normalizeDriverParams } from './param-normalize';
import * as schema from './schema';
import type { Database } from './types';

/**
 * Database access is driver-agnostic. Both supported drivers speak real
 * PostgreSQL, so migrations, constraints, transactions and SQL are identical:
 *
 *   pglite   — embedded PostgreSQL (WASM). Zero setup for local development.
 *   postgres — managed PostgreSQL: Supabase, Neon, RDS, ... for production.
 *
 * Switch with DATABASE_DRIVER. No application code changes.
 */

/** Executes a multi-statement SQL script (used for constraint/trigger files). */
export type ScriptRunner = (sqlText: string) => Promise<void>;

/**
 * Wraps a postgres-js client so every parameterized query — top-level and
 * inside transactions — has its Date parameters normalized before serialization
 * (see {@link normalizeDriverParams}). Drizzle executes ALL queries through
 * `client.unsafe(query, params)` and runs transactions via `client.begin`, so
 * intercepting those two methods (and re-wrapping the reserved transaction
 * client) covers every code path. All other properties are delegated unchanged,
 * including `client.options`, which drizzle mutates during construction.
 */
function withDateParamNormalization<T extends object>(client: T): T {
  const wrap = (target: T): T =>
    new Proxy(target, {
      apply: (fn, thisArg, args) => Reflect.apply(fn as never, thisArg, args),
      get(inner, prop, receiver) {
        if (prop === 'unsafe') {
          return (query: string, params?: unknown[], options?: unknown) =>
            (inner as Record<string, (...a: unknown[]) => unknown>).unsafe(
              query,
              normalizeDriverParams(params),
              options,
            );
        }
        if (prop === 'begin') {
          return (arg1: unknown, arg2?: unknown) => {
            const begin = (inner as Record<string, (...a: unknown[]) => unknown>).begin;
            return typeof arg1 === 'function'
              ? begin((reserved: T) => (arg1 as (c: T) => unknown)(wrap(reserved)))
              : begin(arg1, (reserved: T) => (arg2 as (c: T) => unknown)(wrap(reserved)));
          };
        }
        const value = Reflect.get(inner, prop, receiver);
        return typeof value === 'function' ? value.bind(inner) : value;
      },
    });
  return wrap(client);
}

interface Connection {
  db: Database;
  runScript: ScriptRunner;
}

declare global {
   
  var __riftaraConnection: Connection | undefined;
   
  var __riftaraConnectionKey: string | undefined;
}

/** Identifies a connection target so tests pointing at different data dirs
 *  never share a cached handle. */
function connectionKey(): string {
  return env.DATABASE_DRIVER === 'postgres'
    ? `postgres:${env.DATABASE_URL}`
    : `pglite:${env.PGLITE_DATA_DIR}`;
}

async function createConnection(): Promise<Connection> {
  if (env.DATABASE_DRIVER === 'postgres') {
    const [{ drizzle }, postgresModule] = await Promise.all([
      import('drizzle-orm/postgres-js'),
      import('postgres'),
    ]);
    const sql = postgresModule.default(env.DATABASE_URL, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false,
    });
    // Normalize Date parameters at the driver boundary so raw `sql` fragments
    // that interpolate a Date do not crash postgres-js (see normalizeDriverParams).
    const normalizedSql = withDateParamNormalization(sql);
    return {
      db: drizzle(normalizedSql, { schema }) as unknown as Database,
      // Simple query protocol — required for scripts containing several statements.
      // Scripts take no bound parameters, so the raw client is used directly.
      runScript: async (sqlText: string) => {
        await sql.unsafe(sqlText).simple();
      },
    };
  }

  const [{ drizzle }, { PGlite }, { mkdir }, path] = await Promise.all([
    import('drizzle-orm/pglite'),
    import('@electric-sql/pglite'),
    import('node:fs/promises'),
    import('node:path'),
  ]);
  const dataDir = path.resolve(process.cwd(), env.PGLITE_DATA_DIR);
  await mkdir(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  await client.waitReady;
  return {
    db: drizzle(client, { schema }) as unknown as Database,
    runScript: async (sqlText: string) => {
      await client.exec(sqlText);
    },
  };
}

let connectionPromise: Promise<Connection> | undefined;

/**
 * Returns the process-wide connection. It is cached on globalThis so Next.js
 * dev-server hot reloads do not open a second PGlite data directory handle or
 * a second connection pool on every rebuild.
 */
export async function getConnection(): Promise<Connection> {
  const key = connectionKey();
  if (globalThis.__riftaraConnection && globalThis.__riftaraConnectionKey === key) {
    return globalThis.__riftaraConnection;
  }
  // Target changed (e.g. a new test data dir) — build a fresh connection.
  connectionPromise = undefined;
  if (!connectionPromise) {
    connectionPromise = createConnection().then((connection) => {
      globalThis.__riftaraConnection = connection;
      globalThis.__riftaraConnectionKey = key;
      return connection;
    });
  }
  return connectionPromise;
}

export async function getDb(): Promise<Database> {
  return (await getConnection()).db;
}

export { schema };
