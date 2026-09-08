'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/input';
import { cancelReservationAction } from '@/app/(app)/leasing/reservations/actions';

export function CancelReservationButton({ reservationId }: { reservationId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();

  function cancel() {
    startTransition(async () => {
      const result = await cancelReservationAction(reservationId, reason.trim() || undefined);
      if (result.ok) {
        toast.success('Reservation cancelled. The unit has been released.');
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <XCircle />
          Cancel Reservation
        </Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader title="Cancel reservation" description="This releases the unit and recomputes its availability. The reservation is kept for audit history." />
        <DialogBody>
          <Field label="Reason (optional)">
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this reservation being cancelled?" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Keep reservation</Button>
          <Button type="button" onClick={cancel} loading={pending}>Cancel Reservation</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
