import 'server-only';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { cities, permissions, properties, rolePermissions, roles, userRoles, userScopes, users } from '@/db/schema';
import type { DbExecutor } from '@/db/types';
import { recordAudit } from '@/lib/audit';
import { conflict, forbidden, notFound, validationError } from '@/lib/errors';
import { hashPassword, checkPasswordPolicy } from '@/lib/auth/password';
import { revokeAllSessionsForUser } from '@/lib/auth/session';
import type { SessionUser } from '@/lib/auth/session';
import type { PermissionKey } from '@/lib/permissions/catalog';

/**
 * User & role administration (Phase 8A, P0).
 *
 * Every mutation is organization-scoped from the actor's session, audited, and
 * guarded against privilege escalation, Super-Admin loss and self-lockout.
 * Reuses the existing password, session and audit infrastructure — no new
 * primitives are introduced.
 */

const SUPER_ADMIN_KEY = 'super_admin';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Loads a target user within the actor's organization or throws NOT_FOUND. */
async function requireOrgUser(tx: DbExecutor, organizationId: string, userId: string) {
  const [user] = await tx
    .select({ id: users.id, isActive: users.isActive, fullName: users.fullName, email: users.email })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.organizationId, organizationId), isNull(users.deletedAt)))
    .limit(1);
  if (!user) throw notFound('User', userId);
  return user;
}

/** The role keys currently held by a user. */
async function roleKeysOfUser(tx: DbExecutor, userId: string): Promise<string[]> {
  const rows = await tx
    .select({ key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));
  return rows.map((r) => r.key);
}

