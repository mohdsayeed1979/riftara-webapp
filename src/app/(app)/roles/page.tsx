import type { Metadata } from 'next';
import Link from 'next/link';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { rolePermissions, roles, userRoles } from '@/db/schema';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page';
import { RoleFormDialog } from '@/features/admin/role-dialogs';
import { can, requirePermission } from '@/lib/auth/guard';

export const metadata: Metadata = { title: 'Roles' };
export const dynamic = 'force-dynamic';

export default async function RolesPage() {
  const user = await requirePermission('users:view');
  const db = await getDb();

  const rows = await db
    .select({
      id: roles.id,
      nameEn: roles.nameEn,
      description: roles.description,
      isSystem: roles.isSystem,
      permissionCount: sql<number>`count(distinct ${rolePermissions.permissionId})::int`,
      userCount: sql<number>`count(distinct ${userRoles.userId})::int`,
    })
    .from(roles)
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .leftJoin(userRoles, eq(userRoles.roleId, roles.id))
    .where(eq(roles.organizationId, user.organizationId))
    .groupBy(roles.id, roles.nameEn, roles.description, roles.isSystem)
    .orderBy(roles.nameEn);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Users & Permissions', href: '/users' }, { label: 'Roles' }]}
        title="Roles"
        subtitle="Role definitions and their assigned permissions. Permissions are fully configurable."
        actions={can(user, 'users:manage') ? <RoleFormDialog mode="create" /> : undefined}
      />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((role) => (
          <Card key={role.id}>
            <CardBody>
              <div className="flex items-start justify-between gap-2">
                <Link href={`/roles/${role.id}`} className="text-[14px] font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-info)]">{role.nameEn}</Link>
                {role.isSystem ? <Badge tone="neutral">System</Badge> : <Badge tone="info">Custom</Badge>}
              </div>
              <p className="mt-1 line-clamp-2 text-[12px] text-[var(--color-text-secondary)]">{role.description}</p>
              <div className="mt-3 flex items-center justify-between gap-4 border-t border-[var(--color-border-subtle)] pt-3 text-[12px]">
                <div className="flex gap-4">
                  <span className="text-[var(--color-text-secondary)]"><span className="font-semibold text-[var(--color-text-primary)] tabular">{Number(role.permissionCount)}</span> permissions</span>
                  <span className="text-[var(--color-text-secondary)]"><span className="font-semibold text-[var(--color-text-primary)] tabular">{Number(role.userCount)}</span> users</span>
                </div>
                <Button variant="ghost" size="sm" asChild><Link href={`/roles/${role.id}`}>Manage</Link></Button>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
