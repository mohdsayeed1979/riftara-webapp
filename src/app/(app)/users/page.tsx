import type { Metadata } from 'next';
import Link from 'next/link';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { roles, userRoles, userScopes, users } from '@/db/schema';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Avatar } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/page';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { requirePermission } from '@/lib/auth/guard';
import { formatRelativeTime } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';

export const metadata: Metadata = { title: 'Users & Permissions' };
export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const user = await requirePermission('users:view');
  const locale = await getRequestLocale();
  const db = await getDb();

  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      jobTitle: users.jobTitle,
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
    .where(and(eq(users.organizationId, user.organizationId), isNull(users.deletedAt)))
    .groupBy(users.id, users.fullName, users.email, users.jobTitle, users.isActive, users.lastLoginAt, users.avatarUrl)
    .orderBy(desc(users.isActive), users.fullName);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Users & Permissions"
        subtitle="Manage users, roles and granular permissions."
        actions={
          <div className="flex gap-2">
            <Link href="/roles" className="rounded-[var(--radius-control)] border border-[var(--color-border-base)] bg-[var(--color-surface)] px-3.5 py-2 text-[13px] font-medium transition-colors hover:bg-[var(--color-surface-alt)]">
              Roles
            </Link>
            <Link href="/permissions" className="rounded-[var(--radius-control)] border border-[var(--color-border-base)] bg-[var(--color-surface)] px-3.5 py-2 text-[13px] font-medium transition-colors hover:bg-[var(--color-surface-alt)]">
              Permissions
            </Link>
          </div>
        }
      />

      <Card>
        <TableContainer>
          <Table>
            <THead>
              <TR>
                <TH>User</TH>
                <TH>Role</TH>
                <TH>Data Scope</TH>
                <TH alignment="end">Last Login</TH>
                <TH alignment="center">Status</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => (
                <TR key={row.id}>
                  <TD>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={row.fullName} src={row.avatarUrl} size="sm" />
                      <div className="min-w-0">
                        <span className="block font-medium text-[var(--color-text-primary)]">{row.fullName}</span>
                        <span className="block text-[11px] text-[var(--color-text-tertiary)]">{row.email}</span>
                      </div>
                    </div>
                  </TD>
                  <TD>
                    {row.roleNames ? (
                      <span className="text-[var(--color-text-secondary)]">{row.roleNames}</span>
                    ) : (
                      <span className="text-[var(--color-text-tertiary)]">No role</span>
                    )}
                  </TD>
                  <TD className="text-[var(--color-text-secondary)]">
                    {Number(row.scopeCount) === 0 ? 'Organization-wide' : `${row.scopeCount} scoped`}
                  </TD>
                  <TD alignment="end" className="whitespace-nowrap text-[var(--color-text-secondary)]">
                    {row.lastLoginAt ? formatRelativeTime(row.lastLoginAt, { locale }) : 'Never'}
                  </TD>
                  <TD alignment="center">
                    <Badge tone={row.isActive ? 'success' : 'neutral'} dot>
                      {row.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      </Card>
    </div>
  );
}
