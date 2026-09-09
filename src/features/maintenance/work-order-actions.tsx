'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState, useTransition } from 'react';
import { Ban, CheckCircle2, PlayCircle, PauseCircle, Plus, UserCog } from 'lucide-react';
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
import { Field, Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {
  assignWorkOrderAction,
  recordMaintenanceCostAction,
  transitionWorkOrderStatusAction,
} from '@/app/(app)/maintenance/actions';
import type { ActionResult } from '@/lib/errors';

const TRANSITIONS: Record<string, string[]> = {
  open: ['in_progress', 'cancelled'],
  assigned: ['in_progress', 'pending', 'cancelled'],
  in_progress: ['pending', 'completed', 'cancelled'],
  pending: ['in_progress', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

const STATUS_META: Record<string, { label: string; icon: React.ReactNode; variant: 'primary' | 'secondary' }> = {
  in_progress: { label: 'Start Work', icon: <PlayCircle />, variant: 'primary' },
  pending: { label: 'Mark Pending', icon: <PauseCircle />, variant: 'secondary' },
  completed: { label: 'Complete', icon: <CheckCircle2 />, variant: 'primary' },
  cancelled: { label: 'Cancel', icon: <Ban />, variant: 'secondary' },
};

interface Ref { id: string; name: string }

export function WorkOrderStatusActions({
  workOrderId,
  status,
  canEdit,
  vendors,
  users,
  currentVendorId,
  currentUserId,
}: {
  workOrderId: string;
  status: string;
  canEdit: boolean;
  vendors: Ref[];
  users: Ref[];
  currentVendorId: string | null;
  currentUserId: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const next = TRANSITIONS[status] ?? [];

  function transition(to: string, success: string) {
    start(async () => {
      const result = await transitionWorkOrderStatusAction(workOrderId, to);
      if (result.ok) { toast.success(success); router.refresh(); }
      else toast.error(result.error.message);
    });
  }

  if (!canEdit) return null;

  return (
    <>
      {status !== 'completed' && status !== 'cancelled' ? (
        <AssignWorkOrderButton workOrderId={workOrderId} vendors={vendors} users={users} currentVendorId={currentVendorId} currentUserId={currentUserId} />
      ) : null}
      {next.map((to) => {
        const meta = STATUS_META[to];
        if (!meta) return null;
        return (
          <Button key={to} variant={meta.variant} loading={pending} onClick={() => transition(to, `Work order moved to ${to.replace(/_/g, ' ')}.`)}>
            {meta.icon}
            {meta.label}
          </Button>
        );
      })}
    </>
  );
}

export function AssignWorkOrderButton({
  workOrderId,
  vendors,
  users,
  currentVendorId,
  currentUserId,
}: {
  workOrderId: string;
  vendors: Ref[];
  users: Ref[];
  currentVendorId: string | null;
  currentUserId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [vendorId, setVendorId] = useState(currentVendorId ?? '');
  const [userId, setUserId] = useState(currentUserId ?? '');
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const result = await assignWorkOrderAction(workOrderId, { vendorId: vendorId || null, assignedUserId: userId || null });
      if (result.ok) { toast.success('Assignment updated.'); setOpen(false); router.refresh(); }
      else toast.error(result.error.message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <UserCog />
          Assign
        </Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader title="Assign Work Order" description="Assign a vendor and/or an internal user." />
        <DialogBody className="flex flex-col gap-4">
          <Field label="Vendor">
            <NativeSelect value={vendorId} onChange={setVendorId} placeholder="Unassigned" options={vendors} />
          </Field>
          <Field label="Assigned User">
            <NativeSelect value={userId} onChange={setUserId} placeholder="Unassigned" options={users} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
          <Button type="button" loading={pending} onClick={submit}>Save Assignment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const COST_TYPES = [
  { id: 'vendor_invoice', name: 'Vendor Invoice' },
  { id: 'labour', name: 'Labour' },
  { id: 'parts', name: 'Parts' },
  { id: 'other', name: 'Other' },
];

export function RecordCostButton({ workOrderId }: { workOrderId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(recordMaintenanceCostAction, null);

  useEffect(() => {
    if (state?.ok) { toast.success('Cost recorded.'); setOpen(false); router.refresh(); }
    else if (state && !state.ok && !state.fieldErrors) toast.error(state.error.message);
  }, [state, router]);

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary"><Plus />Record Cost</Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader title="Record Maintenance Cost" description="Costs roll up into property OPEX and NOI (BR-014). Large costs require approval permission." />
        <form action={formAction}>
          <DialogBody className="flex flex-col gap-4">
            <input type="hidden" name="workOrderId" value={workOrderId} />
            <Field label="Description" required error={fieldErrors?.description?.[0]}>
              <Input name="description" maxLength={240} placeholder="e.g. Compressor replacement" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount (SAR)" required error={fieldErrors?.amount?.[0]}>
                <Input name="amount" type="number" step="0.01" min="0" placeholder="0.00" />
              </Field>
              <Field label="Incurred On" required error={fieldErrors?.incurredOn?.[0]}>
                <Input name="incurredOn" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cost Type">
                <NativeSelect name="costType" defaultValue="vendor_invoice" options={COST_TYPES} />
              </Field>
              <Field label="Invoice #">
                <Input name="invoiceNumber" maxLength={60} placeholder="Optional" />
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
            <Button type="submit" loading={pending}>Record Cost</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
