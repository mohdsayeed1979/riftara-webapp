import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/page';
import { requirePermission } from '@/lib/auth/guard';
import { isUuid } from '@/lib/utils';
import { getLeadFormReferenceData } from '@/services/lead-service';
import { LeadForm } from '@/features/leasing/lead-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New Lead' };

export default async function NewLeadPage({ searchParams }: { searchParams: Promise<{ customerId?: string }> }) {
  const user = await requirePermission('leasing:create');
  const { customerId } = await searchParams;
  const reference = await getLeadFormReferenceData(user.organizationId);
  const preset = customerId && isUuid(customerId) && reference.customers.some((c) => c.id === customerId) ? customerId : undefined;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Leasing CRM', href: '/leasing' }, { label: 'New Lead' }]}
        title="Add Lead"
        subtitle="Capture a new lead. Select an existing customer or create one inline (with duplicate detection)."
      />
      <LeadForm reference={reference} presetCustomerId={preset} />
    </div>
  );
}
