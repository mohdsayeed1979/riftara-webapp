import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/page';
import { requirePermission } from '@/lib/auth/guard';
import { getUnitFormReferenceData, nextUnitCode } from '@/services/unit-service';
import { UnitForm, type UnitFormInitial } from '@/features/units/unit-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New Unit' };

export default async function NewUnitPage({
  searchParams,
}: {
  searchParams: Promise<{ propertyId?: string }>;
}) {
  const user = await requirePermission('units:create');
  const { propertyId } = await searchParams;
  const [reference, suggestedCode] = await Promise.all([
    getUnitFormReferenceData(user.organizationId),
    nextUnitCode(user.organizationId),
  ]);

  const initial: UnitFormInitial | undefined =
    propertyId && reference.properties.some((p) => p.id === propertyId) ? { propertyId } : undefined;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Units', href: '/units' }, { label: 'New Unit' }]}
        title="Add Unit"
        subtitle="Create a unit and place it under a property, building and floor. Required fields are marked with an asterisk."
      />
      <UnitForm mode="create" reference={reference} suggestedCode={suggestedCode} initial={initial} />
    </div>
  );
}
