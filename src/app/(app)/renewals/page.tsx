import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/page';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { requirePermission } from '@/lib/auth/guard';
import { formatCurrency, formatDate } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { getMessages } from '@/i18n';
import { listRenewals } from '@/services/renewal-service';

export const metadata: Metadata = { title: 'Renewals' };
export const dynamic = 'force-dynamic';

export default async function RenewalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission('renewals:view');
  const params = await searchParams;
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  const t = m.renewals;
  const allowedPropertyIds = user.scopedPropertyIds.length ? user.scopedPropertyIds : null;

  const items = await listRenewals({ organizationId: user.organizationId, allowedPropertyIds, status: params.status });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <Card>
        {items.length === 0 ? (
          <EmptyState title={t.noRenewals} description={t.noRenewalsHint} />
        ) : (
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH>{m.contracts.contract}</TH>
                  <TH>{m.contracts.tenant}</TH>
                  <TH>{m.contracts.propertyUnit}</TH>
                  <TH alignment="end">{t.noticeDueDate}</TH>
                  <TH alignment="end">{t.currentRent}</TH>
                  <TH alignment="end">{t.proposedRent}</TH>
                  <TH alignment="center">{m.common.status}</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((item) => (
                  <TR key={item.id} interactive>
                    <TD>
                      <Link href={`/renewals/${item.id}`} className="font-medium hover:text-[var(--color-info)]">
                        {item.contractNumber}
                      </Link>
                    </TD>
                    <TD>{item.tenantName}</TD>
                    <TD className="text-[var(--color-text-secondary)]">
                      {item.propertyName} / {item.unitNumber}
                    </TD>
                    <TD alignment="end" className="whitespace-nowrap">{formatDate(item.noticeDueDate, { locale, style: 'short' })}</TD>
                    <TD alignment="end" numeric>{formatCurrency(item.currentRent, { locale })}</TD>
                    <TD alignment="end" numeric>{item.proposedRent !== null ? formatCurrency(item.proposedRent, { locale }) : '—'}</TD>
                    <TD alignment="center"><StatusBadge status={item.status} /></TD>
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
