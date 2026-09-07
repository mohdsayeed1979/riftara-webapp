import 'server-only';
import { redirect } from 'next/navigation';
import type { PermissionKey } from '@/lib/permissions/catalog';
import { getSession, type SessionUser } from './session';

/** Thrown when an authenticated user lacks a required permission. */
export class ForbiddenError extends Error {
  readonly code = 'FORBIDDEN';
  constructor(public readonly permission: PermissionKey | PermissionKey[]) {
    super(
      `Missing required permission: ${Array.isArray(permission) ? permission.join(' or ') : permission}`,
    );
    this.name = 'ForbiddenError';
  }
}

export class UnauthenticatedError extends Error {
  readonly code = 'UNAUTHENTICATED';
  constructor() {
    super('Authentication required');
    this.name = 'UnauthenticatedError';
  }
}

export function can(user: SessionUser | null, permission: PermissionKey): boolean {
  if (!user) return false;
  return user.permissions.includes(permission);
}

export function canAny(user: SessionUser | null, required: PermissionKey[]): boolean {
  if (!user) return false;
  return required.some((p) => user.permissions.includes(p));
}

export function canAll(user: SessionUser | null, required: PermissionKey[]): boolean {
  if (!user) return false;
  return required.every((p) => user.permissions.includes(p));
}

/**
 * Server Component / Server Action guard. Redirects unauthenticated users to
 * the login screen and throws for authenticated users lacking the permission.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSession();
  if (!user) redirect('/login');
  return user;
}

export async function requirePermission(permission: PermissionKey): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user, permission)) throw new ForbiddenError(permission);
  return user;
}

export async function requireAnyPermission(required: PermissionKey[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!canAny(user, required)) throw new ForbiddenError(required);
  return user;
}

/**
 * API-route guard. Returns the user or null instead of redirecting, so the
 * route handler can respond with a JSON error envelope.
 */
export async function getApiUser(): Promise<SessionUser | null> {
  return getSession();
}
