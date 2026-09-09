/**
 * Driver-boundary parameter normalization for the postgres-js driver.
 *
 * This module is intentionally dependency-free (it must not import env, schema,
 * or any driver) so it can be unit-tested in isolation and imported from the
 * connection layer without side effects.
 *
 * WHY IT EXISTS — `drizzle-orm/postgres-js` replaces postgres-js's built-in
 * serializers for every date/time type OID (1184 timestamptz, 1114 timestamp,
 * 1082 date, 1083 time, and their array forms) with a transparent pass-through,
 * because drizzle stringifies Date values itself inside its typed-column
 * encoders (`PgTimestamp.mapToDriverValue` → `value.toISOString()`). That leaves
 * exactly one gap: a JavaScript `Date` interpolated into a RAW `sql` fragment —
 * e.g. `count(*) filter (where created_at >= ${monthStart})` — has no column
 * type for drizzle to key off, so the raw Date reaches postgres-js and, with the
 * timestamp serializer neutralized, is written straight to the wire buffer,
 * throwing `TypeError [ERR_INVALID_ARG_TYPE]: ... Received an instance of Date`.
 *
 * PGlite never hits this (its adapter keeps its own Date encoding), which is why
 * the failure only ever appeared against the production postgres-js driver.
 *
 * THE FIX — convert `Date` instances to ISO-8601 strings, the exact same
 * representation drizzle's own typed-column encoder emits, so the compared /
 * stored instant is byte-for-byte identical and the precise UTC moment is
 * preserved. ONLY `Date` instances are transformed; every other parameter type
 * (string, number, boolean, uuid, null/undefined, Uint8Array/bytea, JSON object,
 * and non-Date array elements) passes through untouched.
 */

/** Normalizes a single postgres-js query parameter. */
export function normalizeDriverParam(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    // Array-valued parameter (e.g. `inArray(col, dates)`): normalize only the
    // Date elements, and only allocate a new array when one is present.
    return value.some((element) => element instanceof Date)
      ? value.map(normalizeDriverParam)
      : value;
  }
  return value;
}

/** Normalizes an entire postgres-js parameter list. Returns the input as-is
 *  when it contains no Date values, so the common path allocates nothing. */
export function normalizeDriverParams<T>(params: T): T {
  if (!Array.isArray(params)) return params;
  return (params.some((p) => p instanceof Date || Array.isArray(p))
    ? params.map(normalizeDriverParam)
    : params) as T;
}
