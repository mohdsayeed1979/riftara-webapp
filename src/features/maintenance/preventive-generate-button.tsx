'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { runGenerateDuePreventiveWorkOrdersAction } from '@/app/(app)/maintenance/actions';
import { useI18n } from '@/i18n/provider';

export function GenerateDuePreventiveButton() {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, start] = useTransition();

  function run() {
    start(async () => {
      const result = await runGenerateDuePreventiveWorkOrdersAction();
      if (result.ok) {
        toast.success(t('maintenance.generateDueWorkOrdersResult', { scanned: result.data.scanned, generated: result.data.generated }));
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <Button variant="secondary" loading={pending} onClick={run}>
      <RefreshCw />{t('maintenance.generateDueWorkOrders')}
    </Button>
  );
}
