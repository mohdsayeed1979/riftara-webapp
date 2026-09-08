'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useActionState, type ReactNode } from 'react';
import { CalendarClock, MapPin, User } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/status-badge';
import { NativeSelect } from '@/components/ui/native-select';
import { createReservationAction, type ReservationActionResult } from '@/app/(app)/leasing/reservations/actions';
import type { ActionResult } from '@/lib/errors';

export interface ReservationFormReference {
  customers: Array<{ id: string; name: string; code: string }>;
  leads: Array<{ id: string; code: string; customerId: string }>;
  properties: Array<{ id: string; name: string }>;
  buildings: Array<{ id: string; name: string; propertyId: string }>;
  floors: Array<{ id: string; name: string; buildingId: string; level: number }>;
  units: Array<{ id: string; unitNumber: string; code: string; propertyId: string; buildingId: string | null; floorId: string | null; availabilityClass: string }>;
}
export interface ReservationFormInitial {
  customerId?: string;
  leadId?: string;
  propertyId?: string;
  unitId?: string;
}

const grid2 = 'grid grid-cols-1 gap-4 sm:grid-cols-2';
const grid3 = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3';
const PAYMENT_STATUSES = [
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partial', label: 'Partially Paid' },
  { value: 'paid', label: 'Paid' },
];

function SectionCard({ icon, title, description, children }: { icon?: ReactNode; title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2">{icon ? <span className="text-[var(--color-text-tertiary)]">{icon}</span> : null}{title}</span>} description={description} />
      <CardBody className="pt-0">{children}</CardBody>
    </Card>
  );
}

export function ReservationForm({ reference, initial }: { reference: ReservationFormReference; initial?: ReservationFormInitial }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult<ReservationActionResult> | null, FormData>(createReservationAction, null);

  const [customerId, setCustomerId] = useState(initial?.customerId ?? '');
  const [leadId, setLeadId] = useState(initial?.leadId ?? '');
  const [propertyId, setPropertyId] = useState(initial?.propertyId ?? '');
  const [buildingId, setBuildingId] = useState('');
  const [floorId, setFloorId] = useState('');
  const [unitId, setUnitId] = useState(initial?.unitId ?? '');

  const buildingOptions = useMemo(() => (propertyId ? reference.buildings.filter((b) => b.propertyId === propertyId) : []), [reference.buildings, propertyId]);
  const floorOptions = useMemo(() => (buildingId ? reference.floors.filter((f) => f.buildingId === buildingId) : []), [reference.floors, buildingId]);
  const unitOptions = useMemo(
    () => reference.units.filter((u) => u.propertyId === propertyId && (!buildingId || u.buildingId === buildingId) && (!floorId || u.floorId === floorId)),
    [reference.units, propertyId, buildingId, floorId],
  );
  const leadOptions = useMemo(() => (customerId ? reference.leads.filter((l) => l.customerId === customerId) : reference.leads), [reference.leads, customerId]);
  const selectedUnit = reference.units.find((u) => u.id === unitId);

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const err = (n: string) => fieldErrors?.[n]?.[0];

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success('Reservation created.');
      router.push(`/leasing/reservations/${state.data.id}`);
    } else if (!state.fieldErrors) {
      toast.error(state.error.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function onPropertyChange(v: string) { setPropertyId(v); setBuildingId(''); setFloorId(''); setUnitId(''); }
  function onBuildingChange(v: string) { setBuildingId(v); setFloorId(''); if (unitId && !reference.units.some((u) => u.id === unitId && (!v || u.buildingId === v))) setUnitId(''); }

  const today = new Date().toISOString().slice(0, 10);

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
          <Field label="Lead" error={err('leadId')} hint="Optional — links this reservation to a lead">
            <NativeSelect value={leadId} onChange={setLeadId} placeholder="No lead" options={leadOptions.map((l) => ({ id: l.id, name: l.code }))} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard icon={<MapPin className="size-4" />} title="Property / Unit" description="The unit is held while the reservation is active (BR-002).">
        <div className={grid2}>
          <Field label="Property" required error={err('propertyId')}>
            <NativeSelect value={propertyId} onChange={onPropertyChange} placeholder="Select a property" options={reference.properties} invalid={!!err('propertyId')} />
          </Field>
          <Field label="Building" hint={!propertyId ? 'Select a property first' : buildingOptions.length === 0 ? 'No buildings' : undefined}>
            <NativeSelect value={buildingId} onChange={onBuildingChange} placeholder="Any building" options={buildingOptions} disabled={!propertyId} />
          </Field>
          <Field label="Floor" hint={!buildingId ? 'Select a building first' : floorOptions.length === 0 ? 'No floors' : undefined}>
            <NativeSelect value={floorId} onChange={setFloorId} placeholder="Any floor" options={floorOptions.map((f) => ({ id: f.id, name: `${f.name} (L${f.level})` }))} disabled={!buildingId} />
          </Field>
          <Field label="Unit" required error={err('unitId')} hint={!propertyId ? 'Select a property first' : undefined}>
            <NativeSelect value={unitId} onChange={setUnitId} placeholder="Select a unit" options={unitOptions.map((u) => ({ id: u.id, name: `${u.unitNumber} · ${u.code}` }))} disabled={!propertyId} invalid={!!err('unitId')} />
          </Field>
        </div>
        {selectedUnit ? (
          <div className="mt-3 flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)]">
            <span>Availability:</span>
            <StatusBadge status={selectedUnit.availabilityClass} size="sm" />
            {selectedUnit.availabilityClass !== 'available' ? (
              <span className="text-[var(--color-warning-strong,#b97a08)]">This unit is not available — reservation will be blocked if it already has an active reservation or lease.</span>
            ) : null}
          </div>
        ) : null}
      </SectionCard>

      <SectionCard icon={<CalendarClock className="size-4" />} title="Reservation Terms">
        <div className={grid3}>
          <Field label="Reservation Date" required error={err('reservationDate')}>
            <Input name="reservationDate" type="date" defaultValue={today} aria-invalid={!!err('reservationDate')} />
          </Field>
          <Field label="Expiry Date" required error={err('expiryDate')} hint="Hold expires on this date (BR-011)">
            <Input name="expiryDate" type="date" aria-invalid={!!err('expiryDate')} />
          </Field>
          <Field label="Reservation Amount (SAR)" error={err('reservationAmount')}>
            <Input name="reservationAmount" type="number" min="0" step="0.01" defaultValue="0" />
          </Field>
          <Field label="Payment Status" error={err('paymentStatus')}>
            <NativeSelect name="paymentStatus" defaultValue="unpaid" options={PAYMENT_STATUSES} />
          </Field>
        </div>
        <Field label="Terms" htmlFor="terms" error={err('terms')} className="mt-4">
          <Textarea id="terms" name="terms" rows={2} />
        </Field>
      </SectionCard>

      {state && !state.ok && !state.fieldErrors ? (
        <p className="rounded-[var(--radius-control)] border border-[var(--color-error)] bg-[var(--color-error-soft)] px-3 py-2 text-[12.5px] text-[var(--color-error)]" role="alert">{state.error.message}</p>
      ) : null}

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)]/90 px-1 py-3 backdrop-blur">
        <Button type="button" variant="ghost" onClick={() => router.push('/leasing/reservations')} disabled={pending}>Cancel</Button>
        <Button type="submit" loading={pending} disabled={pending}>Create Reservation</Button>
      </div>
    </form>
  );
}
