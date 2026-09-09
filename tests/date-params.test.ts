import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, gte, isNull } from 'drizzle-orm';
import { bootstrapTestDb } from './setup-db';
import { normalizeDriverParams } from '@/db/param-normalize';
import type { Database } from '@/db/types';

/**
 * Regression coverage for the production `/leasing` crash:
 *
 *   TypeError [ERR_INVALID_ARG_TYPE]: The "string" argument must be of type
 *   string or an instance of Buffer or ArrayBuffer. Received an instance of Date
 *
 * ROOT CAUSE: `drizzle-orm/postgres-js` replaces postgres-js's serializers for
 * every date/time type OID (1184 timestamptz, 1114 timestamp, ...) with a
 * transparent pass-through, because drizzle stringifies Date values itself in
 * its typed-column encoders. A JavaScript `Date` interpolated into a RAW `sql`
 * fragment (e.g. the leasing KPI `count(*) filter (where created_at >= $1)`)
 * has no column type for drizzle to key off, so the raw Date reaches postgres-js
 * and — with the timestamp serializer neutralized — is written straight to the
 * wire buffer and throws. PGlite uses a different adapter that keeps its own Date
 * encoding, so the failure only ever manifested on the production postgres-js
 * driver. The fix normalizes Date parameters to ISO-8601 strings at the driver
 * boundary (`normalizeDriverParams`).
 */

const FOREIGN_ORG = '00000000-0000-4000-8000-000000000000';
const INSTANT = '2026-09-01T00:00:00.000Z';

describe('normalizeDriverParams — postgres-js Date boundary', () => {
  it('converts a Date to an ISO-8601 string, preserving the exact UTC instant', () => {
    const date = new Date(INSTANT);
    const [out] = normalizeDriverParams([date]) as unknown[];
    expect(out).toBe(INSTANT);
    // The precise moment must be preserved (no local-timezone shift).
    expect(new Date(out as string).getTime()).toBe(date.getTime());
    // The Date instance — the exact value that crashed postgres-js — is gone.
    expect(out).not.toBeInstanceOf(Date);
  });

  it('leaves every non-Date parameter type untouched', () => {
    const uuid = '2f1e9c46-3230-4c27-a882-12c3cacac333';
    const params = ['text', 42, 0, -1.5, true, false, null, undefined, uuid, { a: 1, b: 'x' }];
    expect(normalizeDriverParams(params)).toEqual(params);
  });

  it('does not corrupt bytea / Uint8Array parameters', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const [out] = normalizeDriverParams([bytes]) as unknown[];
    expect(out).toBe(bytes); // same reference, untouched
  });

  it('normalizes Date elements inside an array parameter (e.g. inArray)', () => {
    const a = new Date('2026-01-01T00:00:00.000Z');
    const b = new Date('2026-02-01T00:00:00.000Z');
    const uuids = ['a', 'b'];
    const [dates, ids] = normalizeDriverParams([[a, b], uuids]) as unknown[][];
    expect(dates).toEqual(['2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z']);
    expect(ids).toBe(uuids); // an array with no Dates is returned as-is
  });

  it('returns non-array parameter lists untouched', () => {
    expect(normalizeDriverParams(undefined)).toBeUndefined();
    expect(normalizeDriverParams(null)).toBeNull();
  });
});

describe('root cause — drizzle neutralizes the postgres-js timestamp serializer', () => {
  it('reproduces the crash trigger offline and proves the normalization removes it', async () => {
    const postgres = (await import('postgres')).default;
    const { drizzle } = await import('drizzle-orm/postgres-js');
    // postgres-js is lazy: constructing a client opens NO connection, so this
    // needs no database. `drizzle(client)` installs the transparent date
    // serializers that cause the production failure.
    const client = postgres('postgresql://user:pass@127.0.0.1:1/none');
    try {
      drizzle(client, {});
      const serializeTimestamptz = (client.options.serializers as Record<string, (v: unknown) => unknown>)['1184'];
      expect(serializeTimestamptz).toBeTypeOf('function');
      // BEFORE the fix: a raw Date passes through unchanged → later written to the
      // wire buffer as a Date → ERR_INVALID_ARG_TYPE.
      expect(serializeTimestamptz(new Date(INSTANT))).toBeInstanceOf(Date);
      // AFTER the fix: the boundary normalizer yields a string the driver accepts.
      const normalized = (normalizeDriverParams([new Date(INSTANT)]) as unknown[])[0];
      expect(serializeTimestamptz(normalized)).toBe(INSTANT);
      expect(typeof serializeTimestamptz(normalized)).toBe('string');
    } finally {
      await client.end({ timeout: 0 });
    }
  });
});

describe('leasing & dashboard KPI queries with a Date parameter (production path)', () => {
  let db: Database;
  let cleanup: () => void;
  let orgId = '';

  beforeAll(async () => {
    const ctx = await bootstrapTestDb();
    db = ctx.db;
    cleanup = ctx.cleanup;
    const { organizations } = await import('@/db/schema');
    const [org] = await db.select({ id: organizations.id }).from(organizations).limit(1);
    orgId = org.id;
  }, 180_000);

  afterAll(() => cleanup?.());

  it('executes the leasing lead-KPI query (count + count-since-month) without throwing', async () => {
    const { getLeasingKpis } = await import('@/services/lead-service');
    const kpis = await getLeasingKpis({ organizationId: orgId, allowedPropertyIds: null });
    for (const value of Object.values(kpis)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns the correct "new this month" count — matching the typed-column path exactly', async () => {
    const { getLeasingKpis } = await import('@/services/lead-service');
    const { leads } = await import('@/db/schema');
    // Recompute the same window with drizzle's typed-column encoder (a known-good
    // path), and require the RAW `sql` Date-filter path to agree — proving the
    // instant is handled correctly, not merely that it does not throw.
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const [expected] = await db
      .select({ c: leads.id })
      .from(leads)
      .where(and(eq(leads.organizationId, orgId), isNull(leads.deletedAt), gte(leads.createdAt, monthStart)))
      .then((rows) => [rows.length]);

    const kpis = await getLeasingKpis({ organizationId: orgId, allowedPropertyIds: null });
    expect(kpis.newInquiries).toBe(expected);
    expect(kpis.totalLeads).toBeGreaterThan(0); // populated seed
  });

  it('returns all zeros for an empty / foreign organization (isolation + empty table)', async () => {
    const { getLeasingKpis } = await import('@/services/lead-service');
    const kpis = await getLeasingKpis({ organizationId: FOREIGN_ORG, allowedPropertyIds: null });
    expect(kpis).toEqual({
      totalLeads: 0,
      newInquiries: 0,
      siteViewings: 0,
      proposalsSent: 0,
      reservations: 0,
      contractsSigned: 0,
    });
  });

  it('executes the dashboard leasing-activity query (same Date filter) without throwing', async () => {
    const { getLeasingActivity } = await import('@/services/dashboard-service');
    const activity = await getLeasingActivity({ organizationId: orgId });
    expect(Number.isFinite(activity.totalLeads)).toBe(true);
    expect(activity.newThisMonth).toBeGreaterThanOrEqual(0);
  });
});
