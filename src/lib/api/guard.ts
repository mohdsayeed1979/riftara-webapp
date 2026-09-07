import 'server-only';
import { createHash } from 'node:crypto';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { headers } from 'next/headers';
import { env } from '@/config/env';
import { getDb } from '@/db/client';
import { apiKeys } from '@/db/schema';
import { getSession, type SessionUser } from '@/lib/auth/session';
import { AppError } from '@/lib/errors';
import type { PermissionKey } from '@/lib/permissions/catalog';

/**
 * API authentication and authorization (BRD 3.4, 48).
 *
 * Two credential types are accepted:
 *   - the session cookie, for the first-party web application
 *   - `Authorization: Bearer rft_...` API keys, for server-to-server callers
 *
 * Both resolve to the same permission model, so a route is written once.
 */

export interface ApiPrincipal {
  kind: 'session' | 'api_key';
  organizationId: string;
  userId: string | null;
  label: string;
  permissions: PermissionKey[];
  scopedPropertyIds: string[];
  scopedCityIds: string[];
  rateLimitPerMinute: number;
}

function hashKey(rawKey: string): string {
  return createHash('sha256').update(`${rawKey}${env.API_KEY_SALT}`).digest('hex');
}

async function resolveApiKey(rawKey: string): Promise<ApiPrincipal | null> {
  const db = await getDb();
  const [record] = await db
    .select({
      id: apiKeys.id,
      organizationId: apiKeys.organizationId,
      name: apiKeys.name,
      scopes: apiKeys.scopes,
      rateLimitPerMinute: apiKeys.rateLimitPerMinute,
    })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.keyHash, hashKey(rawKey)),
        isNull(apiKeys.revokedAt),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date())),
      ),
    )
    .limit(1);

  if (!record) return null;

  // Last-used tracking is best-effort and must never fail the request.
  void db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, record.id));

  return {
    kind: 'api_key',
    organizationId: record.organizationId,
    userId: null,
    label: record.name,
    permissions: record.scopes as PermissionKey[],
    scopedPropertyIds: [],
    scopedCityIds: [],
    rateLimitPerMinute: record.rateLimitPerMinute,
  };
}

function fromSession(user: SessionUser): ApiPrincipal {
  return {
    kind: 'session',
    organizationId: user.organizationId,
    userId: user.id,
    label: user.fullName,
    permissions: user.permissions,
    scopedPropertyIds: user.scopedPropertyIds,
    scopedCityIds: user.scopedCityIds,
    rateLimitPerMinute: env.API_RATE_LIMIT_PER_MINUTE,
  };
}

export async function authenticateRequest(): Promise<ApiPrincipal> {
  const headerList = await headers();
  const authorization = headerList.get('authorization');

  if (authorization?.startsWith('Bearer ')) {
    const principal = await resolveApiKey(authorization.slice(7).trim());
    if (!principal) throw new AppError('UNAUTHENTICATED', 'The API key is invalid or has been revoked.');
    return principal;
  }

  const session = await getSession();
  if (!session) throw new AppError('UNAUTHENTICATED', 'Authentication is required.');
  return fromSession(session);
}

export async function requireApiPermission(permission: PermissionKey): Promise<ApiPrincipal> {
  const principal = await authenticateRequest();
  if (!principal.permissions.includes(permission)) {
    throw new AppError('FORBIDDEN', `Missing required permission: ${permission}`);
  }
  await enforceRateLimit(principal);
  return principal;
}

/* -------------------------------------------------------------------------- */
/* Rate limiting                                                               */
/* -------------------------------------------------------------------------- */

interface Bucket {
  count: number;
  resetAt: number;
}

declare global {
   
  var __riftaraRateBuckets: Map<string, Bucket> | undefined;
}

const buckets = (globalThis.__riftaraRateBuckets ??= new Map<string, Bucket>());

/**
 * Fixed-window rate limiter (BRD 3.4). The in-process store is correct for a
 * single instance; behind a load balancer point `RATE_LIMIT_STORE` at Redis —
 * the call site does not change.
 */
export async function enforceRateLimit(principal: ApiPrincipal): Promise<void> {
  const headerList = await headers();
  const identity =
    principal.kind === 'api_key'
      ? `key:${principal.label}:${principal.organizationId}`
      : `user:${principal.userId}`;
  const ip = headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  const key = `${identity}:${ip}`;

  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 });
    return;
  }

  bucket.count += 1;
  if (bucket.count > principal.rateLimitPerMinute) {
    throw new AppError('RATE_LIMITED', 'Too many requests. Please retry shortly.', { status: 429 });
  }

  // Opportunistic cleanup keeps the map from growing without bound.
  if (buckets.size > 5000) {
    for (const [bucketKey, value] of buckets) {
      if (value.resetAt <= now) buckets.delete(bucketKey);
    }
  }
}
