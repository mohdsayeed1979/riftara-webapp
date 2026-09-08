'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, useActionState, useEffect } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { cancelViewingAction, completeViewingAction, type ViewingActionResult } from '@/app/(app)/leasing/viewings/actions';
import type { ActionResult } from '@/lib/errors';

const OPEN = ['scheduled', 'confirmed', 'rescheduled'];

export function ViewingStatusActions({ viewingId, status, canEdit }: { viewingId: string; status: string; canEdit: boolean }) {
  if (!canEdit || !OPEN.includes(status)) return null;
  return (
    <>
      <CompleteDialog viewingId={viewingId} />
      <CancelDialog viewingId={viewingId} />
    </>
  );
}

function CompleteDialog({ viewingId }: { viewingId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const action = completeViewingAction.bind(null, viewingId);
  const [state, formAction, pending] = useActionState<ActionResult<ViewingActionResult> | null, FormData>(action, null);

  useEffect(() => {
    if (state?.ok) { toast.success('Viewing completed and feedback recorded.'); setOpen(false); router.refresh(); }
    else if (state && !state.ok) toast.error(state.error.message);
  }, [state, router]);

  const ratings: Array<[string, string]> = [
    ['interestLevel', 'Interest'], ['priceSuitability', 'Price'], ['areaSuitability', 'Area'],
    ['locationSuitability', 'Location'], ['unitSuitability', 'Unit'], ['likelihoodToLease', 'Likelihood to lease'],
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><CheckCircle2 />Complete</Button></DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader title="Complete viewing" description="Record feedback (ratings 1-5). This marks the viewing completed." />
        <form action={formAction}>
          <DialogBody className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              {ratings.map(([name, label]) => (
                <Field key={name} label={label}>
                  <Input name={name} type="number" min="1" max="5" step="1" />
                </Field>
              ))}
            </div>
            <Field label="Next Action"><Input name="nextAction" maxLength={200} placeholder="e.g. Send a proposal" /></Field>
            <Field label="Agent Comments"><Textarea name="agentComments" rows={2} /></Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" loading={pending}>Complete Viewing</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ viewingId }: { viewingId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, start] = useTransition();

  function cancel() {
    start(async () => {
      const result = await cancelViewingAction(viewingId, reason.trim() || undefined);
      if (result.ok) { toast.success('Viewing cancelled.'); setOpen(false); router.refresh(); }
      else toast.error(result.error.message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="secondary"><XCircle />Cancel</Button></DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader title="Cancel viewing" description="The viewing is kept for history." />
        <DialogBody><Field label="Reason (optional)"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field></DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Keep viewing</Button>
          <Button type="button" onClick={cancel} loading={pending}>Cancel Viewing</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