/** The distinct permission keys granted by a set of role ids. */
async function permissionsForRoleIds(tx: DbExecutor, roleIds: string[]): Promise<Set<string>> {
  if (roleIds.length === 0) return new Set();
  const rows = await tx
    .selectDistinct({ key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(inArray(rolePermissions.roleId, roleIds));
  return new Set(rows.map((r) => r.key));
}

/** Number of active Super Admins in the organization, optionally excluding one user. */
async function countActiveSuperAdmins(tx: DbExecutor, organizationId: string, excludeUserId?: string): Promise<number> {
  const conditions = [
    eq(users.organizationId, organizationId),
    eq(users.isActive, true),
    isNull(users.deletedAt),
    eq(roles.key, SUPER_ADMIN_KEY),
  ];
  if (excludeUserId) conditions.push(ne(users.id, excludeUserId));
  const [row] = await tx
    .select({ total: sql<number>`count(distinct ${users.id})::int` })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(...conditions));
  return Number(row?.total ?? 0);
}

/**
 * Resolves + authorizes a requested role-id set against the actor. Returns the
 * validated role rows (all in the actor's organization).
 *
 * Enforces: Super-Admin grant is Super-Admin-only (Rule 4); an actor may only
 * grant roles whose combined permissions the actor already holds (Rule 5).
 */
async function authorizeRoleSet(
  tx: DbExecutor,
  actor: SessionUser,
  roleIds: string[],
): Promise<Array<{ id: string; key: string }>> {
  const uniqueIds = Array.from(new Set(roleIds));
  if (uniqueIds.length === 0) return [];
  const roleRows = await tx
    .select({ id: roles.id, key: roles.key })
    .from(roles)
    .where(and(eq(roles.organizationId, actor.organizationId), inArray(roles.id, uniqueIds)));
  if (roleRows.length !== uniqueIds.length) throw validationError('One or more selected roles are not valid for this organization.');

  const actorIsSuperAdmin = actor.roleKeys.includes(SUPER_ADMIN_KEY);
  if (actorIsSuperAdmin) return roleRows; // Super Admin may grant any role.

  // Rule 4 — only a Super Admin may grant the Super Admin role.
  if (roleRows.some((r) => r.key === SUPER_ADMIN_KEY)) {
    throw forbidden('Only a Super Admin may grant the Super Admin role.');
  }

  // Rule 5 — no privilege escalation: the actor must already hold every
  // permission granted by the requested roles.
  const granted = await permissionsForRoleIds(tx, roleRows.map((r) => r.id));
  const actorPerms = new Set<string>(actor.permissions);
  for (const key of granted) {
    if (!actorPerms.has(key)) {
      throw forbidden('You cannot assign roles that grant permissions you do not hold.');
    }
  }
  return roleRows;
}

/* -------------------------------------------------------------------------- */

export interface CreateUserInput {
  fullName: string;
  fullNameAr?: string;
  email: string;
  password: string;
  jobTitle?: string;
  phone?: string;
  locale?: string;
  isActive?: boolean;
  roleIds?: string[];
}

export async function createUser(actor: SessionUser, input: CreateUserInput): Promise<{ id: string }> {
  const email = normalizeEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw validationError('Enter a valid email address.');
  if (!input.fullName?.trim()) throw validationError('Enter the full name.');
  const policy = checkPasswordPolicy(input.password);
  if (!policy.valid) throw validationError(`Temporary password is too weak: ${policy.errors.join(' ')}`);

  const passwordHash = await hashPassword(input.password);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [dup] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.organizationId, actor.organizationId), eq(users.email, email)))
      .limit(1);
    if (dup) throw conflict('A user with this email already exists in your organization.');

    const roleRows = await authorizeRoleSet(tx, actor, input.roleIds ?? []);

    const [created] = await tx
      .insert(users)
      .values({
        organizationId: actor.organizationId, // session org only — never client-supplied
        email,
        passwordHash,
        fullName: input.fullName.trim(),
        fullNameAr: input.fullNameAr?.trim() || null,
        jobTitle: input.jobTitle?.trim() || null,
        phone: input.phone?.trim() || null,
        locale: input.locale === 'ar' ? 'ar' : 'en',
        isActive: input.isActive ?? true,
        mustChangePassword: true,
      })
      .returning({ id: users.id });

    if (roleRows.length > 0) {
      await tx.insert(userRoles).values(roleRows.map((r) => ({ userId: created.id, roleId: r.id })));
    }

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'create',
      entityType: 'user',
      entityId: created.id,
      entityLabel: email,
      newValue: { email, fullName: input.fullName.trim(), isActive: input.isActive ?? true, roles: roleRows.map((r) => r.key) },
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: created.id };
  });
}

export interface UpdateUserInput {
  fullName: string;
  fullNameAr?: string;
  email: string;
  jobTitle?: string;
  phone?: string;
  locale?: string;
}

/** Updates profile fields only. Password, organization, active state and roles
 *  are handled by their dedicated, separately-authorized operations. */
export async function updateUser(actor: SessionUser, userId: string, input: UpdateUserInput): Promise<{ id: string }> {
  const email = normalizeEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw validationError('Enter a valid email address.');
  if (!input.fullName?.trim()) throw validationError('Enter the full name.');
  const db = await getDb();
  return db.transaction(async (tx) => {
    const existing = await requireOrgUser(tx, actor.organizationId, userId);
    const [dup] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.organizationId, actor.organizationId), eq(users.email, email), ne(users.id, userId)))
      .limit(1);
    if (dup) throw conflict('A user with this email already exists in your organization.');

    await tx
      .update(users)
      .set({
        fullName: input.fullName.trim(),
        fullNameAr: input.fullNameAr?.trim() || null,
        email,
        jobTitle: input.jobTitle?.trim() || null,
        phone: input.phone?.trim() || null,
        locale: input.locale === 'ar' ? 'ar' : 'en',
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'user',
      entityId: userId,
      entityLabel: email,
      previousValue: { email: existing.email, fullName: existing.fullName },
      newValue: { email, fullName: input.fullName.trim() },
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: userId };
  });
}

/** Activates or deactivates a user. Deactivation revokes all sessions and is
 *  blocked for self and for the last active Super Admin. */
