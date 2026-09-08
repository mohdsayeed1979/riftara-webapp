'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useActionState, type ReactNode } from 'react';
import { CalendarClock, MapPin, User } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { createViewingAction, updateViewingAction, type ViewingActionResult } from '@/app/(app)/leasing/viewings/actions';
import type { ActionResult } from '@/lib/errors';

interface Ref { id: string; name: string }
export interface ViewingFormReference {
  customers: Array<Ref & { code: string }>;
  leads: Array<{ id: string; code: string; customerId: string }>;
  properties: Ref[];
  buildings: Array<{ id: string; name: string; propertyId: string }>;
  floors: Array<{ id: string; name: string; buildingId: string; level: number }>;
  units: Array<{ id: string; unitNumber: string; propertyId: string; buildingId: string | null; floorId: string | null }>;
  agents: Ref[];
}
export interface ViewingFormInitial { [key: string]: string | undefined }

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

export function ViewingForm({ reference, initial, mode = 'create', viewingId }: { reference: ViewingFormReference; initial?: ViewingFormInitial; mode?: 'create' | 'edit'; viewingId?: string }) {
  const router = useRouter();
  const action = mode === 'edit' && viewingId ? updateViewingAction.bind(null, viewingId) : createViewingAction;
  const [state, formAction, pending] = useActionState<ActionResult<ViewingActionResult> | null, FormData>(action, null);

  const [customerId, setCustomerId] = useState(initial?.customerId ?? '');
  const [leadId, setLeadId] = useState(initial?.leadId ?? '');
  const [propertyId, setPropertyId] = useState(initial?.propertyId ?? '');
  const [buildingId, setBuildingId] = useState('');
  const [floorId, setFloorId] = useState('');
  const [unitId, setUnitId] = useState(initial?.unitId ?? '');

  const buildingOptions = useMemo(() => (propertyId ? reference.buildings.filter((b) => b.propertyId === propertyId) : []), [reference.buildings, propertyId]);
  const floorOptions = useMemo(() => (buildingId ? reference.floors.filter((f) => f.buildingId === buildingId) : []), [reference.floors, buildingId]);
  const unitOptions = useMemo(() => reference.units.filter((u) => u.propertyId === propertyId && (!buildingId || u.buildingId === buildingId) && (!floorId || u.floorId === floorId)), [reference.units, propertyId, buildingId, floorId]);
  const leadOptions = useMemo(() => (customerId ? reference.leads.filter((l) => l.customerId === customerId) : reference.leads), [reference.leads, customerId]);

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const err = (n: string) => fieldErrors?.[n]?.[0];
  const iv = (n: string) => initial?.[n];

  useEffect(() => {
    if (!state) return;
    if (state.ok) { toast.success(mode === 'edit' ? 'Viewing updated.' : 'Viewing scheduled.'); router.push(`/leasing/viewings/${state.data.id}`); }
    else if (!state.fieldErrors) toast.error(state.error.message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="unitId" value={unitId} />

      <SectionCard icon={<User className="size-4" />} title="Customer & Lead">
        <div className={grid2}>
          <Field label="Customer" required error={err('customerId')}>
            <NativeSelect value={customerId} onChange={(v) => { setCustomerId(v); if (leadId && !reference.leads.some((l) => l.id === leadId && l.customerId === v)) setLeadId(''); }} placeholder="Select a customer" options={reference.customers.map((c) => ({ id: c.id, name: `${c.name} · ${c.code}` }))} invalid={!!err('customerId')} />
          </Field>
          <Field label="Lead" error={err('leadId')} hint="Optional">
            <NativeSelect value={leadId} onChange={setLeadId} placeholder="No lead" options={leadOptions.map((l) => ({ id: l.id, name: l.code }))} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard icon={<MapPin className="size-4" />} title="Property / Unit">
        <div className={grid2}>
          <Field label="Property" required error={err('propertyId')}>
            <NativeSelect value={propertyId} onChange={(v) => { setPropertyId(v); setBuildingId(''); setFloorId(''); setUnitId(''); }} placeholder="Select a property" options={reference.properties} invalid={!!err('propertyId')} />
          </Field>
          <Field label="Building" hint={!propertyId ? 'Select a property first' : buildingOptions.length === 0 ? 'No buildings' : undefined}>
            <NativeSelect value={buildingId} onChange={(v) => { setBuildingId(v); setFloorId(''); if (unitId && !reference.units.some((u) => u.id === unitId && (!v || u.buildingId === v))) setUnitId(''); }} placeholder="Any building" options={buildingOptions} disabled={!propertyId} />
          </Field>
          <Field label="Floor" hint={!buildingId ? 'Select a building first' : floorOptions.length === 0 ? 'No floors' : undefined}>
            <NativeSelect value={floorId} onChange={setFloorId} placeholder="Any floor" options={floorOptions.map((f) => ({ id: f.id, name: `${f.name} (L${f.level})` }))} disabled={!buildingId} />
          </Field>
          <Field label="Unit" error={err('unitId')} hint="Optional">
            <NativeSelect value={unitId} onChange={setUnitId} placeholder="Any unit" options={unitOptions.map((u) => ({ id: u.id, name: u.unitNumber }))} disabled={!propertyId} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard icon={<CalendarClock className="size-4" />} title="Schedule">
        <div className={grid3}>
          <Field label="Date" required error={err('scheduledDate')}><Input name="scheduledDate" type="date" defaultValue={iv('scheduledDate')} aria-invalid={!!err('scheduledDate')} /></Field>
          <Field label="Time" required error={err('scheduledTime')}><Input name="scheduledTime" type="time" defaultValue={iv('scheduledTime')} aria-invalid={!!err('scheduledTime')} /></Field>
          <Field label="Assigned Agent" error={err('assignedUserId')}><NativeSelect name="assignedUserId" defaultValue={iv('assignedUserId')} placeholder="Unassigned" options={reference.agents} /></Field>
          <Field label="Meeting Point" error={err('meetingPoint')}><Input name="meetingPoint" maxLength={200} defaultValue={iv('meetingPoint')} placeholder="Property reception" /></Field>
        </div>
        <Field label="Notes" htmlFor="notes" error={err('notes')} className="mt-4"><Textarea id="notes" name="notes" rows={2} defaultValue={iv('notes')} /></Field>
      </SectionCard>

      {state && !state.ok && !state.fieldErrors ? (
        <p className="rounded-[var(--radius-control)] border border-[var(--color-error)] bg-[var(--color-error-soft)] px-3 py-2 text-[12.5px] text-[var(--color-error)]" role="alert">{state.error.message}</p>
      ) : null}

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)]/90 px-1 py-3 backdrop-blur">
        <Button type="button" variant="ghost" onClick={() => router.push(mode === 'edit' && viewingId ? `/leasing/viewings/${viewingId}` : '/leasing/viewings')} disabled={pending}>Cancel</Button>
        <Button type="submit" loading={pending} disabled={pending}>{mode === 'edit' ? 'Save Changes' : 'Schedule Viewing'}</Button>
      </div>
    </form>
  );
}
