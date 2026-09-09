'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { Plus, ListPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { createBudgetAction, upsertBudgetLineAction } from '@/app/(app)/financials/actions';
import type { ActionResult } from '@/lib/errors';

interface Ref { id: string; name: string }

const LINE_TYPES = [
  { id: 'revenue', name: 'Revenue' },
  { id: 'collection', name: 'Collections' },
  { id: 'opex', name: 'Operating Expenses' },
  { id: 'maintenance', name: 'Maintenance' },
  { id: 'noi', name: 'Net Operating Income' },
];
const MONTHS = Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), name: new Date(2000, i, 1).toLocaleString('en', { month: 'long' }) }));

export function CreateBudgetButton({ properties, fiscalYear }: { properties: Ref[]; fiscalYear: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(createBudgetAction, null);

  useEffect(() => {
    if (state?.ok) { toast.success('Budget created.'); setOpen(false); router.refresh(); }
    else if (state && !state.ok && !state.fieldErrors) toast.error(state.error.message);
  }, [state, router]);

  const fe = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus />Create Budget</Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader title="Create Budget" description="Create a fiscal-year budget, then add budget lines for variance analysis." />
        <form action={formAction}>
          <DialogBody className="flex flex-col gap-4">
            <Field label="Name" required error={fe?.name?.[0]}>
              <Input name="name" maxLength={160} placeholder={`FY${fiscalYear} Operating Budget`} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Fiscal Year" required error={fe?.fiscalYear?.[0]}>
                <Input name="fiscalYear" type="number" min="2000" max="2100" defaultValue={String(fiscalYear)} />
              </Field>
              <Field label="Status">
                <NativeSelect name="status" defaultValue="draft" options={[{ id: 'draft', name: 'Draft' }, { id: 'approved', name: 'Approved' }, { id: 'closed', name: 'Closed' }]} />
              </Field>
            </div>
            <Field label="Property" hint="Optional — leave blank for portfolio-wide">
              <NativeSelect name="propertyId" placeholder="Portfolio-wide" options={properties} />
            </Field>
            <Field label="Notes"><Textarea name="notes" rows={2} placeholder="Optional" /></Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
            <Button type="submit" loading={pending}>Create Budget</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AddBudgetLineButton({ budgets }: { budgets: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionResult<{ id: string; created: boolean }> | null, FormData>(upsertBudgetLineAction, null);

  useEffect(() => {
    if (state?.ok) { toast.success(state.data.created ? 'Budget line added.' : 'Budget line updated.'); setOpen(false); router.refresh(); }
    else if (state && !state.ok && !state.fieldErrors) toast.error(state.error.message);
  }, [state, router]);

  const fe = state && !state.ok ? state.fieldErrors : undefined;
  if (budgets.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary"><ListPlus />Add Budget Line</Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader title="Add / Update Budget Line" description="Set a budgeted amount for a line type and month." />
        <form action={formAction}>
          <DialogBody className="flex flex-col gap-4">
            <Field label="Budget" required error={fe?.budgetId?.[0]}>
              <NativeSelect name="budgetId" placeholder="Select a budget" options={budgets} invalid={!!fe?.budgetId?.[0]} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Line Type" required error={fe?.lineType?.[0]}>
                <NativeSelect name="lineType" defaultValue="opex" options={LINE_TYPES} />
              </Field>
              <Field label="Month" required error={fe?.periodMonth?.[0]}>
                <NativeSelect name="periodMonth" defaultValue="1" options={MONTHS} />
              </Field>
            </div>
            <Field label="Budget Amount (SAR)" required error={fe?.budgetAmount?.[0]}>
              <Input name="budgetAmount" type="number" step="0.01" min="0" placeholder="0.00" />
            </Field>
            <Field label="Notes"><Textarea name="notes" rows={2} placeholder="Optional" /></Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
            <Button type="submit" loading={pending}>Save Line</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
