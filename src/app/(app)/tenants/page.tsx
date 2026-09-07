import type { Metadata } from 'next';
import Link from 'next/link';
import { and, count, desc, eq, ilike, isNull, sql } from 'drizzle-orm';
import { Users } from 'lucide-react';
import { getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { FilterBar } from '@/components/app/filter-bar';
import { EmptyState } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/page';
import { StatusBadge } from '@/components/ui/status-badge';
import { Pagination, Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { requirePermission } from '@/lib/auth/guard';
import { formatCompactCurrency } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';

export const metadata: Metadata = { title: 'Tenants' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission('tenants:view');
  const params = await searchParams;
  const locale = await getRequestLocale();
  const page = Math.max(1, Number(params.page) || 1);
  const db = await getDb();

  const where = and(
    eq(tenants.organizationId, user.organizationId),
    isNull(tenants.deletedAt),
    params.search ? ilike(tenants.displayName, `%${params.search}%`) : undefined,
    params.status ? eq(tenants.status, params.status) : undefined,
  );

  const activeContracts = sql<number>`(
    select count(*)::int from contracts c where c.tenant_id = ${tenants.id} and c.is_active = true
  )`;
  const totalRent = sql<number>`(
    select coalesce(sum(c.annual_rent), 0)::float8 from contracts c where c.tenant_id = ${tenants.id} and c.is_active = true
  )`;
  const outstanding = sql<number>`(
    select coalesce(sum(i.balance_amount), 0)::float8 from invoices i
    where i.tenant_id = ${tenants.id} and i.status in ('due','overdue','partially_paid')
  )`;

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: tenants.id,
        code: tenants.code,
        displayName: tenants.displayName,
        industry: tenants.industry,
        status: tenants.status,
        creditRating: tenants.creditRating,
        activeContracts,
        totalRent,
        outstanding,
      })
      .from(tenants)
      .where(where)
      .orderBy(desc(totalRent))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ total: count() }).from(tenants).where(where),
  ]);

  const total = Number(totalRow[0]?.total ?? 0);
  const buildHref = (targetPage: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== 'page') query.set(key, value);
    }
    query.set('page', String(targetPage));
    return `/tenants?${query.toString()}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Tenants" subtitle="Active and former tenants across the portfolio." />

      <FilterBar
        searchPlaceholder="Search tenants by name..."
        filters={[
          {
            key: 'status',
            placeholder: 'All Statuses',
            options: [
              { value: 'active', label: 'Active' },
              { value: 'former', label: 'Former' },
              { value: 'prospective', label: 'Prospective' },
            ],
          },
        ]}
      />

      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<Users />} title="No tenants found" description="Tenants appear here once contracts are signed." />
        ) : (
          <>
            <TableContainer>
              <Table>
                <THead>
                  <TR>
                    <TH>Tenant</TH>
                    <TH>Industry</TH>
                    <TH alignment="end">Active Contracts</TH>
                    <TH alignment="end">Annual Rent</TH>
                    <TH alignment="end">Outstanding</TH>
                    <TH alignment="center">Credit</TH>
                    <TH alignment="center">Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((tenant) => (
                    <TR key={tenant.id} interactive>
                      <TD>
                        <Link href={`/tenants/${tenant.id}`} className="font-medium hover:text-[var(--color-info)]">
                          {tenant.displayName}
                        </Link>
                        <span className="block text-[11px] text-[var(--color-text-tertiary)]">{tenant.code}</span>
                      </TD>
                      <TD className="text-[var(--color-text-secondary)]">{tenant.industry ?? '—'}</TD>
                      <TD alignment="end" numeric>{Number(tenant.activeContracts)}</TD>
                      <TD alignment="end" numeric>{formatCompactCurrency(Number(tenant.totalRent), { locale })}</TD>
                      <TD alignment="end" numeric className={Number(tenant.outstanding) > 0 ? 'font-medium text-[var(--color-error)]' : 'text-[var(--color-text-tertiary)]'}>
                        {formatCompactCurrency(Number(tenant.outstanding), { locale })}
                      </TD>
                      <TD alignment="center">
                        {tenant.creditRating ? <Badge tone={tenant.creditRating === 'A' ? 'success' : tenant.creditRating === 'B' ? 'warning' : 'error'}>{tenant.creditRating}</Badge> : '—'}
                      </TD>
                      <TD alignment="center"><StatusBadge status={tenant.status} /></TD>
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
