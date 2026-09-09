import 'server-only';
import { and, desc, eq, gte, lte, count, type SQL } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { auditLogs, loginAttempts, users } from '@/db/schema';

/**
 * Read-only audit & security queries (Phase 8B). Organization-scoped; never
 * exposes cross-organization records. No writes — auditing is done by
 * `recordAudit`; this service only reads.
 */

export interface AuditLogFilters {
  organizationId: string;
  userId?: string;
  entityType?: string;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  pageSize: number;
}

export interface AuditLogRow {
  id: string;
  createdAt: Date;
  actorLabel: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityLabel: string | null;
  reason: string | null;
  ipAddress: string | null;
}

export async function listAuditLogs(filters: AuditLogFilters): Promise<{ items: AuditLogRow[]; total: number }> {
  const db = await getDb();
  const conditions: SQL[] = [eq(auditLogs.organizationId, filters.organizationId)];
  if (filters.userId) conditions.push(eq(auditLogs.userId, filters.userId));
  if (filters.entityType) conditions.push(eq(auditLogs.entityType, filters.entityType));
  if (filters.action) conditions.push(eq(auditLogs.action, filters.action as typeof auditLogs.$inferSelect.action));
  if (filters.dateFrom) conditions.push(gte(auditLogs.createdAt, new Date(filters.dateFrom)));
  if (filters.dateTo) conditions.push(lte(auditLogs.createdAt, new Date(`${filters.dateTo}T23:59:59.999Z`)));
  const where = and(...conditions) as SQL;

  const rows = await db
    .select({
      id: auditLogs.id,
      createdAt: auditLogs.createdAt,
      actorLabel: auditLogs.actorLabel,
      actorName: users.fullName,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityLabel: auditLogs.entityLabel,
      reason: auditLogs.reason,
      ipAddress: auditLogs.ipAddress,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.userId))
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(filters.pageSize)
    .offset((filters.page - 1) * filters.pageSize);

  const [{ total }] = await db.select({ total: count() }).from(auditLogs).where(where);
  return { items: rows, total: Number(total) };
}

export interface LoginAttemptRow {
  id: string;
  createdAt: Date;
  email: string;
  successful: boolean;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

/** Login attempts for emails belonging to users in the organization (attempts
 *  for unknown emails are not exposed, preserving the org boundary). */
export async function listLoginAttempts(
  organizationId: string,
  opts: { page: number; pageSize: number },
): Promise<{ items: LoginAttemptRow[]; total: number }> {
  const db = await getDb();
  const where = eq(users.organizationId, organizationId);

  const rows = await db
    .select({
      id: loginAttempts.id,
      createdAt: loginAttempts.createdAt,
      email: loginAttempts.email,
      successful: loginAttempts.successful,
      reason: loginAttempts.reason,
      ipAddress: loginAttempts.ipAddress,
      userAgent: loginAttempts.userAgent,
    })
    .from(loginAttempts)
    .innerJoin(users, eq(users.email, loginAttempts.email))
    .where(where)
    .orderBy(desc(loginAttempts.createdAt))
    .limit(opts.pageSize)
    .offset((opts.page - 1) * opts.pageSize);

  const [{ total }] = await db
    .select({ total: count() })
    .from(loginAttempts)
    .innerJoin(users, eq(users.email, loginAttempts.email))
    .where(where);
  return { items: rows, total: Number(total) };
}

/** Distinct entity types present in the org's audit log (for the filter list). */
export async function listAuditEntityTypes(organizationId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .selectDistinct({ entityType: auditLogs.entityType })
    .from(auditLogs)
    .where(eq(auditLogs.organizationId, organizationId))
    .orderBy(auditLogs.entityType);
  return rows.map((r) => r.entityType);
}
