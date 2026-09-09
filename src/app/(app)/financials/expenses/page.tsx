import type { Metadata } from 'next';
import { count, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { expenseCategories, operatingExpenses, properties, vendors } from '@/db/schema';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/page';
import { Pagination, Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { NewCategoryButton, RecordExpenseButton, type ExpenseInitial } from '@/features/financials/expense-dialogs';
import { can, requirePermission } from '@/lib/auth/guard';
import { formatCurrency, formatDate } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { getFinancialFormReferenceData } from '@/services/financial-service';

export const metadata: Metadata = { title: 'Operating Expenses' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission('financials:view');
  const params = await searchParams;
  const locale = await getRequestLocale();
  const page = Math.max(1, Number(params.page) || 1);
  const db = await getDb();
  const canWrite = can(user, 'financials:create') || can(user, 'financials:edit');

  const where = eq(operatingExpenses.organizationId, user.organizationId);

  const [rows, totalRow, reference] = await Promise.all([
    db
      .select({
        id: operatingExpenses.id,
        reference: operatingExpenses.reference,
        description: operatingExpenses.description,
        categoryId: operatingExpenses.categoryId,
        categoryName: expenseCategories.nameEn,
        includedInOpex: expenseCategories.includedInOpex,
        propertyId: operatingExpenses.propertyId,
        propertyName: properties.nameEn,
        unitId: operatingExpenses.unitId,
        vendorId: operatingExpenses.vendorId,
        vendorName: vendors.nameEn,
        amount: operatingExpenses.amount,
        vatAmount: operatingExpenses.vatAmount,
        isRecoverable: operatingExpenses.isRecoverable,
        invoiceNumber: operatingExpenses.invoiceNumber,
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
    canWrite ? getFinancialFormReferenceData(user.organizationId) : Promise.resolve(null),
  ]);

  const total = Number(totalRow[0]?.total ?? 0);
  const buildHref = (targetPage: number) => `/financials/expenses?page=${targetPage}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Financials', href: '/financials' }, { label: 'Operating Expenses' }]}
        title="Operating Expenses"
        subtitle="OPEX and capital expenditure. OPEX categories feed property NOI; capital categories do not."
        actions={
          reference ? (
            <>
              {can(user, 'financials:edit') ? <NewCategoryButton /> : null}
              {can(user, 'financials:create') ? (
                <>
                  <RecordExpenseButton reference={reference} mode="capex" triggerVariant="secondary" />
                  <RecordExpenseButton reference={reference} mode="opex" />
                </>
              ) : null}
            </>
          ) : undefined
        }
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No expenses recorded" description="Recorded OPEX and CAPEX will appear here." />
        ) : (
          <>
            <TableContainer>
              <Table>
                <THead>
                  <TR>
                    <TH>Reference</TH>
                    <TH>Description</TH>
                    <TH>Category</TH>
                    <TH alignment="center">Type</TH>
                    <TH>Property</TH>
                    <TH alignment="end">Date</TH>
                    <TH alignment="end">Amount</TH>
                    {can(user, 'financials:edit') && reference ? <TH alignment="end">Action</TH> : null}
                  </TR>
                </THead>
                <TBody>
                  {rows.map((row) => {
                    const initial: ExpenseInitial = {
                      categoryId: row.categoryId,
                      propertyId: row.propertyId,
                      unitId: row.unitId ?? undefined,
                      vendorId: row.vendorId ?? undefined,
                      description: row.description,
                      amount: String(row.amount),
                      vatAmount: String(row.vatAmount),
                      incurredOn: row.incurredOn,
                      isRecoverable: row.isRecoverable,
                      invoiceNumber: row.invoiceNumber ?? undefined,
                    };
                    return (
                      <TR key={row.id}>
                        <TD className="font-medium">{row.reference}</TD>
                        <TD className="max-w-56 truncate">{row.description}</TD>
                        <TD className="text-[var(--color-text-secondary)]">{row.categoryName}</TD>
                        <TD alignment="center"><Badge tone={row.includedInOpex ? 'neutral' : 'info'} size="sm">{row.includedInOpex ? 'OPEX' : 'CAPEX'}</Badge></TD>
                        <TD className="text-[var(--color-text-secondary)]">{row.propertyName}</TD>
                        <TD alignment="end" className="whitespace-nowrap">{formatDate(row.incurredOn, { locale, style: 'short' })}</TD>
                        <TD alignment="end" numeric className="font-medium">{formatCurrency(Number(row.amount), { locale })}</TD>
                        {can(user, 'financials:edit') && reference ? (
                          <TD alignment="end">
                            <RecordExpenseButton reference={reference} mode={row.includedInOpex ? 'opex' : 'capex'} expenseId={row.id} initial={initial} triggerVariant="secondary" />
                          </TD>
                        ) : null}
                      </TR>
                    );
                  })}
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
