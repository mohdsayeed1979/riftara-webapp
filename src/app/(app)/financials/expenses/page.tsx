import type { Metadata } from 'next';
import { count, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { expenseCategories, operatingExpenses, properties, vendors } from '@/db/schema';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/page';
import { Pagination, Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { requirePermission } from '@/lib/auth/guard';
import { formatCurrency, formatDate } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';

export const metadata: Metadata = { title: 'Operating Expenses' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission('financials:view');
  const params = await searchParams;
  const locale = await getRequestLocale();
  const page = Math.max(1, Number(params.page) || 1);
  const db = await getDb();

  const where = eq(operatingExpenses.organizationId, user.organizationId);

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: operatingExpenses.id,
        reference: operatingExpenses.reference,
        description: operatingExpenses.description,
        categoryName: expenseCategories.nameEn,
        propertyName: properties.nameEn,
        vendorName: vendors.nameEn,
        amount: operatingExpenses.amount,
        incurredOn: operatingExpenses.incurredOn,
      })
      .from(operatingExpenses)
      .innerJoin(expenseCategories, eq(expenseCategories.id, operatingExpenses.categoryId))
      .innerJoin(properties, eq(properties.id, operatingExpenses.propertyId))
      .leftJoin(vendors, eq(vendors.id, operatingExpenses.vendorId))
      .where(where)
      .orderBy(desc(operatingExpenses.incurredOn))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ total: count() }).from(operatingExpenses).where(where),
  ]);

  const total = Number(totalRow[0]?.total ?? 0);
  const buildHref = (targetPage: number) => `/financials/expenses?page=${targetPage}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Financials', href: '/financials' }, { label: 'Operating Expenses' }]}
        title="Operating Expenses"
        subtitle="OPEX line items feeding property NOI calculations."
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No operating expenses recorded" />
        ) : (
          <>
            <TableContainer>
              <Table>
                <THead>
                  <TR>
                    <TH>Reference</TH>
                    <TH>Description</TH>
                    <TH>Category</TH>
                    <TH>Property</TH>
                    <TH>Vendor</TH>
                    <TH alignment="end">Date</TH>
                    <TH alignment="end">Amount</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((row) => (
                    <TR key={row.id}>
                      <TD className="font-medium">{row.reference}</TD>
                      <TD className="max-w-56 truncate">{row.description}</TD>
                      <TD className="text-[var(--color-text-secondary)]">{row.categoryName}</TD>
                      <TD className="text-[var(--color-text-secondary)]">{row.propertyName}</TD>
                      <TD className="text-[var(--color-text-secondary)]">{row.vendorName ?? '—'}</TD>
                      <TD alignment="end" className="whitespace-nowrap">{formatDate(row.incurredOn, { locale, style: 'short' })}</TD>
                      <TD alignment="end" numeric className="font-medium">{formatCurrency(Number(row.amount), { locale })}</TD>
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
