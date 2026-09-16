'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { formatCurrency } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import { useI18n } from '@/i18n/provider';
import {
  approveHandoverAction,
  completeHandoverAction,
  updateHandoverChecklistAction,
  updateHandoverConditionAction,
} from '@/app/(app)/handovers/actions';
import type { ActionResult } from '@/lib/errors';

export function HandoverChecklistPanel({
  handoverId,
  status,
  contractSigned,
  paymentReceived,
  depositReceived,
  unitReady,
  keysHandedOver,
  accessCards,
  parkingCards,
  electricityMeterReading,
  waterMeterReading,
  unitCondition,
  notes,
  totalBilled,
  totalPaid,
  outstanding,
  canEdit,
  canApprove,
  locale,
}: {
  handoverId: string;
  status: string;
  contractSigned: boolean;
  paymentReceived: boolean;
  depositReceived: boolean;
  unitReady: boolean;
  keysHandedOver: number;
  accessCards: number;
  parkingCards: number;
  electricityMeterReading: string | null;
  waterMeterReading: string | null;
  unitCondition: string | null;
  notes: string | null;
  totalBilled: number;
  totalPaid: number;
  outstanding: number;
  canEdit: boolean;
  canApprove: boolean;
  locale: Locale;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const money = (v: number) => formatCurrency(v, { locale });
  const terminal = status === 'completed' || status === 'cancelled';

  const [checklistState, checklistAction, checklistPending] = useActionState<ActionResult<null> | null, FormData>(
    (state, formData) => updateHandoverChecklistAction(handoverId, state, formData),
    null,
  );
  const [conditionState, conditionAction, conditionPending] = useActionState<ActionResult<null> | null, FormData>(
    (state, formData) => updateHandoverConditionAction(handoverId, state, formData),
    null,
  );

  async function runSimple(fn: () => Promise<ActionResult<unknown>>, successMessage: string) {
    setBusy(true);
    const result = await fn();
    setBusy(false);
    if (result.ok) {
      toast.success(successMessage);
      startTransition(() => router.refresh());
    } else {
      toast.error(result.error.message);
    }
  }

  const checklistComplete = contractSigned && paymentReceived && depositReceived && unitReady;
  const canComplete = checklistComplete && outstanding === 0 && !terminal;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title={t('handovers.outstandingBalance')} />
        <CardBody className="pt-0">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-[11px] text-[var(--color-text-tertiary)]">{t('handovers.totalBilled')}</p>
              <p className="text-[15px] font-semibold tabular">{money(totalBilled)}</p>
            </div>
            <div>
              <p className="text-[11px] text-[var(--color-text-tertiary)]">{t('handovers.totalPaid')}</p>
              <p className="text-[15px] font-semibold tabular text-[var(--color-success)]">{money(totalPaid)}</p>
            </div>
            <div>
              <p className="text-[11px] text-[var(--color-text-tertiary)]">{t('handovers.outstandingBalance')}</p>
              <p className={`text-[15px] font-semibold tabular ${outstanding > 0 ? 'text-[var(--color-error)]' : ''}`}>{money(outstanding)}</p>
            </div>
          </div>
          {outstanding > 0 ? (
            <p className="mt-3 rounded-[var(--radius-control)] border border-[var(--color-error-border)] bg-[var(--color-error-soft)] p-2.5 text-[12.5px] text-[var(--color-error)]">
              {t('handovers.balanceBlocksCompletion')}
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('handovers.checklist')} />
        <CardBody className="pt-0">
          <form action={checklistAction} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" name="contractSigned" defaultChecked={contractSigned} disabled={!canEdit || terminal} />
                {t('handovers.contractSigned')}
              </label>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" name="paymentReceived" defaultChecked={paymentReceived} disabled={!canEdit || terminal} />
                {t('handovers.paymentReceived')}
              </label>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" name="depositReceived" defaultChecked={depositReceived} disabled={!canEdit || terminal} />
                {t('handovers.depositReceived')}
              </label>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" name="unitReady" defaultChecked={unitReady} disabled={!canEdit || terminal} />
                {t('handovers.unitReady')}
              </label>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label={t('handovers.keysHandedOver')}>
                <Input name="keysHandedOver" type="number" min="0" defaultValue={keysHandedOver} disabled={!canEdit || terminal} />
              </Field>
              <Field label={t('handovers.accessCards')}>
                <Input name="accessCards" type="number" min="0" defaultValue={accessCards} disabled={!canEdit || terminal} />
              </Field>
              <Field label={t('handovers.parkingCards')}>
                <Input name="parkingCards" type="number" min="0" defaultValue={parkingCards} disabled={!canEdit || terminal} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('handovers.electricityMeterReading')}>
                <Input name="electricityMeterReading" defaultValue={electricityMeterReading ?? ''} disabled={!canEdit || terminal} />
              </Field>
              <Field label={t('handovers.waterMeterReading')}>
                <Input name="waterMeterReading" defaultValue={waterMeterReading ?? ''} disabled={!canEdit || terminal} />
              </Field>
            </div>
            {checklistState && !checklistState.ok ? (
              <p className="text-[12.5px] text-[var(--color-error)]">{checklistState.error.message}</p>
            ) : null}
            {canEdit && !terminal ? (
              <div className="flex justify-end">
                <Button type="submit" variant="secondary" loading={checklistPending}>
                  {t('handovers.updateChecklist')}
                </Button>
              </div>
            ) : null}
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('handovers.conditionNotes')} />
        <CardBody className="pt-0">
          <form action={conditionAction} className="flex flex-col gap-3">
            <Field label={t('handovers.unitCondition')}>
              <Input name="unitCondition" defaultValue={unitCondition ?? ''} disabled={!canEdit || terminal} />
            </Field>
            <Field label={t('handovers.notes')}>
              <Textarea name="notes" rows={3} defaultValue={notes ?? ''} disabled={!canEdit || terminal} />
            </Field>
            {conditionState && !conditionState.ok ? (
              <p className="text-[12.5px] text-[var(--color-error)]">{conditionState.error.message}</p>
            ) : null}
            {canEdit && !terminal ? (
              <div className="flex justify-end">
                <Button type="submit" variant="secondary" loading={conditionPending}>
                  {t('common.save')}
                </Button>
              </div>
            ) : null}
          </form>
        </CardBody>
      </Card>

      {!terminal ? (
        <Card>
          <CardHeader title={t('handovers.finalize')} />
          <CardBody className="flex flex-wrap gap-2 pt-0">
            {canApprove ? (
              <Button
                variant="secondary"
                loading={busy}
                disabled={!checklistComplete}
                onClick={() => void runSimple(() => approveHandoverAction(handoverId), t('handovers.approve'))}
              >
                {t('handovers.approve')}
              </Button>
            ) : null}
            {canEdit ? (
              <Button
                loading={busy}
                disabled={!canComplete}
                onClick={() => void runSimple(() => completeHandoverAction(handoverId), t('handovers.complete'))}
              >
                {t('handovers.complete')}
              </Button>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
