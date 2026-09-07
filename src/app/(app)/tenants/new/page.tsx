import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/page';
import { requirePermission } from '@/lib/auth/guard';
import { getTenantFormReferenceData } from '@/services/tenant-service';
import { TenantForm, type TenantFormInitial } from '@/features/tenants/tenant-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New Tenant' };

export default async function NewTenantPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const user = await requirePermission('tenants:create');
  const { customerId } = await searchParams;
  const reference = await getTenantFormReferenceData(user.organizationId);

  const preset = customerId && reference.customers.find((c) => c.id === customerId);
  const initial: TenantFormInitial | undefined = preset
    ? { customerId: preset.id, displayName: preset.name }
    : undefined;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Tenants', href: '/tenants' }, { label: 'New Tenant' }]}
        title="Add Tenant"
        subtitle="Create a tenant leasing account from an existing customer."
      />
      <TenantForm mode="create" customers={reference.customers} managers={reference.managers} initial={initial} />
    </div>
  );
}
