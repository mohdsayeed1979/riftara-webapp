'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useActionState, type ReactNode } from 'react';
import { ClipboardList, MapPin, UserCog } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {
  createWorkOrderAction,
  updateWorkOrderAction,
  type WorkOrderActionResult,
} from '@/app/(app)/maintenance/actions';
import type { ActionResult } from '@/lib/errors';

interface Ref { id: string; name: string }
export interface WorkOrderFormReference {
  properties: Ref[];
  units: Array<{ id: string; unitNumber: string; propertyId: string }>;
  categories: Ref[];
  vendors: Ref[];
  users: Ref[];
}
export interface WorkOrderFormInitial { [key: string]: string | undefined }

const MAINTENANCE_TYPES = [
  { id: 'corrective', name: 'Corrective' },
  { id: 'preventive', name: 'Preventive' },
  { id: 'emergency', name: 'Emergency' },
  { id: 'inspection', name: 'Inspection' },
  { id: 'renovation', name: 'Renovation' },
  { id: 'unit_turnaround', name: 'Unit Turnaround' },
];
const PRIORITIES = [
  { id: 'low', name: 'Low' },
  { id: 'medium', name: 'Medium' },
  { id: 'high', name: 'High' },
  { id: 'critical', name: 'Critical' },
];

const grid2 = 'grid grid-cols-1 gap-4 sm:grid-cols-2';
const grid3 = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3';

function SectionCard({ icon, title, children }: { icon?: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2">{icon ? <span className="text-[var(--color-text-tertiary)]">{icon}</span> : null}{title}</span>} />
      <CardBody className="pt-0">{children}</CardBody>
    </Card>
  );
}

export function WorkOrderForm({
  reference,
  initial,
  mode = 'create',
  workOrderId,
}: {
  reference: WorkOrderFormReference;
  initial?: WorkOrderFormInitial;
  mode?: 'create' | 'edit';
  workOrderId?: string;
}) {
  const router = useRouter();
  const action = mode === 'edit' && workOrderId ? updateWorkOrderAction.bind(null, workOrderId) : createWorkOrderAction;
  const [state, formAction, pending] = useActionState<ActionResult<WorkOrderActionResult> | null, FormData>(action, null);

  const [propertyId, setPropertyId] = useState(initial?.propertyId ?? '');
  const [unitId, setUnitId] = useState(initial?.unitId ?? '');

  const unitOptions = useMemo(
    () => reference.units.filter((u) => u.propertyId === propertyId).map((u) => ({ id: u.id, name: u.unitNumber })),
    [reference.units, propertyId],
  );

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const err = (n: string) => fieldErrors?.[n]?.[0];
  const iv = (n: string) => initial?.[n];

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(mode === 'edit' ? 'Work order updated.' : 'Work order created.');
      router.push(`/maintenance/${state.data.id}`);
    } else if (!state.fieldErrors) {
      toast.error(state.error.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="unitId" value={unitId} />

      <SectionCard icon={<ClipboardList className="size-4" />} title="Work Order">
        <div className="flex flex-col gap-4">
          <Field label="Title" required error={err('title')}>
            <Input name="title" maxLength={200} defaultValue={iv('title')} aria-invalid={!!err('title')} placeholder="e.g. HVAC not cooling — level 3" />
          </Field>
          <div className={grid3}>
            <Field label="Type" required error={err('maintenanceType')}>
              <NativeSelect name="maintenanceType" defaultValue={iv('maintenanceType') ?? 'corrective'} options={MAINTENANCE_TYPES} invalid={!!err('maintenanceType')} />
            </Field>
            <Field label="Priority" required error={err('priority')}>
              <NativeSelect name="priority" defaultValue={iv('priority') ?? 'medium'} options={PRIORITIES} invalid={!!err('priority')} />
            </Field>
            <Field label="Category" error={err('categoryId')} hint="Optional">
              <NativeSelect name="categoryId" defaultValue={iv('categoryId')} placeholder="No category" options={reference.categories} />
            </Field>
          </div>
          <Field label="Description" htmlFor="description" error={err('description')}>
            <Textarea id="description" name="description" rows={3} defaultValue={iv('description')} placeholder="Describe the issue or task" />
          </Field>
        </div>
      </SectionCard>

      <SectionCard icon={<MapPin className="size-4" />} title="Location">
        <div className={grid2}>
          <Field label="Property" required error={err('propertyId')} hint={mode === 'edit' ? 'Property cannot be changed after creation' : undefined}>
            <NativeSelect
              value={propertyId}
              onChange={(v) => { setPropertyId(v); setUnitId(''); }}
              placeholder="Select a property"
              options={reference.properties}
              invalid={!!err('propertyId')}
              disabled={mode === 'edit'}
            />
          </Field>
          <Field label="Unit" error={err('unitId')} hint={!propertyId ? 'Select a property first' : unitOptions.length === 0 ? 'No units — common area' : 'Optional'}>
            <NativeSelect value={unitId} onChange={setUnitId} placeholder="Common area" options={unitOptions} disabled={!propertyId} />
          </Field>
        </div>
      </SectionCard>

      {mode === 'create' ? (
        <SectionCard icon={<UserCog className="size-4" />} title="Assignment & Cost">
          <div className={grid3}>
            <Field label="Vendor" error={err('vendorId')} hint="Optional">
              <NativeSelect name="vendorId" defaultValue={iv('vendorId')} placeholder="Unassigned" options={reference.vendors} />
            </Field>
            <Field label="Assigned User" error={err('assignedUserId')} hint="Optional">
              <NativeSelect name="assignedUserId" defaultValue={iv('assignedUserId')} placeholder="Unassigned" options={reference.users} />
            </Field>
            <Field label="Estimated Cost (SAR)" error={err('estimatedCost')}>
              <Input name="estimatedCost" type="number" step="0.01" min="0" defaultValue={iv('estimatedCost')} placeholder="0.00" />
            </Field>
          </div>
        </SectionCard>
      ) : (
        <SectionCard icon={<UserCog className="size-4" />} title="Cost & Resolution">
          <div className={grid2}>
            <Field label="Estimated Cost (SAR)" error={err('estimatedCost')}>
              <Input name="estimatedCost" type="number" step="0.01" min="0" defaultValue={iv('estimatedCost')} placeholder="0.00" />
            </Field>
          </div>
          <Field label="Resolution Notes" htmlFor="resolutionNotes" error={err('resolutionNotes')} className="mt-4">
            <Textarea id="resolutionNotes" name="resolutionNotes" rows={3} defaultValue={iv('resolutionNotes')} placeholder="Optional resolution detail" />
          </Field>
        </SectionCard>
      )}

      {state && !state.ok && !state.fieldErrors ? (
        <p className="rounded-[var(--radius-control)] border border-[var(--color-error)] bg-[var(--color-error-soft)] px-3 py-2 text-[12.5px] text-[var(--color-error)]" role="alert">{state.error.message}</p>
      ) : null}

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)]/90 px-1 py-3 backdrop-blur">
        <Button type="button" variant="ghost" onClick={() => router.push(mode === 'edit' && workOrderId ? `/maintenance/${workOrderId}` : '/maintenance')} disabled={pending}>Cancel</Button>
        <Button type="submit" loading={pending} disabled={pending}>{mode === 'edit' ? 'Save Changes' : 'Create Work Order'}</Button>
      </div>
    </form>
  );
}
