import type { Metadata } from 'next';
import Link from 'next/link';
import { Pencil, Plus, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FilterBar } from '@/components/app/filter-bar';
import { EmptyState } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/page';
import { Pagination, Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { can, requirePermission } from '@/lib/auth/guard';
import { listCustomers } from '@/services/customer-service';

export const metadata: Metadata = { title: 'Customers' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission('customers:view');
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);

  const { items, total } = await listCustomers({
    organizationId: user.organizationId,
    search: params.search,
    customerType: params.type,
    priority: params.priority,
    page,
    pageSize: PAGE_SIZE,
  });

  const buildHref = (targetPage: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== 'page') query.set(key, value);
    }
    query.set('page', String(targetPage));
    return `/leasing/customers?${query.toString()}`;
  };

  const addButton = can(user, 'customers:create') ? (
    <Button asChild>
      <Link href="/leasing/customers/new">
        <Plus />
        Add Customer
      </Link>
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Leasing CRM', href: '/leasing' }, { label: 'Customers' }]}
        title="Customers"
        subtitle="Master customer directory with duplicate-safe records."
        actions={addButton ?? undefined}
      />

      <FilterBar
        searchPlaceholder="Search by name, mobile, email or code..."
        filters={[
          {
            key: 'type',
            placeholder: 'All Types',
            options: [
              { value: 'individual', label: 'Individual' },
              { value: 'corporate', label: 'Corporate' },
            ],
          },
          {
            key: 'priority',
            placeholder: 'All Priorities',
            options: [
              { value: 'high', label: 'High' },
              { value: 'medium', label: 'Medium' },
              { value: 'low', label: 'Low' },
            ],
          },
        ]}
      />

      <Card>
        {items.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title="No customers found"
            description="Try adjusting your filters, or add a customer."
            action={addButton ?? undefined}
          />
        ) : (
          <>
            <TableContainer>
              <Table>
                <THead>
                  <TR>
                    <TH>Customer</TH>
                    <TH>Type</TH>
                    <TH>Mobile</TH>
                    <TH>Email</TH>
                    <TH>Identification</TH>
                    <TH alignment="end">Active Contracts</TH>
                    <TH alignment="center">Tenant</TH>
                    <TH alignment="end">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {items.map((c) => (
                    <TR key={c.id} interactive>
                      <TD>
                        <Link href={`/leasing/customers/${c.id}`} className="font-medium hover:text-[var(--color-info)]">
                          {c.companyName ?? c.fullNameEn}
                        </Link>
                        <span className="block text-[11px] text-[var(--color-text-tertiary)]">{c.code}</span>
                      </TD>
                      <TD>
                        <Badge tone={c.customerType === 'corporate' ? 'info' : 'neutral'}>
                          {c.customerType === 'corporate' ? 'Corporate' : 'Individual'}
                        </Badge>
                      </TD>
                      <TD className="text-[var(--color-text-secondary)]">{c.mobile ?? '—'}</TD>
                      <TD className="max-w-48 truncate text-[var(--color-text-secondary)]">{c.email ?? '—'}</TD>
                      <TD className="text-[var(--color-text-secondary)]">
                        {c.identification ? c.identification.split(':')[1] : '—'}
                      </TD>
                      <TD alignment="end" numeric>{c.activeContracts}</TD>
                      <TD alignment="center">{c.hasTenant ? <Badge tone="success">Yes</Badge> : '—'}</TD>
                      <TD alignment="end" className="whitespace-nowrap">
                        <Link href={`/leasing/customers/${c.id}`} className="text-[12px] font-medium text-[var(--color-info)] hover:underline">
                          View
                        </Link>
                        {can(user, 'customers:edit') ? (
                          <Link href={`/leasing/customers/${c.id}/edit`} className="ms-3 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                            <Pencil className="size-3" />
                            Edit
                          </Link>
                        ) : null}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} buildHref={buildHref} />
          </>
        )}
      </Card>
    </div>
  );
}
