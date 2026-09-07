import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { customers } from '@/db/schema';
import { PageHeader } from '@/components/ui/page';
import { requirePermission } from '@/lib/auth/guard';
import { isUuid } from '@/lib/utils';
import { getTenantForEdit, getTenantFormReferenceData } from '@/services/tenant-service';
import { TenantForm, type TenantFormInitial } from '@/features/tenants/tenant-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Edit Tenant' };

function str(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(value);
}

export default async function EditTenantPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('tenants:edit');
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [tenant, reference] = await Promise.all([
    getTenantForEdit(user.organizationId, id),
    getTenantFormReferenceData(user.organizationId),
  ]);
  if (!tenant) notFound();

  const db = await getDb();
  const [customer] = await db
    .select({ name: customers.fullNameEn })
    .from(customers)
    .where(eq(customers.id, tenant.customerId))
    .limit(1);

  const initial: TenantFormInitial = {
    customerId: tenant.customerId,
    displayName: tenant.displayName,
    displayNameAr: tenant.displayNameAr ?? undefined,
    industry: tenant.industry ?? undefined,
    status: tenant.status,
    onboardedAt: str(tenant.onboardedAt),
    accountManagerId: tenant.accountManagerId ?? undefined,
    creditRating: tenant.creditRating ?? undefined,
    notes: tenant.notes ?? undefined,
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[
          { label: 'Tenants', href: '/tenants' },
          { label: tenant.displayName, href: `/tenants/${id}` },
          { label: 'Edit' },
        ]}
        title={`Edit ${tenant.displayName}`}
        subtitle="Update the tenant leasing account."
      />
      <TenantForm
        mode="edit"
        tenantId={id}
        customers={reference.customers}
        managers={reference.managers}
        initial={initial}
        lockedCustomerName={customer?.name ?? tenant.displayName}
      />
    </div>
  );
}
