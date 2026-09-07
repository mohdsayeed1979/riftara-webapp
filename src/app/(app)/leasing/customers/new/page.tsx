import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/page';
import { requirePermission } from '@/lib/auth/guard';
import { CustomerForm } from '@/features/customers/customer-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New Customer' };

export default async function NewCustomerPage() {
  await requirePermission('customers:create');
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Customers', href: '/leasing/customers' }, { label: 'New Customer' }]}
        title="Add Customer"
        subtitle="Create a customer record. Duplicate detection runs on mobile, email, National ID/Iqama and CR."
      />
      <CustomerForm mode="create" />
    </div>
  );
}