export async function setUserActive(actor: SessionUser, userId: string, active: boolean): Promise<{ id: string; isActive: boolean }> {
  if (!active && userId === actor.id) throw conflict('You cannot deactivate your own account.');
  const db = await getDb();
  const result = await db.transaction(async (tx) => {
    const existing = await requireOrgUser(tx, actor.organizationId, userId);
    if (existing.isActive === active) return { id: userId, changed: false, label: existing.email };

    if (!active) {
      const targetRoles = await roleKeysOfUser(tx, userId);
      if (targetRoles.includes(SUPER_ADMIN_KEY)) {
        const remaining = await countActiveSuperAdmins(tx, actor.organizationId, userId);
        if (remaining === 0) throw conflict('Cannot deactivate the last active Super Admin.');
      }
    }

    await tx.update(users).set({ isActive: active, updatedAt: new Date() }).where(eq(users.id, userId));
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'user',
      entityId: userId,
      entityLabel: existing.email,
      previousValue: { isActive: existing.isActive },
      newValue: { isActive: active },
      reason: active ? 'user_activated' : 'user_deactivated',
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: userId, changed: true, label: existing.email };
  });

  // Session revocation happens after the status commit (deactivation only).
  if (!active && result.changed) await revokeAllSessionsForUser(userId);
  return { id: userId, isActive: active };
}

/** Atomically replaces a user's role set (many-to-many). Enforces escalation,
 *  Super-Admin and last-Super-Admin rules. */
export async function setUserRoles(actor: SessionUser, userId: string, roleIds: string[]): Promise<{ id: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const existing = await requireOrgUser(tx, actor.organizationId, userId);
    const previousKeys = await roleKeysOfUser(tx, userId);
    const roleRows = await authorizeRoleSet(tx, actor, roleIds);
    const newKeys = roleRows.map((r) => r.key);

    // Last-Super-Admin protection: removing super_admin from the last active one.
    if (previousKeys.includes(SUPER_ADMIN_KEY) && !newKeys.includes(SUPER_ADMIN_KEY) && existing.isActive) {
      const remaining = await countActiveSuperAdmins(tx, actor.organizationId, userId);
      if (remaining === 0) throw conflict('Cannot remove the Super Admin role from the last active Super Admin.');
    }

    await tx.delete(userRoles).where(eq(userRoles.userId, userId));
    if (roleRows.length > 0) {
      await tx.insert(userRoles).values(roleRows.map((r) => ({ userId, roleId: r.id })));
    }

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'user',
      entityId: userId,
      entityLabel: existing.email,
      previousValue: { roles: previousKeys },
      newValue: { roles: newKeys },
      reason: 'user_roles_changed',
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: userId };
  });
}

/** Administrator-initiated password reset: hashes the new password, forces a
 *  change at next login, and revokes all of the target's sessions. */
export async function adminResetPassword(actor: SessionUser, userId: string, newPassword: string): Promise<{ id: string }> {
  const policy = checkPasswordPolicy(newPassword);
  if (!policy.valid) throw validationError(`Password is too weak: ${policy.errors.join(' ')}`);
  const passwordHash = await hashPassword(newPassword);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const existing = await requireOrgUser(tx, actor.organizationId, userId);
    await tx
      .update(users)
      .set({ passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(users.id, userId));
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'user',
      entityId: userId,
      entityLabel: existing.email,
      newValue: { passwordReset: true, mustChangePassword: true }, // never the password itself
      reason: 'user_password_reset',
      actor: { id: actor.id, fullName: actor.fullName },
    });
  });
  await revokeAllSessionsForUser(userId);
  return { id: userId };
}

/* -------------------------------------------------------------------------- */
/* Read helpers for the admin UI                                               */
/* -------------------------------------------------------------------------- */

/** Assignable roles for the actor: Super Admin sees all org roles; others see
 *  only roles they are authorized to grant (no super_admin, no escalation). */
