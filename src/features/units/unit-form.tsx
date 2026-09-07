'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useActionState, type ReactNode } from 'react';
import { Boxes, CircleDollarSign, Gauge, LayoutGrid, MapPin, Ruler } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';
import { NativeSelect } from '@/components/ui/native-select';
import {
  FIT_OUT_STATUSES,
  FURNISHING_STATUSES,
  UNIT_CONDITIONS,
  UNIT_USAGES,
} from '@/lib/units/enums';
import { createUnitAction, updateUnitAction, type UnitActionResult } from '@/app/(app)/units/actions';
import type { ActionResult } from '@/lib/errors';

interface RefItem {
  id: string;
  name: string;
}
export interface UnitFormReference {
  properties: RefItem[];
  buildings: Array<RefItem & { propertyId: string }>;
  floors: Array<RefItem & { buildingId: string; level: number }>;
  types: RefItem[];
  statuses: RefItem[];
}

export interface UnitFormInitial {
  propertyId?: string;
  buildingId?: string;
  floorId?: string;
  [key: string]: string | boolean | undefined;
}

const grid2 = 'grid grid-cols-1 gap-4 sm:grid-cols-2';
const grid3 = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3';

function SectionCard({ icon, title, description, children }: { icon?: ReactNode; title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2">{icon ? <span className="text-[var(--color-text-tertiary)]">{icon}</span> : null}{title}</span>}
        description={description}
      />
      <CardBody className="pt-0">{children}</CardBody>
    </Card>
  );
}

const FLAGS = [
  { name: 'hasKitchen', label: 'Kitchen' },
  { name: 'hasMaidRoom', label: 'Maid Room' },
  { name: 'hasDriverRoom', label: 'Driver Room' },
  { name: 'signageRights', label: 'Signage Rights' },
  { name: 'loadingAccess', label: 'Loading Access' },
  { name: 'deliveryAccess', label: 'Delivery Access' },
  { name: 'fireSystem', label: 'Fire System' },
] as const;

