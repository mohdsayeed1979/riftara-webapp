import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page';
import { requirePermission } from '@/lib/auth/guard';
import { isUuid } from '@/lib/utils';
import { getCustomerForEdit } from '@/services/customer-service';
import { CustomerForm, type CustomerFormInitial } from '@/features/customers/customer-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Edit Customer' };

function str(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(value);
}

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('customers:edit');
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const record = await getCustomerForEdit(user.organizationId, id);
  if (!record) notFound();

  const { customer, identifiers } = record;
  const idOf = (type: string) => identifiers.find((i) => i.identifierType === type);

  const initial: CustomerFormInitial = {
    customerType: customer.customerType,
    fullNameEn: customer.fullNameEn,
    fullNameAr: customer.fullNameAr ?? undefined,
    companyName: customer.companyName ?? undefined,
    mobile: customer.mobile ?? undefined,
    alternateMobile: customer.alternateMobile ?? undefined,
    email: customer.email ?? undefined,
    nationality: customer.nationality ?? undefined,
    employer: customer.employer ?? undefined,
    monthlyIncome: str(customer.monthlyIncome),
    businessActivity: customer.businessActivity ?? undefined,
    unifiedNumber: customer.unifiedNumber ?? undefined,
    vatNumber: customer.vatNumber ?? undefined,
    authorizedRepresentative: customer.authorizedRepresentative ?? undefined,
    addressLine: customer.addressLine ?? undefined,
    notes: customer.notes ?? undefined,
    priority: customer.priority,
    tags: (customer.tags ?? []).join(', '),
    marketingConsent: customer.marketingConsent,
    communicationConsent: customer.communicationConsent,
    nationalId: idOf('national_id')?.identifierValue,
    nationalIdExpiry: str(idOf('national_id')?.expiryDate),
    iqama: idOf('iqama')?.identifierValue,
    iqamaExpiry: str(idOf('iqama')?.expiryDate),
    commercialRegistration: idOf('commercial_registration')?.identifierValue,
    commercialRegistrationExpiry: str(idOf('commercial_registration')?.expiryDate),
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[
          { label: 'Customers', href: '/leasing/customers' },
          { label: customer.fullNameEn, href: `/leasing/customers/${id}` },
          { label: 'Edit' },
        ]}
        title={`Edit ${customer.fullNameEn}`}
        subtitle="Update customer details. Identifier changes are checked against duplicates (BR-007)."
      />
      <CustomerForm mode="edit" customerId={id} initial={initial} />
    </div>
  );
}