export async function getAssignableRoles(actor: SessionUser): Promise<Array<{ id: string; name: string; key: string; isSystem: boolean; assignable: boolean }>> {
  const db = await getDb();
  const roleRows = await db
    .select({ id: roles.id, name: roles.nameEn, key: roles.key, isSystem: roles.isSystem })
    .from(roles)
    .where(eq(roles.organizationId, actor.organizationId))
    .orderBy(roles.nameEn);

  const actorIsSuperAdmin = actor.roleKeys.includes(SUPER_ADMIN_KEY);
  if (actorIsSuperAdmin) return roleRows.map((r) => ({ ...r, assignable: true }));

  const actorPerms = new Set<string>(actor.permissions);
  const result: Array<{ id: string; name: string; key: string; isSystem: boolean; assignable: boolean }> = [];
  for (const role of roleRows) {
    if (role.key === SUPER_ADMIN_KEY) { result.push({ ...role, assignable: false }); continue; }
    const granted = await permissionsForRoleIds(db, [role.id]);
    let assignable = true;
    for (const key of granted) if (!actorPerms.has(key)) { assignable = false; break; }
    result.push({ ...role, assignable });
  }
  return result;
}

export async function getUserRoleIds(organizationId: string, userId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ roleId: userRoles.roleId })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(userRoles.userId, userId), eq(users.organizationId, organizationId)));
  return rows.map((r) => r.roleId);
}

export async function getUserDetail(organizationId: string, userId: string) {
  const db = await getDb();
  const [user] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      fullNameAr: users.fullNameAr,
      email: users.email,
      jobTitle: users.jobTitle,
      phone: users.phone,
      locale: users.locale,
      isActive: users.isActive,
      mustChangePassword: users.mustChangePassword,
      mfaEnabled: users.mfaEnabled,
      failedLoginCount: users.failedLoginCount,
      lockedUntil: users.lockedUntil,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.organizationId, organizationId), isNull(users.deletedAt)))
    .limit(1);
  if (!user) return null;
  const roleRows = await db
    .select({ id: roles.id, name: roles.nameEn, key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));
  return { user, roles: roleRows };
}

export type AssignableRole = Awaited<ReturnType<typeof getAssignableRoles>>[number];
export type PermissionKeyList = PermissionKey[];

/* -------------------------------------------------------------------------- */
/* Data-scope assignment (BRD 126) — Phase 8B                                  */
/* -------------------------------------------------------------------------- */

/** Whether the actor is restricted by any data scope (empty = organization-wide). */
function actorIsScopeRestricted(actor: SessionUser): boolean {
  return actor.scopedPropertyIds.length > 0 || actor.scopedCityIds.length > 0;
}

/** Assignable property/city scopes for the actor: an organization-wide actor
 *  (no scope rows) may assign any in-org scope; a scoped actor may only assign
 *  scopes within their own effective scope (no scope escalation). */
export async function getAssignableScopes(actor: SessionUser): Promise<{ properties: Array<{ id: string; name: string }>; cities: Array<{ id: string; name: string }> }> {
  const db = await getDb();
  const restricted = actorIsScopeRestricted(actor);

  const propRows = await db
    .select({ id: properties.id, name: properties.nameEn })
    .from(properties)
    .where(and(eq(properties.organizationId, actor.organizationId), isNull(properties.deletedAt)))
    .orderBy(properties.nameEn);
  const cityRows = await db
    .select({ id: cities.id, name: cities.nameEn })
    .from(cities)
    .where(eq(cities.organizationId, actor.organizationId))
    .orderBy(cities.nameEn);

  if (!restricted || actor.roleKeys.includes(SUPER_ADMIN_KEY)) return { properties: propRows, cities: cityRows };

  const propSet = new Set(actor.scopedPropertyIds);
  const citySet = new Set(actor.scopedCityIds);
  return {
    // A scoped actor can only delegate scopes of a type they themselves hold.
    properties: actor.scopedPropertyIds.length > 0 ? propRows.filter((p) => propSet.has(p.id)) : [],
    cities: actor.scopedCityIds.length > 0 ? cityRows.filter((c) => citySet.has(c.id)) : [],
  };
}

