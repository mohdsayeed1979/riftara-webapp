import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { permissions, rolePermissions, roles, userRoles } from '@/db/schema';
import type { DbExecutor } from '@/db/types';
import { recordAudit } from '@/lib/audit';
import { conflict, forbidden, notFound, validationError } from '@/lib/errors';
import { PERMISSION_KEYS, type PermissionKey } from '@/lib/permissions/catalog';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Custom role & permission administration (Phase 8B, P1).
 *
 * System roles (isSystem=true), especially super_admin, are immutable here.
 * A non-Super-Admin may only create/grant permissions that are a subset of
 * their own effective permissions (no privilege escalation). All enforcement
 * is server-side; the UI's checkbox gating is convenience only.
 */

const SUPER_ADMIN_KEY = 'super_admin';

function normalizeRoleKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function actorIsSuperAdmin(actor: SessionUser): boolean {
  return actor.roleKeys.includes(SUPER_ADMIN_KEY);
}

/** Validates permission keys against the catalog and enforces the actor-subset
 *  rule (Super Admin exempt). Returns the distinct valid keys. */
function authorizePermissionKeys(actor: SessionUser, keys: string[]): PermissionKey[] {
  const catalog = new Set<string>(PERMISSION_KEYS);
  const unique = Array.from(new Set(keys));
  for (const key of unique) {
    if (!catalog.has(key)) throw validationError(`Unknown permission: ${key}`);
  }
  if (!actorIsSuperAdmin(actor)) {
    const actorPerms = new Set<string>(actor.permissions);
    for (const key of unique) {
      if (!actorPerms.has(key)) throw forbidden('You cannot grant permissions you do not hold.');
    }
  }
  return unique as PermissionKey[];
}

/** Resolves catalog permission keys to their permission-table ids. */
async function permissionIdsForKeys(tx: DbExecutor, keys: string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  const rows = await tx.select({ id: permissions.id, key: permissions.key }).from(permissions).where(inArray(permissions.key, keys));
  if (rows.length !== keys.length) throw validationError('One or more permissions are not registered.');
  return rows.map((r) => r.id);
}

async function requireCustomOrgRole(tx: DbExecutor, organizationId: string, roleId: string) {
  const [role] = await tx
    .select({ id: roles.id, key: roles.key, nameEn: roles.nameEn, nameAr: roles.nameAr, description: roles.description, isSystem: roles.isSystem })
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.organizationId, organizationId)))
    .limit(1);
  if (!role) throw notFound('Role', roleId);
  if (role.isSystem) throw forbidden('System roles cannot be modified.');
  return role;
}

/* -------------------------------------------------------------------------- */

export interface CreateRoleInput {
  key: string;
  nameEn: string;
  nameAr?: string;
  description?: string;
  permissionKeys?: string[];
}

export async function createRole(actor: SessionUser, input: CreateRoleInput): Promise<{ id: string; key: string }> {
  const key = normalizeRoleKey(input.key);
  if (key.length < 2) throw validationError('Enter a valid role key (letters, numbers, underscores).');
  if (key === SUPER_ADMIN_KEY) throw forbidden('That role key is reserved.');
  if (!input.nameEn?.trim()) throw validationError('Enter the role name.');
  const permKeys = authorizePermissionKeys(actor, input.permissionKeys ?? []);

  const db = await getDb();
  return db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: roles.id }).from(roles).where(and(eq(roles.organizationId, actor.organizationId), eq(roles.key, key))).limit(1);
    if (dup) throw conflict('A role with this key already exists in your organization.');

    const [created] = await tx
      .insert(roles)
      .values({
        organizationId: actor.organizationId, // session org only
        key,
        nameEn: input.nameEn.trim(),
        nameAr: input.nameAr?.trim() || null,
        description: input.description?.trim() || null,
        isSystem: false,
      })
      .returning({ id: roles.id });

    if (permKeys.length > 0) {
      const permIds = await permissionIdsForKeys(tx, permKeys);
      await tx.insert(rolePermissions).values(permIds.map((permissionId) => ({ roleId: created.id, permissionId })));
    }

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'create',
      entityType: 'role',
      entityId: created.id,
      entityLabel: input.nameEn.trim(),
      newValue: { key, permissions: permKeys },
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: created.id, key };
  });
}

