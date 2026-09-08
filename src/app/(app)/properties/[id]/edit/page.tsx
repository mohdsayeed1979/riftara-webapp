import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page';
import { requirePermission } from '@/lib/auth/guard';
import { isUuid } from '@/lib/utils';
import { getPropertyForEdit, getPropertyFormReferenceData } from '@/services/property-service';
import { PropertyForm } from '@/features/properties/property-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Edit Property' };

function formValue(value: unknown): string | boolean | null | undefined {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string' || typeof value === 'boolean' || value === null) return value;
  return undefined;
}

export default async function EditPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('properties:edit');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [property, reference] = await Promise.all([
    getPropertyForEdit(user.organizationId, id),
    getPropertyFormReferenceData(user.organizationId),
  ]);
  if (!property) notFound();
  const initial = Object.fromEntries(Object.entries(property).map(([key, value]) => [key, formValue(value)]));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Properties', href: '/properties' }, { label: property.nameEn, href: `/properties/${id}` }, { label: 'Edit' }]}
        title={`Edit ${property.nameEn}`}
        subtitle="Update the property record. Buildings, units and ownership records remain unchanged."
      />
      <PropertyForm reference={reference} suggestedCode={property.code} propertyId={id} initial={initial} />
    </div>
  );
}
