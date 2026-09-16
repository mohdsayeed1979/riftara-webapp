'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { executeChecklistItemAction } from '@/app/(app)/maintenance/actions';
import { useI18n } from '@/i18n/provider';

interface TemplateItem { key: string; labelEn: string; labelAr?: string | null; required?: boolean; createsCorrectiveOnFail?: boolean }
interface Template { id: string; nameEn: string; items: TemplateItem[] }
interface ResultRow { templateId: string; itemKey: string; result: string; notes: string | null; correctiveWorkOrderId: string | null }

export function ChecklistPanel({
  workOrderId,
  templates,
  results,
  canExecute,
}: {
  workOrderId: string;
  templates: Template[];
  results: ResultRow[];
  canExecute: boolean;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [pending, start] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const template = templates.find((tpl) => tpl.id === templateId) ?? null;
  const resultFor = (itemKey: string) => results.find((r) => r.templateId === templateId && r.itemKey === itemKey) ?? null;

  function submit(itemKey: string, result: 'pass' | 'fail' | 'na') {
    setPendingKey(itemKey);
    start(async () => {
      const outcome = await executeChecklistItemAction(workOrderId, templateId, itemKey, result);
      if (outcome.ok) {
        toast.success(outcome.data.correctiveWorkOrderId ? t('maintenance.checklistRecordedWithCorrective') : t('maintenance.checklistRecorded'));
        router.refresh();
      } else {
        toast.error(outcome.error.message);
      }
      setPendingKey(null);
    });
  }

  if (templates.length === 0) {
    return <p className="px-4 py-6 text-[12.5px] text-[var(--color-text-tertiary)]">{t('maintenance.noChecklistTemplatesConfigured')}</p>;
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <div className="max-w-xs">
        <NativeSelect
          value={templateId}
          onChange={setTemplateId}
          options={templates.map((t) => ({ id: t.id, name: t.nameEn }))}
        />
      </div>
      {template ? (
        <ul className="flex flex-col divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-control)] border border-[var(--color-border-subtle)]">
          {template.items.map((item) => {
            const existing = resultFor(item.key);
            const isPending = pending && pendingKey === item.key;
            return (
              <li key={item.key} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[13px] font-medium">{item.labelEn}{item.required ? <span className="text-[var(--color-error)]"> *</span> : null}</p>
                  {existing ? (
                    <p className="text-[11.5px] text-[var(--color-text-tertiary)]">
                      {t('maintenance.checklistResultLabel')}: <span className="capitalize font-medium">{existing.result}</span>
                      {existing.correctiveWorkOrderId ? (
                        <> — <Link className="underline" href={`/maintenance/${existing.correctiveWorkOrderId}`}>{t('maintenance.checklistCorrectiveLink')}</Link></>
                      ) : null}
                    </p>
                  ) : null}
                </div>
                {canExecute ? (
                  <div className="flex gap-2">
                    <Button size="sm" variant={existing?.result === 'pass' ? 'primary' : 'secondary'} loading={isPending} onClick={() => submit(item.key, 'pass')}>
                      <CheckCircle2 />{t('maintenance.checklistPass')}
                    </Button>
                    <Button size="sm" variant={existing?.result === 'fail' ? 'primary' : 'secondary'} loading={isPending} onClick={() => submit(item.key, 'fail')}>
                      <XCircle />{t('maintenance.checklistFail')}
                    </Button>
                    <Button size="sm" variant={existing?.result === 'na' ? 'primary' : 'secondary'} loading={isPending} onClick={() => submit(item.key, 'na')}>
                      <MinusCircle />{t('maintenance.checklistNa')}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