export interface UpdateRoleInput {
  nameEn: string;
  nameAr?: string;
  description?: string;
}

/** Updates a custom role's display fields only. Key, organization and isSystem
 *  are immutable; system roles are rejected. */
export async function updateRole(actor: SessionUser, roleId: string, input: UpdateRoleInput): Promise<{ id: string }> {
  if (!input.nameEn?.trim()) throw validationError('Enter the role name.');
  const db = await getDb();
  return db.transaction(async (tx) => {
    const existing = await requireCustomOrgRole(tx, actor.organizationId, roleId);
    await tx
      .update(roles)
      .set({ nameEn: input.nameEn.trim(), nameAr: input.nameAr?.trim() || null, description: input.description?.trim() || null, updatedAt: new Date() })
      .where(eq(roles.id, roleId));
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'role',
      entityId: roleId,
      entityLabel: input.nameEn.trim(),
      previousValue: { nameEn: existing.nameEn, description: existing.description },
      newValue: { nameEn: input.nameEn.trim(), description: input.description?.trim() || null },
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: roleId };
  });
}

/** Atomically replaces a custom role's permission set (subset-guarded). */
export async function setRolePermissions(actor: SessionUser, roleId: string, permissionKeys: string[]): Promise<{ id: string }> {
  const permKeys = authorizePermissionKeys(actor, permissionKeys);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const role = await requireCustomOrgRole(tx, actor.organizationId, roleId);
    const previous = (
      await tx.select({ key: permissions.key }).from(rolePermissions).innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId)).where(eq(rolePermissions.roleId, roleId))
    ).map((r) => r.key);

    const permIds = await permissionIdsForKeys(tx, permKeys);
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    if (permIds.length > 0) {
      await tx.insert(rolePermissions).values(permIds.map((permissionId) => ({ roleId, permissionId })));
    }

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'role',
      entityId: roleId,
      entityLabel: role.nameEn,
      previousValue: { permissions: previous },
      newValue: { permissions: permKeys },
      reason: 'role_permissions_changed',
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: roleId };
  });
}

/** Deletes a custom role. Blocked for system roles and roles still assigned. */
export async function deleteRole(actor: SessionUser, roleId: string): Promise<{ id: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const role = await requireCustomOrgRole(tx, actor.organizationId, roleId);
    const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(userRoles).where(eq(userRoles.roleId, roleId));
    if (Number(total) > 0) throw conflict(`This role is still assigned to ${total} user(s). Reassign them before deleting it.`);

    await tx.delete(roles).where(eq(roles.id, roleId)); // cascades role_permissions
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'delete',
      entityType: 'role',
      entityId: roleId,
      entityLabel: role.nameEn,
      previousValue: { key: role.key },
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: roleId };
  });
}

/* -------------------------------------------------------------------------- */
/* Read helpers                                                                */
/* -------------------------------------------------------------------------- */

export async function getRoleDetail(organizationId: string, roleId: string) {
  const db = await getDb();
  const [role] = await db
    .select({ id: roles.id, key: roles.key, nameEn: roles.nameEn, nameAr: roles.nameAr, description: roles.description, isSystem: roles.isSystem, createdAt: roles.createdAt })
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.organizationId, organizationId)))
    .limit(1);
  if (!role) return null;
  const permKeys = (
    await db.select({ key: permissions.key }).from(rolePermissions).innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId)).where(eq(rolePermissions.roleId, roleId))
  ).map((r) => r.key);
  const [{ users: userCount }] = await db.select({ users: sql<number>`count(distinct ${userRoles.userId})::int` }).from(userRoles).where(eq(userRoles.roleId, roleId));
  return { role, permissionKeys: permKeys, userCount: Number(userCount) };
}

/** The catalog permission keys the actor is allowed to grant (Super Admin: all). */
export function assignablePermissionKeys(actor: SessionUser): Set<string> {
  if (actorIsSuperAdmin(actor)) return new Set<string>(PERMISSION_KEYS);
  return new Set<string>(actor.permissions);
}
