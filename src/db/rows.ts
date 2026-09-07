/**
 * Normalises the shape of `db.execute()` results.
 *
 * The postgres-js driver returns an array of rows, while the PGlite driver
 * returns `{ rows: [...] }`. Repositories that use raw SQL go through this
 * helper so they stay driver-agnostic.
 */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  return [];
}

export function firstRow<T>(result: unknown): T | undefined {
  return rowsOf<T>(result)[0];
}
