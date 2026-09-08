'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useActionState } from 'react';
import { Building2, Loader2, MapPin, ShieldCheck, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import {
  IDENTIFICATION_TYPES,
  OWNER_TYPES,
  OWNERSHIP_DOCUMENT_TYPES,
  PROPERTY_CONDITIONS,
  PROPERTY_STATUSES,
  PROPERTY_USAGES,
  type Option,
} from '@/lib/properties/enums';
import { createPropertyAction, type CreatePropertyResult } from '@/app/(app)/properties/actions';
import type { ActionResult } from '@/lib/errors';

interface RefItem {
  id: string;
  name: string;
}
interface CityItem extends RefItem {
  regionId: string | null;
}
interface DistrictItem extends RefItem {
  cityId: string;
}

export interface PropertyFormReference {
  regions: RefItem[];
  cities: CityItem[];
  districts: DistrictItem[];
  portfolios: RefItem[];
  types: RefItem[];
  managers: RefItem[];
}

const controlClass =
  'h-9.5 w-full rounded-[var(--radius-control)] border border-[var(--color-border-base)] bg-[var(--color-surface)] px-3 text-[13.5px] text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-strong)] focus:border-[var(--color-gold-400)] focus:outline-none focus:ring-2 focus:ring-[var(--color-gold-200)] aria-[invalid=true]:border-[var(--color-error)]';

/** Styled native <select> — submits reliably via `name` and stays consistent
 *  with the design system controls. */
function NativeSelect({
  name,
  value,
  defaultValue,
  onChange,
  placeholder,
  options,
  invalid,
}: {
  name: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  options: readonly Option[] | RefItem[];
  invalid?: boolean;
}) {
  const normalized: Option[] = options.map((o) =>
    'value' in o ? { value: o.value, label: o.label } : { value: o.id, label: o.name },
  );
  return (
    <select
      name={name}
      value={value}
      defaultValue={defaultValue}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      aria-invalid={invalid || undefined}
      className={cn(controlClass, 'appearance-none bg-[right_0.6rem_center] bg-no-repeat pe-8')}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239a9a9a' stroke-width='2'><path d='M6 9l6 6 6-6'/></svg>\")",
      }}
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {normalized.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function SectionCard({
  icon,
  title,
  description,
  children,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            {icon ? <span className="text-[var(--color-text-tertiary)]">{icon}</span> : null}
            {title}
          </span>
        }
        description={description}
      />
      <CardBody className="pt-0">{children}</CardBody>
    </Card>
  );
}

const grid2 = 'grid grid-cols-1 gap-4 sm:grid-cols-2';
const grid3 = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3';

const FACILITIES = [
  { name: 'fireFightingSystem', label: 'Fire Fighting System' },
  { name: 'fireAlarmSystem', label: 'Fire Alarm System' },
  { name: 'generator', label: 'Generator' },
  { name: 'buildingManagementSystem', label: 'Building Management System' },
  { name: 'cctv', label: 'CCTV' },
  { name: 'accessControl', label: 'Access Control' },
  { name: 'loadingFacilities', label: 'Loading Facilities' },
  { name: 'emergencySystems', label: 'Emergency Systems' },
] as const;

export function PropertyForm({
  reference,
  suggestedCode,
  propertyId,
  initial,
}: {
  reference: PropertyFormReference;
  suggestedCode: string;
  propertyId?: string;
  initial?: Record<string, string | boolean | null | undefined>;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState<ActionResult<CreatePropertyResult> | null, FormData>(
    createPropertyAction,
    null,
  );

  // Controlled geography for the Region -> City -> District hierarchy.
  const [regionId, setRegionId] = useState(initial?.regionId as string ?? '');
  const [cityId, setCityId] = useState(initial?.cityId as string ?? '');
  const [districtId, setDistrictId] = useState(initial?.districtId as string ?? '');
  const [facilities, setFacilities] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(FACILITIES.map((facility) => [facility.name, initial?.[facility.name] === true])),
  );
  const [formKey, setFormKey] = useState(0);
  const [mode, setMode] = useState<'save' | 'again'>('save');
  const formRef = useRef<HTMLFormElement>(null);

  const cityOptions = useMemo(
    () => (regionId ? reference.cities.filter((c) => c.regionId === regionId) : reference.cities),
    [reference.cities, regionId],
  );
  const districtOptions = useMemo(
    () => (cityId ? reference.districts.filter((d) => d.cityId === cityId) : []),
    [reference.districts, cityId],
  );

  function onRegionChange(value: string) {
    setRegionId(value);
    // Reset the city if it no longer belongs to the chosen region.
    if (cityId) {
      const stillValid = reference.cities.some((c) => c.id === cityId && (!value || c.regionId === value));
      if (!stillValid) {
        setCityId('');
        setDistrictId('');
      }
    }
  }
  function onCityChange(value: string) {
    setCityId(value);
    if (districtId) {
      const stillValid = reference.districts.some((d) => d.id === districtId && d.cityId === value);
      if (!stillValid) setDistrictId('');
    }
  }

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const err = (name: string) => fieldErrors?.[name]?.[0];

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      if (mode === 'again') {
        toast.success('Property created. Add another.');
        // Reset the form for the next entry.
        setRegionId('');
        setCityId('');
        setDistrictId('');
        setFacilities({});
        setFormKey((k) => k + 1);
        if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        toast.success(propertyId ? t('properties.saved') : 'Property created.');
        router.push(`/properties/${state.data.id}`);
      }
    } else if (!state.fieldErrors) {
      toast.error(state.error.message);
    } else {
      toast.error(state.error.message);
    }
    // Runs only when the action result changes; `mode` is committed on click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // The create and edit screens share one form. Populate ordinary controls
  // from the server-scoped property record without making every field stateful.
  useEffect(() => {
    if (!initial || !formRef.current) return;
    for (const [name, value] of Object.entries(initial)) {
      if (typeof value !== 'string') continue;
      const control = formRef.current.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
      if (control) control.value = value;
    }
  }, [initial]);

  return (
    <form ref={formRef} key={formKey} action={formAction} className="flex flex-col gap-5">
      {propertyId ? <input type="hidden" name="propertyId" value={propertyId} /> : null}
      {/* A. Basic Information */}
      <SectionCard icon={<Building2 className="size-4" />} title="Basic Information" description="Core identity of the property.">
        <div className="flex flex-col gap-4">
          <div className={grid3}>
            <Field label="Property Code" htmlFor="code" required error={err('code')} hint="Unique per organization">
              <Input id="code" name="code" defaultValue={suggestedCode} maxLength={32} aria-invalid={!!err('code')} />
            </Field>
            <Field label="Property Name (English)" htmlFor="nameEn" required error={err('nameEn')} className="sm:col-span-2 lg:col-span-2">
              <Input id="nameEn" name="nameEn" placeholder="e.g. Al Olaya Tower" maxLength={200} aria-invalid={!!err('nameEn')} />
            </Field>
          </div>
          <div className={grid3}>
            <Field label="Property Name (Arabic)" htmlFor="nameAr" error={err('nameAr')}>
              <Input id="nameAr" name="nameAr" dir="rtl" maxLength={200} />
            </Field>
            <Field label="Property Type" required error={err('propertyTypeId')}>
              <NativeSelect name="propertyTypeId" placeholder="Select a type" options={reference.types} invalid={!!err('propertyTypeId')} />
            </Field>
            <Field label="Portfolio" error={err('portfolioId')} hint="Optional grouping">
              <NativeSelect name="portfolioId" placeholder="No portfolio" options={reference.portfolios} />
            </Field>
          </div>
          <div className={grid2}>
            <Field label="Usage" required error={err('usage')}>
              <NativeSelect name="usage" defaultValue="commercial" options={PROPERTY_USAGES} invalid={!!err('usage')} />
            </Field>
            <Field label="Status" required error={err('status')}>
              <NativeSelect name="status" defaultValue="active" options={PROPERTY_STATUSES} invalid={!!err('status')} />
            </Field>
          </div>
        </div>
      </SectionCard>

      {/* B. Location & Geography */}
      <SectionCard icon={<MapPin className="size-4" />} title="Location & Geography" description="Region, city and district must follow the hierarchy.">
        <div className="flex flex-col gap-4">
          <div className={grid3}>
            <Field label="Region" error={err('regionId')}>
              <NativeSelect name="regionId" value={regionId} onChange={onRegionChange} placeholder="Select a region" options={reference.regions} />
            </Field>
            <Field label="City" required error={err('cityId')} hint={regionId ? 'Filtered by region' : undefined}>
              <NativeSelect name="cityId" value={cityId} onChange={onCityChange} placeholder="Select a city" options={cityOptions} invalid={!!err('cityId')} />
            </Field>
            <Field
              label="District"
              error={err('districtId')}
              hint={!cityId ? 'Select a city first' : districtOptions.length === 0 ? 'No districts for this city' : undefined}
            >
              <NativeSelect
                name="districtId"
                value={districtId}
                onChange={setDistrictId}
                placeholder="Select a district"
                options={districtOptions}
              />
            </Field>
          </div>
          <Field label="Address" htmlFor="addressLine" error={err('addressLine')}>
            <Textarea id="addressLine" name="addressLine" rows={2} placeholder="Street, building, additional directions" />
          </Field>
          <div className={grid3}>
            <Field label="National Address" htmlFor="nationalAddress" error={err('nationalAddress')} hint="Saudi National Address (e.g. RRRD2929)">
              <Input id="nationalAddress" name="nationalAddress" maxLength={64} />
            </Field>
            <Field label="Latitude" htmlFor="latitude" error={err('latitude')}>
              <Input id="latitude" name="latitude" type="number" step="any" placeholder="24.7136" />
            </Field>
            <Field label="Longitude" htmlFor="longitude" error={err('longitude')}>
              <Input id="longitude" name="longitude" type="number" step="any" placeholder="46.6753" />
            </Field>
          </div>
          <div className={grid2}>
            <Field label="Google Maps Reference" htmlFor="googleMapsReference" error={err('googleMapsReference')}>
              <Input id="googleMapsReference" name="googleMapsReference" placeholder="Maps URL or plus code" />
            </Field>
            <Field label="Cost Center" htmlFor="costCenter" error={err('costCenter')}>
              <Input id="costCenter" name="costCenter" maxLength={48} />
            </Field>
          </div>
        </div>
      </SectionCard>

      {/* C. Management & Organization */}
      <SectionCard title="Management & Organization" description="Assign responsible managers and key dates.">
        <div className="flex flex-col gap-4">
          <div className={grid3}>
            <Field label="Property Manager" error={err('propertyManagerId')}>
              <NativeSelect name="propertyManagerId" placeholder="Unassigned" options={reference.managers} />
            </Field>
            <Field label="Leasing Manager" error={err('leasingManagerId')}>
              <NativeSelect name="leasingManagerId" placeholder="Unassigned" options={reference.managers} />
            </Field>
            <Field label="Asset Manager" error={err('assetManagerId')}>
              <NativeSelect name="assetManagerId" placeholder="Unassigned" options={reference.managers} />
            </Field>
          </div>
          <div className={grid2}>
            <Field label="Acquisition Date" htmlFor="acquisitionDate" error={err('acquisitionDate')}>
              <Input id="acquisitionDate" name="acquisitionDate" type="date" />
            </Field>
            <Field label="Operational Start Date" htmlFor="operationalStartDate" error={err('operationalStartDate')}>
              <Input id="operationalStartDate" name="operationalStartDate" type="date" />
            </Field>
          </div>
        </div>
      </SectionCard>

      {/* D. Ownership Information */}
      {!propertyId ? <SectionCard icon={<ShieldCheck className="size-4" />} title="Ownership Information" description="Optional — records the first owner and title document (Ejar-aligned).">
        <div className="flex flex-col gap-4">
          <div className={grid3}>
            <Field label="Owner Name" htmlFor="ownerName" error={err('ownerName')} hint="Fill to create an ownership record">
              <Input id="ownerName" name="ownerName" maxLength={200} />
            </Field>
            <Field label="Owner Type" error={err('ownerType')}>
              <NativeSelect name="ownerType" defaultValue="individual" options={OWNER_TYPES} />
            </Field>
            <Field label="Ownership %" htmlFor="ownershipPercentage" error={err('ownershipPercentage')}>
              <Input id="ownershipPercentage" name="ownershipPercentage" type="number" step="0.01" min="0" max="100" placeholder="100" />
            </Field>
          </div>
          <div className={grid3}>
            <Field label="Document Type" error={err('ownershipDocumentType')}>
              <NativeSelect name="ownershipDocumentType" defaultValue="title_deed" options={OWNERSHIP_DOCUMENT_TYPES} />
            </Field>
            <Field label="Document Number" htmlFor="ownershipDocumentNumber" error={err('ownershipDocumentNumber')} hint="Required when an owner is set">
              <Input id="ownershipDocumentNumber" name="ownershipDocumentNumber" maxLength={64} aria-invalid={!!err('ownershipDocumentNumber')} />
            </Field>
            <Field label="Document Date" htmlFor="ownershipDocumentDate" error={err('ownershipDocumentDate')}>
              <Input id="ownershipDocumentDate" name="ownershipDocumentDate" type="date" />
            </Field>
          </div>
          <div className={grid3}>
            <Field label="Issuing Authority" htmlFor="issuingAuthority" error={err('issuingAuthority')}>
              <Input id="issuingAuthority" name="issuingAuthority" maxLength={160} placeholder="Ministry of Justice" />
            </Field>
            <Field label="Identification Type" error={err('identificationType')}>
              <NativeSelect name="identificationType" placeholder="Select" options={IDENTIFICATION_TYPES} />
            </Field>
            <Field label="Identification Number" htmlFor="identificationNumber" error={err('identificationNumber')}>
              <Input id="identificationNumber" name="identificationNumber" maxLength={64} />
            </Field>
          </div>
          <div className={grid3}>
            <Field label="Commercial Registration" htmlFor="commercialRegistration" error={err('commercialRegistration')}>
              <Input id="commercialRegistration" name="commercialRegistration" maxLength={40} />
            </Field>
            <Field label="Authorized Representative" htmlFor="authorizedRepresentative" error={err('authorizedRepresentative')}>
              <Input id="authorizedRepresentative" name="authorizedRepresentative" maxLength={160} />
            </Field>
          </div>
          <Field label="Ownership Notes" htmlFor="ownershipNotes" error={err('ownershipNotes')}>
            <Textarea id="ownershipNotes" name="ownershipNotes" rows={2} />
          </Field>
        </div>
      </SectionCard> : null}

      {/* E. Property Technical Information */}
      <SectionCard icon={<Wrench className="size-4" />} title="Property Technical Information" description="Areas, structure and building systems (BRD 9).">
        <div className="flex flex-col gap-4">
          <div className={grid3}>
            <Field label="Land Area (m²)" htmlFor="landArea" error={err('landArea')}>
              <Input id="landArea" name="landArea" type="number" step="0.01" min="0" />
            </Field>
            <Field label="Built-Up Area (m²)" htmlFor="builtUpArea" error={err('builtUpArea')}>
              <Input id="builtUpArea" name="builtUpArea" type="number" step="0.01" min="0" />
            </Field>
            <Field label="Gross Leasable Area (m²)" htmlFor="grossLeasableArea" error={err('grossLeasableArea')}>
              <Input id="grossLeasableArea" name="grossLeasableArea" type="number" step="0.01" min="0" />
            </Field>
            <Field label="Net Leasable Area (m²)" htmlFor="netLeasableArea" error={err('netLeasableArea')}>
              <Input id="netLeasableArea" name="netLeasableArea" type="number" step="0.01" min="0" />
            </Field>
            <Field label="Common Area (m²)" htmlFor="commonArea" error={err('commonArea')}>
              <Input id="commonArea" name="commonArea" type="number" step="0.01" min="0" />
            </Field>
            <Field label="Parking Area (m²)" htmlFor="parkingArea" error={err('parkingArea')}>
              <Input id="parkingArea" name="parkingArea" type="number" step="0.01" min="0" />
            </Field>
          </div>
          <div className={grid3}>
            <Field label="Number of Buildings" htmlFor="buildingCount" error={err('buildingCount')}>
              <Input id="buildingCount" name="buildingCount" type="number" min="0" step="1" defaultValue="0" />
            </Field>
            <Field label="Number of Floors" htmlFor="floorCount" error={err('floorCount')}>
              <Input id="floorCount" name="floorCount" type="number" min="0" step="1" defaultValue="0" />
            </Field>
            <Field label="Number of Units" htmlFor="unitCount" error={err('unitCount')} hint="Declared count">
              <Input id="unitCount" name="unitCount" type="number" min="0" step="1" defaultValue="0" />
            </Field>
            <Field label="Construction Year" htmlFor="constructionYear" error={err('constructionYear')}>
              <Input id="constructionYear" name="constructionYear" type="number" min="1300" max="2200" step="1" />
            </Field>
            <Field label="Renovation Year" htmlFor="renovationYear" error={err('renovationYear')}>
              <Input id="renovationYear" name="renovationYear" type="number" min="1300" max="2200" step="1" />
            </Field>
            <Field label="Property Condition" error={err('condition')}>
              <NativeSelect name="condition" placeholder="Select" options={PROPERTY_CONDITIONS} />
            </Field>
          </div>
          <div className={grid3}>
            <Field label="Parking Capacity" htmlFor="parkingCapacity" error={err('parkingCapacity')}>
              <Input id="parkingCapacity" name="parkingCapacity" type="number" min="0" step="1" />
            </Field>
            <Field label="Number of Elevators" htmlFor="elevatorCount" error={err('elevatorCount')}>
              <Input id="elevatorCount" name="elevatorCount" type="number" min="0" step="1" />
            </Field>
            <Field label="HVAC Type" htmlFor="hvacType" error={err('hvacType')}>
              <Input id="hvacType" name="hvacType" maxLength={64} placeholder="Central / Split / VRF" />
            </Field>
            <Field label="Electrical Capacity" htmlFor="electricalCapacity" error={err('electricalCapacity')}>
              <Input id="electricalCapacity" name="electricalCapacity" maxLength={64} placeholder="e.g. 1500 kVA" />
            </Field>
            <Field label="Water Infrastructure" htmlFor="waterInfrastructure" error={err('waterInfrastructure')}>
              <Input id="waterInfrastructure" name="waterInfrastructure" maxLength={64} />
            </Field>
          </div>

          <div>
            <p className="mb-2 text-[12.5px] font-medium text-[var(--color-text-secondary)]">Building Systems & Facilities</p>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {FACILITIES.map((facility) => (
                <label
                  key={facility.name}
                  className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] px-3 py-2 text-[12.5px] text-[var(--color-text-secondary)]"
                >
                  <span>{facility.label}</span>
                  <Switch
                    name={facility.name}
                    checked={facilities[facility.name] ?? false}
                    onCheckedChange={(checked) =>
                      setFacilities((prev) => ({ ...prev, [facility.name]: checked === true }))
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
      </SectionCard>

      {/* F. Ejar-Aligned / Additional Information */}
      <SectionCard title="Additional Information" description="Descriptions and notes.">
        <div className="flex flex-col gap-4">
          <Field label="Description (English)" htmlFor="descriptionEn" error={err('descriptionEn')}>
            <Textarea id="descriptionEn" name="descriptionEn" rows={3} />
          </Field>
          <Field label="Description (Arabic)" htmlFor="descriptionAr" error={err('descriptionAr')}>
            <Textarea id="descriptionAr" name="descriptionAr" rows={3} dir="rtl" />
          </Field>
        </div>
      </SectionCard>

      {state && !state.ok && !state.fieldErrors ? (
        <p className="rounded-[var(--radius-control)] border border-[var(--color-error)] bg-[var(--color-error-soft)] px-3 py-2 text-[12.5px] text-[var(--color-error)]" role="alert">
          {state.error.message}
        </p>
      ) : null}

      {/* Sticky action bar */}
      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)]/90 px-1 py-3 backdrop-blur">
        <Button type="button" variant="ghost" onClick={() => router.push('/properties')} disabled={pending}>
          Cancel
        </Button>
        {!propertyId ? <Button
          type="submit"
          variant="secondary"
          loading={pending && mode === 'again'}
          disabled={pending}
          onClick={() => {
            setMode('again');
          }}
        >
          Save &amp; Add Another
        </Button> : null}
        <Button
          type="submit"
          loading={pending && mode === 'save'}
          disabled={pending}
          onClick={() => {
            setMode('save');
          }}
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {propertyId ? t('properties.saveChanges') : 'Save Property'}
        </Button>
      </div>
    </form>
  );
}
