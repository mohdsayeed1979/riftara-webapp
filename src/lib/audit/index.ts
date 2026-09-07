import 'server-only';
import { headers } from 'next/headers';
import { auditLogs } from '@/db/schema';
import type { DbExecutor } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Audit trail writer (BRD 136, BR-017).
 *
 * The table is append-only at the database level. Callers pass the executor so
 * an audit entry is written inside the same transaction as the change it
 * records — if the change rolls back, so does its audit row.
 */

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'soft_delete'
  | 'restore'
  | 'approve'
  | 'reject'
  | 'publish'
  | 'unpublish'
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'export'
  | 'import'
  | 'sign'
  | 'allocate'
  | 'sync';

export interface AuditEntry {
  organizationId: string;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  previousValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  approvalReference?: string | null;
  actor?: Pick<SessionUser, 'id' | 'fullName'> | null;
}

/** Fields never written to the audit trail in clear text. */
const REDACTED_FIELDS = new Set(['passwordHash', 'password', 'tokenHash', 'keyHash', 'secretHash']);

function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = REDACTED_FIELDS.has(key) ? '[redacted]' : redact(entry);
    }
    return result;
  }
  return value;
}

/** Field-level diff so reviewers see exactly what changed. */
export function diffRecords(
  previous: Record<string, unknown> | null | undefined,
  next: Record<string, unknown> | null | undefined,
): string[] {
  if (!previous || !next) return [];
  const changed: string[] = [];
  for (const key of Object.keys(next)) {
    if (REDACTED_FIELDS.has(key)) continue;
    const before = previous[key];
    const after = next[key];
    if (before instanceof Date && after instanceof Date) {
      if (before.getTime() !== after.getTime()) changed.push(key);
      continue;
    }
    if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)) changed.push(key);
  }
  return changed;
}

async function requestContext(): Promise<{ ip: string | null; device: string | null }> {
  try {
    const headerList = await headers();
    const forwarded = headerList.get('x-forwarded-for');
    return {
      ip: forwarded ? (forwarded.split(',')[0]?.trim() ?? null) : headerList.get('x-real-ip'),
      device: headerList.get('user-agent')?.slice(0, 400) ?? null,
    };
  } catch {
    // Outside a request scope (background job, seed, CLI).
    return { ip: null, device: null };
  }
}

export async function recordAudit(executor: DbExecutor, entry: AuditEntry): Promise<void> {
  const { ip, device } = await requestContext();
  const previousValue = redact(entry.previousValue) as Record<string, unknown> | null;
  const newValue = redact(entry.newValue) as Record<string, unknown> | null;

  await executor.insert(auditLogs).values({
    organizationId: entry.organizationId,
    userId: entry.actor?.id ?? null,
    actorLabel: entry.actor?.fullName ?? 'System',
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    entityLabel: entry.entityLabel ?? null,
    previousValue,
    newValue,
    changedFields: diffRecords(previousValue, newValue),
    reason: entry.reason ?? null,
    approvalReference: entry.approvalReference ?? null,
    ipAddress: ip,
    device,
  });
}

/**
 * Convenience wrapper for the common "mutate then audit" shape, so a service
 * cannot accidentally commit a change without recording it.
 */
export async function withAudit<T>(
  executor: DbExecutor,
  entry: Omit<AuditEntry, 'newValue'>,
  mutate: () => Promise<T>,
  describe: (result: T) => unknown = (result) => result,
): Promise<T> {
  const result = await mutate();
  await recordAudit(executor, { ...entry, newValue: describe(result) });
  return result;
}
