import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '@/config/env';
import { getDb } from '@/db/client';
import { permissions, rolePermissions, roles, sessions, userRoles, userScopes, users } from '@/db/schema';
import type { PermissionKey } from '@/lib/permissions/catalog';

export const SESSION_COOKIE = 'riftara_session';

export interface SessionUser {
  id: string;
  organizationId: string;
  email: string;
  fullName: string;
  jobTitle: string | null;
  avatarUrl: string | null;
  locale: string;
  roleKeys: string[];
  roleNames: string[];
  permissions: PermissionKey[];
  /** Data-level scope (BRD 126). Empty arrays mean organization-wide access. */
  scopedPropertyIds: string[];
  scopedCityIds: string[];
}

interface TokenClaims {
  sub: string;
  sid: string;
  org: string;
}

const secretKey = new TextEncoder().encode(env.AUTH_SECRET);

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: string, organizationId: string): Promise<string> {
  const db = await getDb();
  const rawToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env.AUTH_SESSION_TTL_HOURS * 3600 * 1000);

  const headerList = await headers();
  const [session] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: hashToken(rawToken),
      expiresAt,
      ipAddress: clientIp(headerList),
      userAgent: headerList.get('user-agent')?.slice(0, 500) ?? null,
    })
    .returning({ id: sessions.id });

  const jwt = await new SignJWT({ sid: session.id, org: organizationId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setIssuer('riftara')
    .setAudience('riftara-app')
    .setExpirationTime(expiresAt)
    .sign(secretKey);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, `${jwt}.${rawToken}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });

  return session.id;
}

export function clientIp(headerList: Headers): string | null {
  const forwarded = headerList.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null;
  return headerList.get('x-real-ip');
}

/**
 * Resolves the current session. Verifies the JWT signature AND checks the
 * opaque token against the sessions table, so revoking a session in the
 * database immediately invalidates the cookie.
 */
export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  const separator = raw.lastIndexOf('.');
  if (separator === -1) return null;
  const jwt = raw.slice(0, separator);
  const opaqueToken = raw.slice(separator + 1);

  let claims: TokenClaims;
  try {
    const { payload } = await jwtVerify(jwt, secretKey, {
      issuer: 'riftara',
      audience: 'riftara-app',
    });
    claims = payload as unknown as TokenClaims;
  } catch {
    return null;
  }

  const db = await getDb();
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.id, claims.sid),
        eq(sessions.tokenHash, hashToken(opaqueToken)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!row) return null;

  return loadSessionUser(claims.sub);
}

export async function loadSessionUser(userId: string): Promise<SessionUser | null> {
  const db = await getDb();
  const [user] = await db
    .select({
      id: users.id,
      organizationId: users.organizationId,
      email: users.email,
      fullName: users.fullName,
      jobTitle: users.jobTitle,
      avatarUrl: users.avatarUrl,
      locale: users.locale,
      isActive: users.isActive,
    })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);

  if (!user || !user.isActive) return null;

  const roleRows = await db
    .select({ key: roles.key, name: roles.nameEn })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));

  const permissionRows = await db
    .selectDistinct({ key: permissions.key })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, userId));

  const scopeRows = await db
    .select({ scopeType: userScopes.scopeType, scopeId: userScopes.scopeId })
    .from(userScopes)
    .where(eq(userScopes.userId, userId));

  return {
    id: user.id,
    organizationId: user.organizationId,
    email: user.email,
    fullName: user.fullName,
    jobTitle: user.jobTitle,
    avatarUrl: user.avatarUrl,
    locale: user.locale,
    roleKeys: roleRows.map((r) => r.key),
    roleNames: roleRows.map((r) => r.name),
    permissions: permissionRows.map((p) => p.key as PermissionKey),
    scopedPropertyIds: scopeRows.filter((s) => s.scopeType === 'property').map((s) => s.scopeId),
    scopedCityIds: scopeRows.filter((s) => s.scopeType === 'city').map((s) => s.scopeId),
  };
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;
  cookieStore.delete(SESSION_COOKIE);
  if (!raw) return;

  const separator = raw.lastIndexOf('.');
  if (separator === -1) return;
  const opaqueToken = raw.slice(separator + 1);

  const db = await getDb();
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.tokenHash, hashToken(opaqueToken)));
}

export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  const db = await getDb();
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}
