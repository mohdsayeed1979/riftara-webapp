import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/page';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/misc';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { requirePermission } from '@/lib/auth/guard';
import { formatDate } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { getMessages } from '@/i18n';
import { listHandovers } from '@/services/handover-service';

export const metadata: Metadata = { title: 'Handovers' };
export const dynamic = 'force-dynamic';

export default async function HandoversPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission('handovers:view');
  const params = await searchParams;
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  const t = m.handovers;
  const allowedPropertyIds = user.scopedPropertyIds.length ? user.scopedPropertyIds : null;

  const items = await listHandovers({ organizationId: user.organizationId, allowedPropertyIds, status: params.status });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <Card>
        {items.length === 0 ? (
          <EmptyState title={t.noHandovers} description={t.noHandoversHint} />
        ) : (
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH>{m.contracts.contract}</TH>
                  <TH>{m.contracts.tenant}</TH>
                  <TH>{m.contracts.propertyUnit}</TH>
                  <TH alignment="center">{t.type}</TH>
                  <TH alignment="end">{m.contracts.startDate}</TH>
                  <TH alignment="center">{m.common.status}</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((item) => (
                  <TR key={item.id} interactive>
                    <TD>
                      <Link href={`/handovers/${item.id}`} className="font-medium hover:text-[var(--color-info)]">
                        {item.contractNumber}
                      </Link>
                    </TD>
                    <TD>{item.tenantName}</TD>
                    <TD className="text-[var(--color-text-secondary)]">
                      {item.propertyName} / {item.unitNumber}
                    </TD>
                    <TD alignment="center">
                      <Badge tone="neutral" size="sm">{item.handoverType === 'move_out' ? t.moveOut : t.handoverType}</Badge>
                    </TD>
                    <TD alignment="end" className="whitespace-nowrap">{formatDate(item.createdAt, { locale, style: 'short' })}</TD>
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