export function UnitForm({
  mode,
  reference,
  suggestedCode,
  unitId,
  initial,
}: {
  mode: 'create' | 'edit';
  reference: UnitFormReference;
  suggestedCode: string;
  unitId?: string;
  initial?: UnitFormInitial;
}) {
  const router = useRouter();
  const action = mode === 'edit' && unitId ? updateUnitAction.bind(null, unitId) : createUnitAction;
  const [state, formAction, pending] = useActionState<ActionResult<UnitActionResult> | null, FormData>(action, null);

  const [propertyId, setPropertyId] = useState(initial?.propertyId ?? '');
  const [buildingId, setBuildingId] = useState(initial?.buildingId ?? '');
  const [floorId, setFloorId] = useState(initial?.floorId ?? '');
  const [flags, setFlags] = useState<Record<string, boolean>>(() => {
    const f: Record<string, boolean> = {};
    for (const flag of FLAGS) f[flag.name] = initial?.[flag.name] === true;
    return f;
  });

  const buildingOptions = useMemo(
    () => (propertyId ? reference.buildings.filter((b) => b.propertyId === propertyId) : []),
    [reference.buildings, propertyId],
  );
  const floorOptions = useMemo(
    () => (buildingId ? reference.floors.filter((f) => f.buildingId === buildingId) : []),
    [reference.floors, buildingId],
  );

  function onPropertyChange(value: string) {
    setPropertyId(value);
    if (buildingId && !reference.buildings.some((b) => b.id === buildingId && b.propertyId === value)) {
      setBuildingId('');
      setFloorId('');
    }
  }
  function onBuildingChange(value: string) {
    setBuildingId(value);
    if (floorId && !reference.floors.some((f) => f.id === floorId && f.buildingId === value)) setFloorId('');
  }

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const err = (name: string) => fieldErrors?.[name]?.[0];
  const iv = (name: string) => (typeof initial?.[name] === 'string' ? (initial[name] as string) : undefined);

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(mode === 'edit' ? 'Unit updated.' : 'Unit created.');
      router.push(`/units/${state.data.id}`);
    } else {
      toast.error(state.error.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const floorHint = !buildingId ? 'Select a building first' : floorOptions.length === 0 ? 'No floors for this building' : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {/* Location / Hierarchy */}
      <SectionCard icon={<MapPin className="size-4" />} title="Location / Hierarchy" description="Property → Building → Floor. Building and floor are optional.">
        <div className={grid3}>
          <Field label="Property" required error={err('propertyId')}>
            <NativeSelect name="propertyId" value={propertyId} onChange={onPropertyChange} placeholder="Select a property" options={reference.properties} invalid={!!err('propertyId')} />
          </Field>
          <Field label="Building" error={err('buildingId')} hint={!propertyId ? 'Select a property first' : buildingOptions.length === 0 ? 'No buildings for this property' : undefined}>
            <NativeSelect name="buildingId" value={buildingId} onChange={onBuildingChange} placeholder="No building" options={buildingOptions} disabled={!propertyId} invalid={!!err('buildingId')} />
          </Field>
          <Field label="Floor" error={err('floorId')} hint={floorHint}>
            <NativeSelect name="floorId" value={floorId} onChange={setFloorId} placeholder="No floor" options={floorOptions.map((f) => ({ id: f.id, name: `${f.name} (L${f.level})` }))} disabled={!buildingId} invalid={!!err('floorId')} />
          </Field>
        </div>
      </SectionCard>

      {/* Basic Information */}
      <SectionCard icon={<LayoutGrid className="size-4" />} title="Basic Information">
        <div className={grid3}>
          <Field label="Unit Code" htmlFor="code" required error={err('code')} hint="Unique per organization">
            <Input id="code" name="code" defaultValue={iv('code') ?? suggestedCode} maxLength={40} aria-invalid={!!err('code')} />
          </Field>
          <Field label="Unit Number" htmlFor="unitNumber" required error={err('unitNumber')}>
            <Input id="unitNumber" name="unitNumber" defaultValue={iv('unitNumber')} maxLength={40} aria-invalid={!!err('unitNumber')} />
          </Field>
          <Field label="Unit Type" required error={err('unitTypeId')}>
            <NativeSelect name="unitTypeId" defaultValue={iv('unitTypeId')} placeholder="Select a type" options={reference.types} invalid={!!err('unitTypeId')} />
          </Field>
          <Field label="Usage Type" required error={err('usageType')}>
            <NativeSelect name="usageType" defaultValue={iv('usageType') ?? 'commercial'} options={UNIT_USAGES} invalid={!!err('usageType')} />
          </Field>
          <Field label="Unit Status" required error={err('statusId')}>
            <NativeSelect name="statusId" defaultValue={iv('statusId')} placeholder="Select a status" options={reference.statuses} invalid={!!err('statusId')} />
          </Field>
        </div>
      </SectionCard>

      {/* Areas */}
      <SectionCard icon={<Ruler className="size-4" />} title="Areas">
        <div className={grid3}>
          {([
            ['grossArea', 'Gross Area (m²)'],
            ['netArea', 'Net Area (m²)'],
            ['leasableArea', 'Leasable Area (m²)'],
            ['terraceArea', 'Terrace Area (m²)'],
            ['balconyArea', 'Balcony Area (m²)'],
            ['storageArea', 'Storage Area (m²)'],
          ] as const).map(([name, label]) => (
            <Field key={name} label={label} htmlFor={name} error={err(name)}>
              <Input id={name} name={name} type="number" step="0.01" min="0" defaultValue={iv(name)} />
            </Field>
          ))}
          <Field label="Parking Allocation" htmlFor="parkingAllocation" error={err('parkingAllocation')}>
            <Input id="parkingAllocation" name="parkingAllocation" type="number" min="0" step="1" defaultValue={iv('parkingAllocation') ?? '0'} />
          </Field>
        </div>
      </SectionCard>

      {/* Room Details */}
      <SectionCard icon={<Boxes className="size-4" />} title="Room Details">
        <div className="flex flex-col gap-4">
          <div className={grid3}>
            <Field label="Number of Rooms" htmlFor="roomCount" error={err('roomCount')}>
              <Input id="roomCount" name="roomCount" type="number" min="0" step="1" defaultValue={iv('roomCount')} />
            </Field>
            <Field label="Bedrooms" htmlFor="bedroomCount" error={err('bedroomCount')}>
              <Input id="bedroomCount" name="bedroomCount" type="number" min="0" step="1" defaultValue={iv('bedroomCount')} />
            </Field>
            <Field label="Bathrooms" htmlFor="bathroomCount" error={err('bathroomCount')}>
              <Input id="bathroomCount" name="bathroomCount" type="number" min="0" step="1" defaultValue={iv('bathroomCount')} />
            </Field>
          </div>
          <FlagRow names={['hasKitchen', 'hasMaidRoom', 'hasDriverRoom']} flags={flags} setFlags={setFlags} />
        </div>
      </SectionCard>

      {/* Commercial Information */}
      <SectionCard title="Commercial Information" description="For retail, office and industrial units where applicable.">
        <div className="flex flex-col gap-4">
          <div className={grid3}>
            <Field label="Frontage (m)" htmlFor="frontage" error={err('frontage')}>
              <Input id="frontage" name="frontage" type="number" step="0.01" min="0" defaultValue={iv('frontage')} />
            </Field>
            <Field label="Ceiling Height (m)" htmlFor="ceilingHeight" error={err('ceilingHeight')}>
              <Input id="ceilingHeight" name="ceilingHeight" type="number" step="0.01" min="0" defaultValue={iv('ceilingHeight')} />
            </Field>
            <Field label="Electrical Load" htmlFor="electricalLoad" error={err('electricalLoad')}>
              <Input id="electricalLoad" name="electricalLoad" maxLength={64} defaultValue={iv('electricalLoad')} />
            </Field>
            <Field label="HVAC Capacity" htmlFor="hvacCapacity" error={err('hvacCapacity')}>
              <Input id="hvacCapacity" name="hvacCapacity" maxLength={64} defaultValue={iv('hvacCapacity')} />
            </Field>
            <Field label="Utility Capacity" htmlFor="utilityCapacity" error={err('utilityCapacity')}>
              <Input id="utilityCapacity" name="utilityCapacity" maxLength={64} defaultValue={iv('utilityCapacity')} />
            </Field>
          </div>
          <Field label="Permitted Activities" htmlFor="permittedActivities" error={err('permittedActivities')} hint="Comma-separated list">
            <Input id="permittedActivities" name="permittedActivities" defaultValue={iv('permittedActivities')} placeholder="Retail, F&B, Showroom" />
          </Field>
          <Field label="Fit-Out Requirements" htmlFor="fitOutRequirements" error={err('fitOutRequirements')}>
            <Textarea id="fitOutRequirements" name="fitOutRequirements" rows={2} defaultValue={iv('fitOutRequirements')} />
          </Field>
          <FlagRow names={['signageRights', 'loadingAccess', 'deliveryAccess', 'fireSystem']} flags={flags} setFlags={setFlags} />
        </div>
      </SectionCard>

      {/* Utilities / Meters */}
      <SectionCard icon={<Gauge className="size-4" />} title="Utilities / Meters">
        <div className={grid3}>
          <Field label="HVAC Type" htmlFor="hvacType" error={err('hvacType')}>
            <Input id="hvacType" name="hvacType" maxLength={64} defaultValue={iv('hvacType')} placeholder="Central / Split / VRF" />
          </Field>
          <Field label="Electricity Meter #" htmlFor="electricityMeterNumber" error={err('electricityMeterNumber')}>
            <Input id="electricityMeterNumber" name="electricityMeterNumber" maxLength={48} defaultValue={iv('electricityMeterNumber')} />
          </Field>
          <Field label="Water Meter #" htmlFor="waterMeterNumber" error={err('waterMeterNumber')}>
            <Input id="waterMeterNumber" name="waterMeterNumber" maxLength={48} defaultValue={iv('waterMeterNumber')} />
          </Field>
          <Field label="Electricity Account" htmlFor="electricityAccount" error={err('electricityAccount')}>
            <Input id="electricityAccount" name="electricityAccount" maxLength={48} defaultValue={iv('electricityAccount')} />
          </Field>
          <Field label="Water Account" htmlFor="waterAccount" error={err('waterAccount')}>
            <Input id="waterAccount" name="waterAccount" maxLength={48} defaultValue={iv('waterAccount')} />
          </Field>
        </div>
      </SectionCard>

      {/* Furnishing / Condition */}
      <SectionCard title="Furnishing / Condition">
        <div className={grid3}>
          <Field label="Furnishing Status" error={err('furnishingStatus')}>
            <NativeSelect name="furnishingStatus" defaultValue={iv('furnishingStatus') ?? 'unfurnished'} options={FURNISHING_STATUSES} />
          </Field>
          <Field label="Fit-Out Status" error={err('fitOutStatus')}>
            <NativeSelect name="fitOutStatus" defaultValue={iv('fitOutStatus') ?? 'shell_core'} options={FIT_OUT_STATUSES} />
          </Field>
          <Field label="Condition" error={err('condition')}>
            <NativeSelect name="condition" defaultValue={iv('condition')} placeholder="Select" options={UNIT_CONDITIONS} />
          </Field>
        </div>
      </SectionCard>

      {/* Availability */}
      <SectionCard title="Availability" description="A manual availability date; the engine derives the effective availability.">
        <div className={grid2}>
          <Field label="Availability Date" htmlFor="availabilityDate" error={err('availabilityDate')}>
            <Input id="availabilityDate" name="availabilityDate" type="date" defaultValue={iv('availabilityDate')} />
          </Field>
        </div>
      </SectionCard>

      {/* Pricing */}
      <SectionCard icon={<CircleDollarSign className="size-4" />} title="Pricing" description="Optional. Saved through the pricing engine, preserving price history.">
        <div className={grid3}>
          {([
            ['askingRent', 'Asking Rent (SAR/yr)'],
            ['targetRent', 'Target Rent'],
            ['minimumRent', 'Minimum Rent'],
            ['approvedRent', 'Approved Rent'],
            ['marketRent', 'Market Rent'],
            ['serviceCharges', 'Service Charges'],
            ['depositAmount', 'Deposit'],
            ['parkingCharges', 'Parking Charges'],
            ['otherCharges', 'Other Charges'],
          ] as const).map(([name, label]) => (
            <Field key={name} label={label} htmlFor={name} error={err(name)}>
              <Input id={name} name={name} type="number" step="0.01" min="0" defaultValue={iv(name)} />
            </Field>
          ))}
        </div>
      </SectionCard>

      {/* Additional */}
      <SectionCard title="Additional Information">
        <div className="flex flex-col gap-4">
          <Field label="Description (English)" htmlFor="descriptionEn" error={err('descriptionEn')}>
            <Textarea id="descriptionEn" name="descriptionEn" rows={3} defaultValue={iv('descriptionEn')} />
          </Field>
          <Field label="Description (Arabic)" htmlFor="descriptionAr" error={err('descriptionAr')}>
            <Textarea id="descriptionAr" name="descriptionAr" rows={3} dir="rtl" defaultValue={iv('descriptionAr')} />
          </Field>
        </div>
      </SectionCard>

      {state && !state.ok && !state.fieldErrors ? (
        <p className="rounded-[var(--radius-control)] border border-[var(--color-error)] bg-[var(--color-error-soft)] px-3 py-2 text-[12.5px] text-[var(--color-error)]" role="alert">
          {state.error.message}
        </p>
      ) : null}

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)]/90 px-1 py-3 backdrop-blur">
        <Button type="button" variant="ghost" onClick={() => router.push(mode === 'edit' && unitId ? `/units/${unitId}` : '/units')} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending} disabled={pending}>
          {mode === 'edit' ? 'Save Changes' : 'Save Unit'}
        </Button>
      </div>
    </form>
  );
}

function FlagRow({
  names,
  flags,
  setFlags,
}: {
  names: readonly string[];
  flags: Record<string, boolean>;
  setFlags: (fn: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
}) {
  const items = FLAGS.filter((f) => names.includes(f.name));
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((flag) => (
        <label key={flag.name} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] px-3 py-2 text-[12.5px] text-[var(--color-text-secondary)]">
          <span>{flag.label}</span>
          <Switch
            name={flag.name}
            checked={flags[flag.name] ?? false}
            onCheckedChange={(checked) => setFlags((prev) => ({ ...prev, [flag.name]: checked === true }))}
          />
        </label>
      ))}
    </div>
  );
}
