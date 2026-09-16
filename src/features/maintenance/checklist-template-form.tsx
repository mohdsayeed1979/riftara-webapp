'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useActionState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { createChecklistTemplateAction } from '@/app/(app)/maintenance/actions';
import type { ActionResult } from '@/lib/errors';

interface Row { key: string; labelEn: string; required: boolean; createsCorrectiveOnFail: boolean }

function emptyRow(): Row {
  return { key: '', labelEn: '', required: false, createsCorrectiveOnFail: false };
}

export function CreateChecklistTemplateButton({ categories }: { categories: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [state, formAction, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(createChecklistTemplateAction, null);

  useEffect(() => {
    if (state?.ok) { toast.success('Checklist template created.'); setOpen(false); setRows([emptyRow()]); router.refresh(); }
    else if (state && !state.ok && !state.fieldErrors) toast.error(state.error.message);
  }, [state, router]);

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus />New Checklist Template</Button>
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader title="New Checklist Template" description="Itemized pass/fail/N-A checklist reusable across work orders." />
        <form action={formAction}>
          <input type="hidden" name="items" value={JSON.stringify(rows.filter((r) => r.key && r.labelEn))} />
          <DialogBody className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Code" required error={fieldErrors?.code?.[0]}>
                <Input name="code" maxLength={32} placeholder="e.g. ELV-QTR" />
              </Field>
              <Field label="Category">
                <NativeSelect name="categoryId" placeholder="None" options={categories} />
              </Field>
            </div>
            <Field label="Name" required error={fieldErrors?.nameEn?.[0]}>
              <Input name="nameEn" maxLength={160} placeholder="e.g. Elevator quarterly inspection" />
            </Field>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-medium text-[var(--color-text-secondary)]">Checklist items</span>
                <Button type="button" variant="secondary" size="sm" onClick={() => setRows((prev) => [...prev, emptyRow()])}>
                  <Plus />Add item
                </Button>
              </div>
              {rows.map((row, index) => (
                <div key={index} className="grid grid-cols-[1fr_2fr_auto_auto_auto] items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] p-2">
                  <Input placeholder="key" value={row.key} onChange={(e) => updateRow(index, { key: e.target.value.trim() })} />
                  <Input placeholder="Label" value={row.labelEn} onChange={(e) => updateRow(index, { labelEn: e.target.value })} />
                  <label className="flex items-center gap-1 text-[11.5px] text-[var(--color-text-secondary)]">
                    <input type="checkbox" checked={row.required} onChange={(e) => updateRow(index, { required: e.target.checked })} />
                    Required
                  </label>
                  <label className="flex items-center gap-1 text-[11.5px] text-[var(--color-text-secondary)]">
                    <input type="checkbox" checked={row.createsCorrectiveOnFail} onChange={(e) => updateRow(index, { createsCorrectiveOnFail: e.target.checked })} />
                    Fail → corrective WO
                  </label>
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))} disabled={rows.length === 1}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
            <Button type="submit" loading={pending}>Create Template</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
