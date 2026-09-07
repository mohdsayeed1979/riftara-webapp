import type { Metadata } from 'next';
import { asc, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { permissions, rolePermissions, roles } from '@/db/schema';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/misc';
import { PageHeader, SectionTitle } from '@/components/ui/page';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { requirePermission } from '@/lib/auth/guard';

export const metadata: Metadata = { title: 'Permissions' };
export const dynamic = 'force-dynamic';

/**
 * Permission matrix (BRD 54, 126) — the role × permission grid. Read-only
 * here; the assignment API is scoped to Super Admin.
 */
export default async function PermissionsPage() {
  const user = await requirePermission('users:view');
  const db = await getDb();

  const [allPermissions, allRoles, assignments] = await Promise.all([
    db.select().from(permissions).orderBy(asc(permissions.module), asc(permissions.action)),
    db.select({ id: roles.id, nameEn: roles.nameEn }).from(roles).where(eq(roles.organizationId, user.organizationId)).orderBy(roles.nameEn),
    db
      .select({ roleId: rolePermissions.roleId, permissionId: rolePermissions.permissionId })
      .from(rolePermissions)
      .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
      .where(eq(roles.organizationId, user.organizationId)),
  ]);

  const assigned = new Set(assignments.map((a) => `${a.roleId}:${a.permissionId}`));
  const modules = Array.from(new Set(allPermissions.map((p) => p.module)));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Users & Permissions', href: '/users' }, { label: 'Permissions' }]}
        title="Permissions"
        subtitle="Granular permission matrix. Each role grants a specific set of module actions."
      />

      {modules.map((module) => {
        const modulePermissions = allPermissions.filter((p) => p.module === module);
        return (
          <div key={module}>
            <SectionTitle>
              <span className="capitalize">{module}</span>
            </SectionTitle>
            <Card>
              <TableContainer>
                <Table>
                  <THead>
                    <TR>
                      <TH>Permission</TH>
                      {allRoles.map((role) => (
                        <TH key={role.id} alignment="center" className="min-w-20 max-w-24">
                          <span className="block truncate">{role.nameEn}</span>
                        </TH>
                      ))}
                    </TR>
                  </THead>
                  <TBody>
                    {modulePermissions.map((permission) => (
                      <TR key={permission.id}>
                        <TD>
                          <span className="font-medium capitalize">{permission.action}</span>
                          <span className="block text-[11px] text-[var(--color-text-tertiary)]">{permission.description}</span>
                        </TD>
                        {allRoles.map((role) => (
                          <TD key={role.id} alignment="center">
                            <div className="flex justify-center">
                              <Checkbox checked={assigned.has(`${role.id}:${permission.id}`)} disabled aria-label={`${role.nameEn} ${permission.key}`} />
                            </div>
                          </TD>
                        ))}
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableContainer>
            </Card>
          </div>
        );
      })}
    </div>
  );
}
