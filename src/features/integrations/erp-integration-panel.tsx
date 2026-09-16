'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useI18n } from '@/i18n/provider';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import { processErpEventsAction, reconcileErpAction, retryErpEventAction } from '@/app/(app)/integrations/erp/actions';
import type { ActionResult } from '@/lib/errors';
import type { ReconciliationReport } from '@/integrations/erp/erp-service';

export interface ErpEventRow {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  status: string;
  attemptCount: number;
  externalReference: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export function ErpIntegrationPanel({
  events,
  canManage,
  canRetry,
  canReconcile,
  locale,
}: {
  events: ErpEventRow[];
  canManage: boolean;
  canRetry: boolean;
  canReconcile: boolean;
  locale: Locale;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<ReconciliationReport | null>(null);

  async function run(key: string, fn: () => Promise<ActionResult<unknown>>, successMessage: string) {
    setBusy(key);
    const result = await fn();
    setBusy(null);
    if (result.ok) {
      toast.success(successMessage);
      startTransition(() => router.refresh());
      return result.data;
    }
    toast.error(result.error.message);
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title={t('erp.recentEvents')}
          action={
            canManage ? (
              <Button size="sm" variant="secondary" loading={busy === 'process'} onClick={() => void run('process', processErpEventsAction, t('erp.processQueue'))}>
                {t('erp.processQueue')}
              </Button>
            ) : undefined
          }
        />
        {events.length === 0 ? (
          <EmptyState title={t('erp.noEvents')} description={t('erp.noEventsHint')} />
        ) : (
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH>{t('erp.eventType')}</TH>
                  <TH>{t('erp.entity')}</TH>
                  <TH alignment="center">{t('common.status')}</TH>
                  <TH alignment="end">{t('erp.attempts')}</TH>
                  <TH>{t('erp.externalReference')}</TH>
                  <TH alignment="end">{t('common.created')}</TH>
                  {canRetry ? <TH alignment="end">{t('common.actions')}</TH> : null}
                </TR>
              </THead>
              <TBody>
                {events.map((event) => (
                  <TR key={event.id}>
                    <TD className="font-medium">{event.eventType}</TD>
                    <TD className="text-[var(--color-text-secondary)]">
                      {event.entityType} · {event.entityId.slice(0, 8)}
                    </TD>
                    <TD alignment="center"><StatusBadge status={event.status} /></TD>
                    <TD alignment="end">{event.attemptCount}</TD>
                    <TD className="font-mono text-[11px]">{event.externalReference ?? '—'}</TD>
                    <TD alignment="end" className="whitespace-nowrap">{formatDateTime(event.createdAt, { locale })}</TD>
                    {canRetry ? (
                      <TD alignment="end">
                        {event.status === 'retrying' || event.status === 'dead_letter' ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={busy === event.id}
                            onClick={() => void run(event.id, () => retryErpEventAction(event.id), t('erp.retry'))}
                          >
                            {t('erp.retry')}
                          </Button>
                        ) : null}
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        )}
      </Card>

      <Card>
        <CardHeader
          title={t('erp.reconciliation')}
          action={
            canReconcile ? (
              <Button
                size="sm"
                variant="secondary"
                loading={busy === 'reconcile'}
                onClick={async () => {
                  const data = await run('reconcile', reconcileErpAction, t('erp.runReconciliation'));
                  if (data) setReport(data as ReconciliationReport);
                }}
              >
                {t('erp.runReconciliation')}
              </Button>
            ) : undefined
          }
        />
        {report ? (
          <CardBody className="pt-0">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                [t('erp.totalEvents'), report.totalEvents],
                [t('erp.sent'), report.sent],
                [t('erp.accepted'), report.accepted],
                [t('erp.rejected'), report.rejected],
                [t('erp.unmatched'), report.unmatched],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] p-3 text-center">
                  <p className="text-[11px] text-[var(--color-text-tertiary)]">{label}</p>
                  <p className="text-[18px] font-semibold tabular">{value}</p>
                </div>
              ))}
            </div>
          </CardBody>
        ) : null}
      </Card>
    </div>
  );
}
