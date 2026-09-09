import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Mail, ShieldCheck, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DetailList, DetailRow, MetaItem, PageHeader } from '@/components/ui/page';
import { UserFormDialog } from '@/features/admin/user-form-dialog';
import { ManageRolesButton, ResetPasswordButton, StatusToggleButton } from '@/features/admin/user-management-actions';
import { ScopeAssignmentDialog } from '@/features/admin/scope-assignment-dialog';
import { can, requirePermission } from '@/lib/auth/guard';
import { isUuid } from '@/lib/utils';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { getAssignableRoles, getAssignableScopes, getUserDetail, getUserRoleIds, getUserScopeIds } from '@/services/user-admin-service';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'User' };

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('users:view');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const locale = await getRequestLocale();

  const data = await getUserDetail(actor.organizationId, id);
  if (!data) notFound();
  const { user, roles } = data;

  const canEdit = can(actor, 'users:edit');
  const canManage = can(actor, 'users:manage');
  const [assignableRoles, currentRoleIds, assignableScopes, currentScopes] = await Promise.all([
    canManage ? getAssignableRoles(actor) : Promise.resolve([]),
    canManage ? getUserRoleIds(actor.organizationId, id) : Promise.resolve([]),
    canManage ? getAssignableScopes(actor) : Promise.resolve({ properties: [], cities: [] }),
    canManage ? getUserScopeIds(actor.organizationId, id) : Promise.resolve({ propertyIds: [], cityIds: [] }),
  ]);
  const locked = user.lockedUntil && user.lockedUntil > new Date();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Users', href: '/users' }, { label: user.fullName }]}
        title={user.fullName}
        badge={<Badge tone={user.isActive ? 'success' : 'neutral'} dot>{user.isActive ? 'Active' : 'Inactive'}</Badge>}
        meta={
          <>
            <MetaItem icon={<Mail />}>{user.email}</MetaItem>
            {user.jobTitle ? <MetaItem icon={<User />}>{user.jobTitle}</MetaItem> : null}
            {roles.length > 0 ? <MetaItem icon={<ShieldCheck />}>{roles.map((r) => r.name).join(', ')}</MetaItem> : null}
          </>
        }
        actions={
          <>
            {canEdit ? <UserFormDialog mode="edit" userId={id} triggerVariant="secondary" initial={{ fullName: user.fullName, fullNameAr: user.fullNameAr ?? undefined, email: user.email, jobTitle: user.jobTitle ?? undefined, phone: user.phone ?? undefined, locale: user.locale }} /> : null}
            {canManage ? <ManageRolesButton userId={id} roles={assignableRoles} currentRoleIds={currentRoleIds} /> : null}
            {canManage ? <ScopeAssignmentDialog userId={id} properties={assignableScopes.properties} cities={assignableScopes.cities} currentPropertyIds={currentScopes.propertyIds} currentCityIds={currentScopes.cityIds} /> : null}
            {canManage ? <ResetPasswordButton userId={id} /> : null}
            {canEdit ? <StatusToggleButton userId={id} isActive={user.isActive} isSelf={id === actor.id} /> : null}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profile" />
          <CardBody className="pt-0">
            <DetailList>
              <DetailRow label="Full Name" value={user.fullName} />
              <DetailRow label="Full Name (AR)" value={user.fullNameAr ?? '—'} />
              <DetailRow label="Email" value={user.email} />
              <DetailRow label="Job Title" value={user.jobTitle ?? '—'} />
              <DetailRow label="Phone" value={user.phone ?? '—'} />
              <DetailRow label="Language" value={user.locale === 'ar' ? 'Arabic' : 'English'} />
            </DetailList>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Access & Security" />
          <CardBody className="pt-0">
            <DetailList>
              <DetailRow label="Status" value={<Badge tone={user.isActive ? 'success' : 'neutral'} dot>{user.isActive ? 'Active' : 'Inactive'}</Badge>} />
              <DetailRow label="Roles" value={roles.length > 0 ? roles.map((r) => r.name).join(', ') : 'No role'} />
              <DetailRow label="Last Login" value={user.lastLoginAt ? formatRelativeTime(user.lastLoginAt, { locale }) : 'Never'} />
              <DetailRow label="Must Change Password" value={user.mustChangePassword ? <Badge tone="warning">Yes</Badge> : 'No'} />
              <DetailRow label="MFA" value={user.mfaEnabled ? 'Enabled' : 'Disabled'} />
              <DetailRow label="Failed Logins" value={String(user.failedLoginCount)} />
              <DetailRow label="Lock Status" value={locked ? <Badge tone="error">Locked until {formatDateTime(user.lockedUntil!, { locale })}</Badge> : 'Not locked'} />
              <DetailRow label="Created" value={formatDateTime(user.createdAt, { locale })} />
            </DetailList>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
