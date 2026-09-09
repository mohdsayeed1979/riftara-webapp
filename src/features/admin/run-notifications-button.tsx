'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { runNotificationsAction } from '@/app/(app)/notifications/actions';

/** Runs the notification automation on demand (same work as the hourly cron). */
export function RunNotificationsButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      loading={pending}
      onClick={() =>
        start(async () => {
          const result = await runNotificationsAction();
          if (result.ok) {
            toast.success(`Automation ran — ${result.data.notificationsCreated} notification(s) created, ${result.data.reservationsExpired} reservation(s) expired.`);
            router.refresh();
          } else {
            toast.error(result.error.message);
          }
        })
      }
    >
      <RefreshCw />
      Run Now
    </Button>
  );
}
