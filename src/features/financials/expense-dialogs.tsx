'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useMemo, useState } from 'react';
import { Plus, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { createExpenseCategoryAction, createOperatingExpenseAction, updateOperatingExpenseAction, type ExpenseActionResult } from '@/app/(app)/financials/actions';
import type { ActionResult } from '@/lib/errors';

interface Ref { id: string; name: string }
export interface FinancialReference {
  properties: Ref[];
  units: Array<{ id: string; unitNumber: string; propertyId: string }>;
  categories: Array<{ id: string; name: string; includedInOpex: boolean }>;
  vendors: Ref[];
}
export interface ExpenseInitial { [key: string]: string | boolean | undefined }

/** Record or edit an operating expense. `mode` filters the category list:
 *  'opex' shows OPEX categories, 'capex' shows non-operating (capital) ones. */
export function RecordExpenseButton({
  reference,
  mode = 'opex',
  expenseId,
  initial,
  triggerLabel,
  triggerVariant = 'primary',
}: {
  reference: FinancialReference;
  mode?: 'opex' | 'capex';
  expenseId?: string;
  initial?: ExpenseInitial;
  triggerLabel?: string;
  triggerVariant?: 'primary' | 'secondary';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const action = expenseId ? updateOperatingExpenseAction.bind(null, expenseId) : createOperatingExpenseAction;
  const [state, formAction, pending] = useActionState<ActionResult<ExpenseActionResult> | null, FormData>(action, null);

  const [propertyId, setPropertyId] = useState((initial?.propertyId as string) ?? '');
  const [unitId, setUnitId] = useState((initial?.unitId as string) ?? '');

  const categories = useMemo(
    () => reference.categories.filter((c) => (mode === 'capex' ? !c.includedInOpex : c.includedInOpex)),
    [reference.categories, mode],
  );
  const unitOptions = useMemo(
    () => reference.units.filter((u) => u.propertyId === propertyId).map((u) => ({ id: u.id, name: u.unitNumber })),
    [reference.units, propertyId],
  );

  useEffect(() => {
    if (state?.ok) {
      toast.success(expenseId ? 'Expense updated.' : `Expense recorded${state.data.reference ? ` (${state.data.reference})` : ''}.`);
      setOpen(false);
      router.refresh();
    } else if (state && !state.ok && !state.fieldErrors) {
      toast.error(state.error.message);
    }
  }, [state, router, expenseId]);

  const fe = state && !state.ok ? state.fieldErrors : undefined;
  const iv = (n: string) => (typeof initial?.[n] === 'string' ? (initial?.[n] as string) : undefined);
  const label = triggerLabel ?? (expenseId ? 'Edit' : mode === 'capex' ? 'Record CAPEX' : 'Record OPEX');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size={expenseId ? 'sm' : 'md'}>{expenseId ? null : <Plus />}{label}</Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader
          title={expenseId ? 'Edit Expense' : mode === 'capex' ? 'Record Capital Expenditure' : 'Record Operating Expense'}
          description={mode === 'capex' ? 'Capital spend is excluded from OPEX/NOI.' : 'Operating expenses feed property OPEX and NOI (BR-014). Large amounts require approval.'}
        />
        <form action={formAction}>
          <DialogBody className="flex flex-col gap-4">
            <input type="hidden" name="propertyId" value={propertyId} />
            <input type="hidden" name="unitId" value={unitId} />
            <Field label="Category" required error={fe?.categoryId?.[0]}>
              <NativeSelect name="categoryId" defaultValue={iv('categoryId')} placeholder="Select a category" options={categories.map((c) => ({ id: c.id, name: c.name }))} invalid={!!fe?.categoryId?.[0]} />
            </Field>
            <Field label="Description" required error={fe?.description?.[0]}>
              <Input name="description" maxLength={240} defaultValue={iv('description')} placeholder="e.g. Q3 chiller servicing" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Property" required error={fe?.propertyId?.[0]}>
                <NativeSelect value={propertyId} onChange={(v) => { setPropertyId(v); setUnitId(''); }} placeholder="Select" options={reference.properties} invalid={!!fe?.propertyId?.[0]} />
              </Field>
              <Field label="Unit" error={fe?.unitId?.[0]} hint={!propertyId ? 'Property first' : 'Optional'}>
                <NativeSelect value={unitId} onChange={setUnitId} placeholder="Property-level" options={unitOptions} disabled={!propertyId} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount (SAR)" required error={fe?.amount?.[0]}>
                <Input name="amount" type="number" step="0.01" min="0" defaultValue={iv('amount')} placeholder="0.00" />
              </Field>
              <Field label="VAT (SAR)" error={fe?.vatAmount?.[0]}>
                <Input name="vatAmount" type="number" step="0.01" min="0" defaultValue={iv('vatAmount')} placeholder="0.00" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Incurred On" required error={fe?.incurredOn?.[0]}>
                <Input name="incurredOn" type="date" defaultValue={iv('incurredOn') ?? new Date().toISOString().slice(0, 10)} />
              </Field>
              <Field label="Vendor" error={fe?.vendorId?.[0]}>
                <NativeSelect name="vendorId" defaultValue={iv('vendorId')} placeholder="None" options={reference.vendors} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Invoice #">
                <Input name="invoiceNumber" maxLength={60} defaultValue={iv('invoiceNumber')} placeholder="Optional" />
              </Field>
              <label className="flex items-center gap-2 pt-6 text-[13px]">
                <input type="checkbox" name="isRecoverable" defaultChecked={initial?.isRecoverable === true} />
                Recoverable
              </label>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
            <Button type="submit" loading={pending} disabled={!propertyId}>{expenseId ? 'Save Changes' : 'Record Expense'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Create an expense category. Toggle off "Included in OPEX" to define a CAPEX /
 *  capital category so its spend stays out of OPEX/NOI. */
export function NewCategoryButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(createExpenseCategoryAction, null);

  useEffect(() => {
    if (state?.ok) { toast.success('Category created.'); setOpen(false); router.refresh(); }
    else if (state && !state.ok && !state.fieldErrors) toast.error(state.error.message);
  }, [state, router]);

  const fe = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary"><Tag />New Category</Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader title="New Expense Category" description="Uncheck “Included in OPEX” to create a capital (CAPEX) category." />
        <form action={formAction}>
          <DialogBody className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Key" required error={fe?.key?.[0]}>
                <Input name="key" maxLength={64} placeholder="e.g. capital_works" />
              </Field>
              <Field label="Name (EN)" required error={fe?.nameEn?.[0]}>
                <Input name="nameEn" maxLength={120} placeholder="Capital Works" />
              </Field>
            </div>
            <Field label="Name (AR)" error={fe?.nameAr?.[0]}>
              <Input name="nameAr" maxLength={120} placeholder="الأعمال الرأسمالية" dir="rtl" />
            </Field>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" name="includedInOpex" defaultChecked />
                Included in OPEX (uncheck for CAPEX / capital)
              </label>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" name="isRecoverable" />
                Recoverable from tenants
              </label>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
            <Button type="submit" loading={pending}>Create Category</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
