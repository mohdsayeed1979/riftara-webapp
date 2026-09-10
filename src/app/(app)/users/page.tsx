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
import { getMessages, interpolate } from '@/i18n';
import { getAssignableRoles } from '@/services/user-admin-service';

export const metadata: Metadata = { title: 'Users & Permissions' };
export const dynamic = 'force-dynamic';

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission('users:view');
  const params = await searchParams;
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  const t = m.users;
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
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" asChild><Link href="/roles">{t.roles}</Link></Button>
            <Button variant="secondary" asChild><Link href="/permissions">{t.permissions}</Link></Button>
            {canCreate ? <UserFormDialog mode="create" roles={assignableRoles} /> : null}
          </div>
        }
      />

      <Card>
        <div className="px-5 pb-3 pt-4">
          <FilterBar
            searchPlaceholder={t.searchPlaceholder}
            filters={[
              { key: 'status', placeholder: t.allStatuses, options: [{ value: 'active', label: t.active }, { value: 'inactive', label: t.inactive }] },
              { key: 'roleId', placeholder: t.allRoles, options: assignableRoles.map((r) => ({ value: r.id, label: r.name })) },
            ]}
          />
        </div>
        <div className="px-5 pb-2 text-[12px] text-[var(--color-text-tertiary)]">{interpolate(t.usersCount, { count: rows.length })}</div>
        {rows.length === 0 ? (
          <EmptyState title={t.noUsersTitle} description={t.noUsersHint} />
        ) : (
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH>{t.userCol}</TH>
                  <TH>{t.role}</TH>
                  <TH>{t.dataScope}</TH>
                  <TH alignment="end">{t.lastLogin}</TH>
                  <TH alignment="center">{t.status}</TH>
                  {hasActions ? <TH alignment="end">{m.common.actions}</TH> : null}
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
                    <TD>{row.roleNames ? <span className="text-[var(--color-text-secondary)]">{row.roleNames}</span> : <span className="text-[var(--color-text-tertiary)]">{t.noRole}</span>}</TD>
                    <TD className="text-[var(--color-text-secondary)]">{Number(row.scopeCount) === 0 ? t.organizationWide : interpolate(t.scopedCount, { count: row.scopeCount })}</TD>
                    <TD alignment="end" className="whitespace-nowrap text-[var(--color-text-secondary)]">{row.lastLoginAt ? formatRelativeTime(row.lastLoginAt, { locale }) : t.never}</TD>
                    <TD alignment="center"><Badge tone={row.isActive ? 'success' : 'neutral'} dot>{row.isActive ? t.active : t.inactive}</Badge></TD>
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
