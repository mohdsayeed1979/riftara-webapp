'use client';

import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { runOverdueNotificationsAction } from '@/app/(app)/collections/actions';

/** Triggers the idempotent overdue-notification run and reports the result. */
export function RunOverdueScanButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      loading={pending}
      onClick={() =>
        start(async () => {
          const result = await runOverdueNotificationsAction();
          if (result.ok) {
            const { markedOverdue, notificationsCreated } = result.data;
            toast.success(
              `Scan complete — ${markedOverdue} marked overdue, ${notificationsCreated} notification(s) created.`,
            );
            router.refresh();
          } else {
            toast.error(result.error.message);
          }
        })
      }
    >
      <RefreshCw />
      Run Overdue Scan
    </Button>
  );
}
