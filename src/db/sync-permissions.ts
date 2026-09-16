/**
 * Idempotent RBAC catalog sync.
 *
 * `seedReference` writes the permission/role catalog once, at initial seed
 * time, into a brand-new organization. When the catalog gains a module or a
 * role gains a permission afterwards (as Phase 17 does with `renewals` and
 * `handovers`), existing organizations need those rows added without
 * re-running the full seed — which would create a second organization and
 * duplicate demo data. This script only inserts what's missing.
 *
 * Safe to run repeatedly. Never deletes or modifies an existing row.
 */
import 'dotenv/config';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { organizations, permissions as permissionsTable, roles, rolePermissions } from './schema';
import { PERMISSIONS, ROLE_DEFINITIONS, resolveRolePermissions } from '@/lib/permissions/catalog';
import type { Database } from './types';

export async function syncPermissions(db: Database): Promise<{ permissionsAdded: number; roleGrantsAdded: number }> {
  const existingPermissions = await db.select({ key: permissionsTable.key }).from(permissionsTable);
  const existingKeys = new Set(existingPermissions.map((p) => p.key));

  const missingPermissions = PERMISSIONS.filter((p) => !existingKeys.has(p.key));
  if (missingPermissions.length > 0) {
    await db.insert(permissionsTable).values(
      missingPermissions.map((p) => ({ key: p.key, module: p.module, action: p.action, description: p.description })),
    );
  }

  const allPermissionRows = await db.select({ id: permissionsTable.id, key: permissionsTable.key }).from(permissionsTable);
  const permissionIdByKey = new Map(allPermissionRows.map((row) => [row.key, row.id]));

  const orgs = await db.select({ id: organizations.id }).from(organizations);

  let roleGrantsAdded = 0;
  for (const org of orgs) {
    const orgRoles = await db.select({ id: roles.id, key: roles.key }).from(roles).where(eq(roles.organizationId, org.id));
    const roleIdByKey = new Map(orgRoles.map((r) => [r.key, r.id]));

    for (const role of ROLE_DEFINITIONS) {
      const roleId = roleIdByKey.get(role.key);
      if (!roleId) continue;

      const existingGrants = await db
        .select({ permissionId: rolePermissions.permissionId })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, roleId));
      const grantedIds = new Set(existingGrants.map((g) => g.permissionId));

      const toGrant = resolveRolePermissions(role)
        .map((key) => permissionIdByKey.get(key))
        .filter((id): id is string => id !== undefined && !grantedIds.has(id));

      if (toGrant.length > 0) {
        await db.insert(rolePermissions).values(toGrant.map((permissionId) => ({ roleId, permissionId })));
        roleGrantsAdded += toGrant.length;
      }
    }
  }

  return { permissionsAdded: missingPermissions.length, roleGrantsAdded };
}

async function main() {
  const { getConnection } = await import('./client');
  const { db } = await getConnection();
  const result = await syncPermissions(db);
  console.info(`[sync-permissions] added ${result.permissionsAdded} permission(s), ${result.roleGrantsAdded} role grant(s)`);
  process.exit(0);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]).replace(/\.ts$/, '') === path.resolve(import.meta.dirname, 'sync-permissions');

if (invokedDirectly) {
  main().catch((error) => {
    console.error('[sync-permissions] failed:', error);
    process.exit(1);
  });
}
