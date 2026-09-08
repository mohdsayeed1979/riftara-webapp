'use client';

import { MessageSquarePlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { recordCollectionActionAction } from '@/app/(app)/collections/actions';

const ACTION_TYPES = [
  { value: 'reminder', label: 'Reminder' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'escalation', label: 'Escalation' },
  { value: 'formal_notice', label: 'Formal Notice' },
  { value: 'legal_review', label: 'Legal Review' },
  { value: 'payment_plan', label: 'Payment Plan' },
  { value: 'resolved', label: 'Resolved' },
] as const;

type ActionType = (typeof ACTION_TYPES)[number]['value'];

/** Log a dunning / collection workflow action against a tenant (BRD 47). */
export function LogCollectionActionButton({
  tenantId,
  invoiceId,
  outstandingAmount,
  daysOverdue,
  recommendedAction,
  triggerLabel = 'Log Action',
  triggerVariant = 'secondary',
}: {
  tenantId: string;
  invoiceId?: string;
  outstandingAmount: number;
  daysOverdue: number;
  recommendedAction?: string | null;
  triggerLabel?: string;
  triggerVariant?: 'primary' | 'secondary';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [actionType, setActionType] = useState<ActionType>(
    (recommendedAction as ActionType) ?? 'reminder',
  );
  const [notes, setNotes] = useState('');
  const [outcome, setOutcome] = useState('');
  const [nextActionDate, setNextActionDate] = useState('');
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const result = await recordCollectionActionAction({
        tenantId,
        invoiceId,
        actionType,
        outstandingAmount,
        daysOverdue,
        notes: notes || undefined,
        outcome: outcome || undefined,
        nextActionDate: nextActionDate || undefined,
      });
      if (result.ok) {
        toast.success('Collection action logged.');
        setOpen(false);
        setNotes('');
        setOutcome('');
        setNextActionDate('');
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size="sm">
          <MessageSquarePlus />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader title="Log Collection Action" description="Record a reminder, follow-up or escalation." />
        <DialogBody className="flex flex-col gap-4">
          <Field label="Action">
            <select
              value={actionType}
              onChange={(event) => setActionType(event.target.value as ActionType)}
              className="h-9.5 w-full rounded-[var(--radius-control)] border border-[var(--color-border-base)] bg-[var(--color-surface)] px-3 text-[13.5px]"
            >
              {ACTION_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                  {recommendedAction === type.value ? ' (recommended)' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Outcome">
            <Input value={outcome} onChange={(event) => setOutcome(event.target.value)} placeholder="e.g. Left voicemail, promised payment" />
          </Field>
          <Field label="Next Action Date">
            <Input type="date" value={nextActionDate} onChange={(event) => setNextActionDate(event.target.value)} />
          </Field>
          <Field label="Notes">
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Optional detail" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" loading={pending} onClick={submit}>
            Log Action
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
