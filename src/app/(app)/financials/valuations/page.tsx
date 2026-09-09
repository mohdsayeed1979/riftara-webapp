import type { Metadata } from 'next';
import Link from 'next/link';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { properties, valuations } from '@/db/schema';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/page';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { can, requirePermission } from '@/lib/auth/guard';
import { formatCompactCurrency, formatDate } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { getFinancialFormReferenceData } from '@/services/financial-service';
import { RecordValuationButton } from '@/features/financials/valuation-dialog';

export const metadata: Metadata = { title: 'Valuations' };
export const dynamic = 'force-dynamic';

export default async function ValuationsPage() {
  const user = await requirePermission('financials:view');
  const locale = await getRequestLocale();
  const db = await getDb();
  const reference = can(user, 'financials:create') ? await getFinancialFormReferenceData(user.organizationId) : null;

  const rows = await db
    .select({
      id: valuations.id,
      propertyId: valuations.propertyId,
      propertyName: properties.nameEn,
      valuationDate: valuations.valuationDate,
      marketValue: valuations.marketValue,
      bookValue: valuations.bookValue,
      acquisitionCost: valuations.acquisitionCost,
      changePercent: valuations.changePercent,
      valuationCompany: valuations.valuationCompany,
      capRate: valuations.capRate,
      isCurrent: valuations.isCurrent,
    })
    .from(valuations)
    .innerJoin(properties, eq(properties.id, valuations.propertyId))
    .where(and(eq(valuations.organizationId, user.organizationId), eq(valuations.isCurrent, true)))
    .orderBy(desc(valuations.marketValue));

  const money = (value: number | string | null) => formatCompactCurrency(Number(value ?? 0), { locale });
  const totalMarket = rows.reduce((sum, row) => sum + Number(row.marketValue), 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Financials', href: '/financials' }, { label: 'Valuations' }]}
        title="Asset Valuations"
        subtitle="Current approved valuations driving portfolio market value."
        meta={<span>Total market value: <span className="font-semibold text-[var(--color-text-primary)]">{money(totalMarket)}</span></span>}
        actions={reference ? <RecordValuationButton properties={reference.properties} /> : undefined}
      />

      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No valuations recorded" />
        ) : (
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH>Property</TH>
                  <TH>Valuation Date</TH>
                  <TH>Company</TH>
                  <TH alignment="end">Market Value</TH>
                  <TH alignment="end">Book Value</TH>
                  <TH alignment="end">Cap Rate</TH>
                  <TH alignment="end">Change</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.id} interactive>
                    <TD>
                      <Link href={`/properties/${row.propertyId}?tab=valuation`} className="font-medium hover:text-[var(--color-info)]">
                        {row.propertyName}
                      </Link>
                    </TD>
                    <TD className="text-[var(--color-text-secondary)]">{formatDate(row.valuationDate, { locale })}</TD>
                    <TD className="text-[var(--color-text-secondary)]">{row.valuationCompany ?? '—'}</TD>
                    <TD alignment="end" numeric className="font-medium">{money(row.marketValue)}</TD>
                    <TD alignment="end" numeric>{money(row.bookValue)}</TD>
                    <TD alignment="end" numeric>{row.capRate ? `${Number(row.capRate).toFixed(1)}%` : '—'}</TD>
                    <TD alignment="end" numeric className={Number(row.changePercent ?? 0) >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}>
                      {row.changePercent !== null ? `${Number(row.changePercent) >= 0 ? '+' : ''}${Number(row.changePercent).toFixed(1)}%` : '—'}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        )}
      </Card>
    </div>
  );
}