/** Atomically replaces a user's data scopes. Validates every id in-org and,
 *  for a non-Super-Admin, refuses any scope broader than the actor's own. */
export async function setUserScopes(
  actor: SessionUser,
  userId: string,
  input: { propertyIds: string[]; cityIds: string[] },
): Promise<{ id: string }> {
  const propertyIds = Array.from(new Set(input.propertyIds));
  const cityIds = Array.from(new Set(input.cityIds));
  const superAdmin = actor.roleKeys.includes(SUPER_ADMIN_KEY);
  const restricted = actorIsScopeRestricted(actor);

  const db = await getDb();
  return db.transaction(async (tx) => {
    const target = await requireOrgUser(tx, actor.organizationId, userId);

    // In-organization validation.
    if (propertyIds.length > 0) {
      const rows = await tx.select({ id: properties.id }).from(properties).where(and(inArray(properties.id, propertyIds), eq(properties.organizationId, actor.organizationId), isNull(properties.deletedAt)));
      if (rows.length !== propertyIds.length) throw validationError('One or more properties are not valid for this organization.');
    }
    if (cityIds.length > 0) {
      const rows = await tx.select({ id: cities.id }).from(cities).where(and(inArray(cities.id, cityIds), eq(cities.organizationId, actor.organizationId)));
      if (rows.length !== cityIds.length) throw validationError('One or more cities are not valid for this organization.');
    }

    // Escalation guard: a scoped actor cannot grant beyond their own scope.
    if (!superAdmin && restricted) {
      const propSet = new Set(actor.scopedPropertyIds);
      const citySet = new Set(actor.scopedCityIds);
      if (propertyIds.length > 0 && (actor.scopedPropertyIds.length === 0 || !propertyIds.every((id) => propSet.has(id)))) {
        throw forbidden('You cannot grant a property scope broader than your own.');
      }
      if (cityIds.length > 0 && (actor.scopedCityIds.length === 0 || !cityIds.every((id) => citySet.has(id)))) {
        throw forbidden('You cannot grant a city scope broader than your own.');
      }
    }

    const previous = await tx.select({ scopeType: userScopes.scopeType, scopeId: userScopes.scopeId }).from(userScopes).where(eq(userScopes.userId, userId));

    await tx.delete(userScopes).where(eq(userScopes.userId, userId));
    const rowsToInsert = [
      ...propertyIds.map((scopeId) => ({ userId, scopeType: 'property', scopeId })),
      ...cityIds.map((scopeId) => ({ userId, scopeType: 'city', scopeId })),
    ];
    if (rowsToInsert.length > 0) await tx.insert(userScopes).values(rowsToInsert);

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'user',
      entityId: userId,
      entityLabel: target.email,
      previousValue: { scopes: previous },
      newValue: { properties: propertyIds, cities: cityIds },
      reason: 'user_scopes_changed',
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: userId };
  });
}

export async function getUserScopeIds(organizationId: string, userId: string): Promise<{ propertyIds: string[]; cityIds: string[] }> {
  const db = await getDb();
  const [target] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.organizationId, organizationId))).limit(1);
  if (!target) return { propertyIds: [], cityIds: [] };
  const rows = await db.select({ scopeType: userScopes.scopeType, scopeId: userScopes.scopeId }).from(userScopes).where(eq(userScopes.userId, userId));
  return {
    propertyIds: rows.filter((r) => r.scopeType === 'property').map((r) => r.scopeId),
    cityIds: rows.filter((r) => r.scopeType === 'city').map((r) => r.scopeId),
  };
}
