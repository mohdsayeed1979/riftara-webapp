import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/page';
import { requirePermission } from '@/lib/auth/guard';
import { getPropertyFormReferenceData, nextPropertyCode } from '@/services/property-service';
import { PropertyForm } from '@/features/properties/property-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'New Property' };

export default async function NewPropertyPage() {
  // Organization-scoped and gated by the properties:create permission.
  const user = await requirePermission('properties:create');

  const [reference, suggestedCode] = await Promise.all([
    getPropertyFormReferenceData(user.organizationId),
    nextPropertyCode(user.organizationId),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[
          { label: 'Properties', href: '/properties' },
          { label: 'New Property' },
        ]}
        title="Add Property"
        subtitle="Register a new property in your portfolio. Required fields are marked with an asterisk."
      />
      <PropertyForm reference={reference} suggestedCode={suggestedCode} />
    </div>
  );
}
