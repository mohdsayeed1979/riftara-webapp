'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState, useTransition } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatCurrency } from '@/lib/format';
import { recordPaymentAction, searchTenantsAction, type RecordPaymentResult } from '@/app/(app)/collections/actions';
import type { ActionResult } from '@/lib/errors';

const METHODS = [
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'sadad', label: 'SADAD' },
  { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' },
];

interface TenantOption {
  id: string;
  label: string;
  outstanding: number;
}

/** Record-payment dialog with auto-allocation feedback (BRD 40, 49). */
export function RecordPaymentButton({ defaultTenantId }: { defaultTenantId?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [tenantId, setTenantId] = useState(defaultTenantId ?? '');
  const [, startTransition] = useTransition();
  const [state, formAction, pending] = useActionState<ActionResult<RecordPaymentResult> | null, FormData>(
    recordPaymentAction,
    null,
  );

  useEffect(() => {
    if (!open) return;
    void searchTenantsAction('').then(setTenants);
  }, [open]);

  useEffect(() => {
    if (state?.ok) {
      const { paymentNumber, unallocated } = state.data;
      toast.success(
        unallocated > 0
          ? `Payment ${paymentNumber} recorded. ${formatCurrency(unallocated)} left unallocated.`
          : `Payment ${paymentNumber} recorded and fully allocated.`,
      );
      setOpen(false);
      startTransition(() => router.refresh());
    } else if (state && !state.ok && !state.fieldErrors) {
      toast.error(state.error.message);
    }
  }, [state, router]);

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const selectedTenant = tenants.find((t) => t.id === tenantId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          Record Payment
        </Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader title="Record Payment" description="Payments allocate to the oldest open invoice first." />
        <form action={formAction}>
          <DialogBody className="flex flex-col gap-4">
            <input type="hidden" name="tenantId" value={tenantId} />
            <Field label="Tenant" required error={fieldErrors?.tenantId?.[0]}>
              <Select value={tenantId} onValueChange={setTenantId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a tenant" />
                </SelectTrigger>
                <SelectContent>
                  {tenants.map((tenant) => (
                    <SelectItem key={tenant.id} value={tenant.id}>
                      {tenant.label}
                      {tenant.outstanding > 0 ? ` · ${formatCurrency(tenant.outstanding)} due` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {selectedTenant && selectedTenant.outstanding > 0 ? (
              <p className="-mt-2 text-[11.5px] text-[var(--color-text-secondary)]">
                Outstanding balance: <span className="font-medium tabular">{formatCurrency(selectedTenant.outstanding)}</span>
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount (SAR)" required error={fieldErrors?.amount?.[0]}>
                <Input name="amount" type="number" step="0.01" min="0" placeholder="0.00" />
              </Field>
              <Field label="Payment Date" required error={fieldErrors?.paymentDate?.[0]}>
                <Input name="paymentDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Method">
                <select
                  name="method"
                  defaultValue="bank_transfer"
                  className="h-9.5 w-full rounded-[var(--radius-control)] border border-[var(--color-border-base)] bg-[var(--color-surface)] px-3 text-[13.5px]"
                >
                  {METHODS.map((method) => (
                    <option key={method.value} value={method.value}>
                      {method.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Reference #">
                <Input name="referenceNumber" placeholder="Transaction reference" />
              </Field>
            </div>

            <Field label="Bank">
              <Input name="bankName" placeholder="Bank name" />
            </Field>

            <Field label="Notes">
              <Textarea name="notes" rows={2} placeholder="Optional notes" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={pending}>
              Record Payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
