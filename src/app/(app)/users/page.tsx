import type { Metadata } from 'next';
import Link from 'next/link';
import { and, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { roles, userRoles, userScopes, users } from '@/db/schema';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FilterBar } from '@/components/app/filter-bar';
import { Avatar, EmptyState } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/page';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { UserFormDialog } from '@/features/admin/user-form-dialog';
import { ManageRolesButton, ResetPasswordButton, StatusToggleButton } from '@/features/admin/user-management-actions';
import { can, requirePermission } from '@/lib/auth/guard';
import { formatRelativeTime } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { getAssignableRoles } from '@/services/user-admin-service';

export const metadata: Metadata = { title: 'Users & Permissions' };
export const dynamic = 'force-dynamic';

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission('users:view');
  const params = await searchParams;
  const locale = await getRequestLocale();
  const db = await getDb();

  const canCreate = can(user, 'users:create');
  const canEdit = can(user, 'users:edit');
  const canManage = can(user, 'users:manage');
  const assignableRoles = canCreate || canManage ? await getAssignableRoles(user) : [];

  const conditions: SQL[] = [eq(users.organizationId, user.organizationId), isNull(users.deletedAt)];
  if (params.search) conditions.push(or(ilike(users.fullName, `%${params.search}%`), ilike(users.email, `%${params.search}%`)) as SQL);
  if (params.status === 'active') conditions.push(eq(users.isActive, true));
  if (params.status === 'inactive') conditions.push(eq(users.isActive, false));
  if (params.roleId) {
    const scoped = db.select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.roleId, params.roleId));
    conditions.push(inArray(users.id, scoped));
  }
  const where = and(...conditions) as SQL;

  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      jobTitle: users.jobTitle,
      phone: users.phone,
      locale: users.locale,
      fullNameAr: users.fullNameAr,
      isActive: users.isActive,
      lastLoginAt: users.lastLoginAt,
      avatarUrl: users.avatarUrl,
      roleNames: sql<string>`coalesce(string_agg(distinct ${roles.nameEn}, ', '), '')`,
      scopeCount: sql<number>`count(distinct ${userScopes.id})::int`,
    })
    .from(users)
    .leftJoin(userRoles, eq(userRoles.userId, users.id))
    .leftJoin(roles, eq(roles.id, userRoles.roleId))
    .leftJoin(userScopes, eq(userScopes.userId, users.id))
    .where(where)
    .groupBy(users.id)
    .orderBy(desc(users.isActive), users.fullName);

  // Current role ids per listed user (for the role-management dialog).
  const roleIdRows = rows.length
    ? await db.select({ userId: userRoles.userId, roleId: userRoles.roleId }).from(userRoles).where(inArray(userRoles.userId, rows.map((r) => r.id)))
    : [];
  const roleIdsByUser = new Map<string, string[]>();
  for (const r of roleIdRows) roleIdsByUser.set(r.userId, [...(roleIdsByUser.get(r.userId) ?? []), r.roleId]);

  const hasActions = canEdit || canManage;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Users & Permissions"
        subtitle="Manage users, roles and granular permissions."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" asChild><Link href="/roles">Roles</Link></Button>
            <Button variant="secondary" asChild><Link href="/permissions">Permissions</Link></Button>
            {canCreate ? <UserFormDialog mode="create" roles={assignableRoles} /> : null}
          </div>
        }
      />

      <Card>
        <div className="px-5 pb-3 pt-4">
          <FilterBar
            searchPlaceholder="Search by name or email..."
            filters={[
              { key: 'status', placeholder: 'All Statuses', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
              { key: 'roleId', placeholder: 'All Roles', options: assignableRoles.map((r) => ({ value: r.id, label: r.name })) },
            ]}
          />
        </div>
        <div className="px-5 pb-2 text-[12px] text-[var(--color-text-tertiary)]">{rows.length} user{rows.length === 1 ? '' : 's'}</div>
        {rows.length === 0 ? (
          <EmptyState title="No users found" description="Adjust the filters or create a new user." />
        ) : (
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH>User</TH>
                  <TH>Role</TH>
                  <TH>Data Scope</TH>
                  <TH alignment="end">Last Login</TH>
                  <TH alignment="center">Status</TH>
                  {hasActions ? <TH alignment="end">Actions</TH> : null}
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.id}>
                    <TD>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={row.fullName} src={row.avatarUrl} size="sm" />
                        <div className="min-w-0">
                          <Link href={`/users/${row.id}`} className="block font-medium text-[var(--color-text-primary)] hover:text-[var(--color-info)]">{row.fullName}</Link>
                          <span className="block text-[11px] text-[var(--color-text-tertiary)]">{row.email}</span>
                        </div>
                      </div>
                    </TD>
                    <TD>{row.roleNames ? <span className="text-[var(--color-text-secondary)]">{row.roleNames}</span> : <span className="text-[var(--color-text-tertiary)]">No role</span>}</TD>
                    <TD className="text-[var(--color-text-secondary)]">{Number(row.scopeCount) === 0 ? 'Organization-wide' : `${row.scopeCount} scoped`}</TD>
                    <TD alignment="end" className="whitespace-nowrap text-[var(--color-text-secondary)]">{row.lastLoginAt ? formatRelativeTime(row.lastLoginAt, { locale }) : 'Never'}</TD>
                    <TD alignment="center"><Badge tone={row.isActive ? 'success' : 'neutral'} dot>{row.isActive ? 'Active' : 'Inactive'}</Badge></TD>
                    {hasActions ? (
                      <TD alignment="end">
                        <div className="flex justify-end gap-1.5">
                          {canEdit ? <UserFormDialog mode="edit" userId={row.id} triggerVariant="secondary" initial={{ fullName: row.fullName, fullNameAr: row.fullNameAr ?? undefined, email: row.email, jobTitle: row.jobTitle ?? undefined, phone: row.phone ?? undefined, locale: row.locale }} /> : null}
                          {canManage ? <ManageRolesButton userId={row.id} roles={assignableRoles} currentRoleIds={roleIdsByUser.get(row.id) ?? []} /> : null}
                          {canManage ? <ResetPasswordButton userId={row.id} /> : null}
                          {canEdit ? <StatusToggleButton userId={row.id} isActive={row.isActive} isSelf={row.id === user.id} /> : null}
                        </div>
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        )}
      </Card>
    </div>
  );
}
