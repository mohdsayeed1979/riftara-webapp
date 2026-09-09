'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { RefreshCw, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { generateWorkOrderFromPreventiveAction, runSlaBreachNotificationsAction } from '@/app/(app)/maintenance/actions';

/** Generate a work order from a preventive-maintenance schedule (idempotent). */
export function GeneratePmWorkOrderButton({ scheduleId }: { scheduleId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={pending}
      onClick={() =>
        start(async () => {
          const result = await generateWorkOrderFromPreventiveAction(scheduleId);
          if (result.ok) {
            toast.success(result.data.alreadyExisted ? `Work order ${result.data.code} already open.` : `Work order ${result.data.code} generated.`);
            router.refresh();
          } else {
            toast.error(result.error.message);
          }
        })
      }
    >
      <Wrench />
      Generate WO
    </Button>
  );
}

/** Run the idempotent SLA-breach notification scan. */
export function RunSlaScanButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      loading={pending}
      onClick={() =>
        start(async () => {
          const result = await runSlaBreachNotificationsAction();
          if (result.ok) {
            toast.success(`SLA scan complete — ${result.data.notificationsCreated} breach notification(s) created.`);
            router.refresh();
          } else {
            toast.error(result.error.message);
          }
        })
      }
    >
      <RefreshCw />
      Run SLA Scan
    </Button>
  );
}
