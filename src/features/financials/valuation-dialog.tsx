'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { createValuationAction } from '@/app/(app)/financials/actions';
import type { ActionResult } from '@/lib/errors';

interface Ref { id: string; name: string }

const METHODS = [
  { id: 'income', name: 'Income' },
  { id: 'comparable', name: 'Comparable' },
  { id: 'cost', name: 'Cost' },
  { id: 'residual', name: 'Residual' },
];

/** Records a new current valuation. The prior current valuation is superseded
 *  server-side (history preserved). */
export function RecordValuationButton({ properties }: { properties: Ref[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [propertyId, setPropertyId] = useState('');
  const [state, formAction, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(createValuationAction, null);

  useEffect(() => {
    if (state?.ok) { toast.success('Valuation recorded.'); setOpen(false); router.refresh(); }
    else if (state && !state.ok && !state.fieldErrors) toast.error(state.error.message);
  }, [state, router]);

  const fe = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus />Record Valuation</Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader title="Record Valuation" description="Sets the property’s current market value; the previous valuation is kept as history." />
        <form action={formAction}>
          <DialogBody className="flex flex-col gap-4">
            <input type="hidden" name="propertyId" value={propertyId} />
            <Field label="Property" required error={fe?.propertyId?.[0]}>
              <NativeSelect value={propertyId} onChange={setPropertyId} placeholder="Select a property" options={properties} invalid={!!fe?.propertyId?.[0]} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Market Value (SAR)" required error={fe?.marketValue?.[0]}>
                <Input name="marketValue" type="number" step="0.01" min="0" placeholder="0.00" />
              </Field>
              <Field label="Valuation Date" required error={fe?.valuationDate?.[0]}>
                <Input name="valuationDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Book Value (SAR)"><Input name="bookValue" type="number" step="0.01" min="0" placeholder="Optional" /></Field>
              <Field label="Acquisition Cost (SAR)"><Input name="acquisitionCost" type="number" step="0.01" min="0" placeholder="Optional" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Method"><NativeSelect name="valuationMethod" placeholder="—" options={METHODS} /></Field>
              <Field label="Cap Rate (%)" error={fe?.capRate?.[0]}><Input name="capRate" type="number" step="0.01" min="0" max="100" placeholder="e.g. 7.5" /></Field>
            </div>
            <Field label="Valuation Company"><Input name="valuationCompany" maxLength={160} placeholder="Optional" /></Field>
            <Field label="Notes"><Textarea name="notes" rows={2} placeholder="Optional" /></Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
            <Button type="submit" loading={pending} disabled={!propertyId}>Record Valuation</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
