import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermission, can } from '@/lib/auth/guard';
import { Card, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page';
import { EmptyState } from '@/components/ui/misc';
import { Badge } from '@/components/ui/badge';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { LogCollectionActionButton } from '@/features/collections/log-collection-action';
import { RunOverdueScanButton } from '@/features/collections/run-overdue-scan';
import { formatCurrency, formatDate } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { getDunningQueue } from '@/services/collection-service';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Collections — Dunning' };

const ACTION_LABELS: Record<string, string> = {
  reminder: 'Reminder',
  follow_up: 'Follow-up',
  escalation: 'Escalation',
  formal_notice: 'Formal Notice',
  legal_review: 'Legal Review',
  payment_plan: 'Payment Plan',
  resolved: 'Resolved',
};

export default async function DunningPage() {
  const user = await requirePermission('collections:view');
  const locale = await getRequestLocale();
  const allowedPropertyIds = user.scopedPropertyIds.length ? user.scopedPropertyIds : null;

  const queue = await getDunningQueue(user.organizationId, allowedPropertyIds);
  const money = (value: number) => formatCurrency(value, { locale });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Collections', href: '/collections' }, { label: 'Dunning' }]}
        title="Dunning Queue"
        subtitle="Overdue accounts with the recommended next action from the escalation ladder."
        actions={can(user, 'collections:edit') ? <RunOverdueScanButton /> : undefined}
      />

      <Card>
        <CardHeader title="Overdue Accounts" description={`${queue.length} tenant(s) with overdue balances`} />
        {queue.length === 0 ? (
          <EmptyState title="No overdue accounts" description="Every account is current." />
        ) : (
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH>Tenant</TH>
                  <TH alignment="end">Outstanding</TH>
                  <TH alignment="center">Invoices</TH>
                  <TH alignment="end">Max Days</TH>
                  <TH alignment="center">Recommended</TH>
                  <TH>Last Action</TH>
                  <TH alignment="end">Action</TH>
                </TR>
              </THead>
              <TBody>
                {queue.map((row) => (
                  <TR key={row.tenantId}>
                    <TD>
                      <Link href={`/collections/tenants/${row.tenantId}/ledger`} className="font-medium hover:text-[var(--color-info)]">
                        {row.tenantName}
                      </Link>
                    </TD>
                    <TD alignment="end" numeric className="font-medium text-[var(--color-error)]">{money(row.outstanding)}</TD>
                    <TD alignment="center">{row.invoiceCount}</TD>
                    <TD alignment="end">
                      <Badge tone={row.maxDaysOverdue > 90 ? 'error' : 'warning'} size="sm">{row.maxDaysOverdue}d</Badge>
                    </TD>
                    <TD alignment="center">
                      {row.recommendedAction ? (
                        <Badge tone="info" size="sm">{ACTION_LABELS[row.recommendedAction] ?? row.recommendedAction}</Badge>
                      ) : (
                        <span className="text-[var(--color-text-tertiary)]">—</span>
                      )}
                    </TD>
                    <TD className="text-[var(--color-text-secondary)]">
                      {row.lastActionType ? (
                        <span>
                          {ACTION_LABELS[row.lastActionType] ?? row.lastActionType}
                          {row.lastActionAt ? ` · ${formatDate(row.lastActionAt, { locale, style: 'short' })}` : ''}
                        </span>
                      ) : (
                        '—'
                      )}
                    </TD>
                    <TD alignment="end">
                      {can(user, 'collections:edit') ? (
                        <LogCollectionActionButton
                          tenantId={row.tenantId}
                          outstandingAmount={row.outstanding}
                          daysOverdue={row.maxDaysOverdue}
                          recommendedAction={row.recommendedAction}
                        />
                      ) : null}
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
