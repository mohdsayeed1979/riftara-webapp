import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DetailList, DetailRow, MetaItem, PageHeader } from '@/components/ui/page';
import { EmptyState } from '@/components/ui/misc';
import { RoleFormDialog, DeleteRoleButton } from '@/features/admin/role-dialogs';
import { RolePermissionEditor } from '@/features/admin/role-permission-editor';
import { can, requirePermission } from '@/lib/auth/guard';
import { isUuid } from '@/lib/utils';
import { PERMISSIONS } from '@/lib/permissions/catalog';
import { getRoleDetail, assignablePermissionKeys } from '@/services/role-admin-service';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Role' };

export default async function RoleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('users:view');
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const data = await getRoleDetail(actor.organizationId, id);
  if (!data) notFound();
  const { role, permissionKeys, userCount } = data;

  const canManage = can(actor, 'users:manage');
  const editable = canManage && !role.isSystem;
  const catalog = PERMISSIONS.map((p) => ({ key: p.key, module: p.module, action: p.action }));
  const assignable = Array.from(assignablePermissionKeys(actor));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Users & Permissions', href: '/users' }, { label: 'Roles', href: '/roles' }, { label: role.nameEn }]}
        title={role.nameEn}
        badge={role.isSystem ? <Badge tone="neutral">System</Badge> : <Badge tone="info">Custom</Badge>}
        meta={
          <>
            <MetaItem icon={<ShieldCheck />}>{role.key}</MetaItem>
            <span className="text-[var(--color-text-tertiary)]">{permissionKeys.length} permissions · {userCount} users</span>
          </>
        }
        actions={
          editable ? (
            <>
              <RoleFormDialog mode="edit" roleId={id} initial={{ nameEn: role.nameEn, nameAr: role.nameAr ?? undefined, description: role.description ?? undefined }} />
              {userCount === 0 ? <DeleteRoleButton roleId={id} roleName={role.nameEn} /> : null}
            </>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Role" />
          <CardBody className="pt-0">
            <DetailList>
              <DetailRow label="Name (EN)" value={role.nameEn} />
              <DetailRow label="Name (AR)" value={role.nameAr ?? '—'} />
              <DetailRow label="Key" value={role.key} />
              <DetailRow label="Type" value={role.isSystem ? 'System' : 'Custom'} />
              <DetailRow label="Users" value={String(userCount)} />
              <DetailRow label="Description" value={role.description ?? '—'} />
            </DetailList>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Permissions"
            description={role.isSystem ? 'System role permissions are read-only.' : 'Select the permissions this role grants. You can only grant permissions you hold.'}
          />
          <CardBody className="pt-0">
            {role.isSystem ? (
              <RolePermissionEditor roleId={id} catalog={catalog} assignableKeys={assignable} currentKeys={permissionKeys} readOnly />
            ) : editable ? (
              <RolePermissionEditor roleId={id} catalog={catalog} assignableKeys={assignable} currentKeys={permissionKeys} />
            ) : (
              <EmptyState title="Read-only" description="You do not have permission to manage this role." />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
