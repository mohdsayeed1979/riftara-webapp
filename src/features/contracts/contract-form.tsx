'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useActionState, type ReactNode } from 'react';
import { Building2, CalendarRange, CircleDollarSign, FileText, MapPin, User } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/status-badge';
import { NativeSelect } from '@/components/ui/native-select';
import { createContractAction, updateContractAction, getUnitContractInfoAction, type ContractActionResult, type UnitContractInfo } from '@/app/(app)/contracts/actions';
import type { ActionResult } from '@/lib/errors';

interface TenantRef {
  id: string;
  displayName: string;
  status: string;
  customerId: string;
  customerName: string;
  mobile: string | null;
  email: string | null;
  customerType: string;
}
export interface ContractFormReference {
  properties: Array<{ id: string; name: string }>;
  buildings: Array<{ id: string; name: string; propertyId: string }>;
  floors: Array<{ id: string; name: string; buildingId: string; level: number }>;
  units: Array<{ id: string; unitNumber: string; code: string; propertyId: string; buildingId: string | null; floorId: string | null; availabilityClass: string }>;
  tenants: TenantRef[];
  lessorName: string;
}
export interface ContractFormInitial {
  tenantId?: string;
  propertyId?: string;
  buildingId?: string;
  floorId?: string;
  unitId?: string;
  reservationId?: string;
  annualRent?: string;
  paymentFrequency?: string;
  startDate?: string;
  endDate?: string;
  serviceCharges?: string;
  depositAmount?: string;
  escalationPercent?: string;
  gracePeriodDays?: string;
  fitOutPeriodDays?: string;
  specialConditions?: string;
  lessorName?: string;
}

const grid2 = 'grid grid-cols-1 gap-4 sm:grid-cols-2';
const grid3 = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3';
const FREQUENCIES = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semi_annual', label: 'Semi-Annual' },
  { value: 'annual', label: 'Annual' },
];

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

function monthsBetween(start: string, end: string): number {
  if (!start || !end) return 0;
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) return 0;
  return (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth()) + 1;
}

export function ContractForm({
  reference,
  initial,
  mode = 'create',
  contractId,
}: {
  reference: ContractFormReference;
  initial?: ContractFormInitial;
  mode?: 'create' | 'edit';
  contractId?: string;
}) {
  const router = useRouter();
  const action = mode === 'edit' && contractId ? updateContractAction.bind(null, contractId) : createContractAction;
  const [state, formAction, pending] = useActionState<ActionResult<ContractActionResult> | null, FormData>(action, null);

  const [tenantId, setTenantId] = useState(initial?.tenantId ?? '');
  const [propertyId, setPropertyId] = useState(initial?.propertyId ?? '');
  const [buildingId, setBuildingId] = useState(initial?.buildingId ?? '');
  const [floorId, setFloorId] = useState(initial?.floorId ?? '');
  const [unitId, setUnitId] = useState(initial?.unitId ?? '');
  const [unitInfo, setUnitInfo] = useState<UnitContractInfo | null>(null);
  const [annualRent, setAnnualRent] = useState(initial?.annualRent ?? '');
  const [frequency, setFrequency] = useState(initial?.paymentFrequency ?? 'quarterly');
  const [startDate, setStartDate] = useState(initial?.startDate ?? '');
  const [endDate, setEndDate] = useState(initial?.endDate ?? '');

  const buildingOptions = useMemo(() => (propertyId ? reference.buildings.filter((b) => b.propertyId === propertyId) : []), [reference.buildings, propertyId]);
  const floorOptions = useMemo(() => (buildingId ? reference.floors.filter((f) => f.buildingId === buildingId) : []), [reference.floors, buildingId]);
  const unitOptions = useMemo(
    () =>
      reference.units.filter(
        (u) => u.propertyId === propertyId && (!buildingId || u.buildingId === buildingId) && (!floorId || u.floorId === floorId),
      ),
    [reference.units, propertyId, buildingId, floorId],
  );

  const selectedTenant = reference.tenants.find((t) => t.id === tenantId);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const err = (n: string) => fieldErrors?.[n]?.[0];

  useEffect(() => {
    if (!unitId) { setUnitInfo(null); return; }
    let active = true;
    void getUnitContractInfoAction(unitId).then((info) => {
      if (!active) return;
      setUnitInfo(info);
      if (info && !annualRent && info.askingRent > 0) setAnnualRent(String(info.askingRent));
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitId]);

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(mode === 'edit' ? 'Contract updated.' : 'Contract draft created.');
      router.push(`/contracts/${state.data.id}`);
    } else if (!state.fieldErrors) {
      toast.error(state.error.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function onPropertyChange(value: string) {
    setPropertyId(value);
    setBuildingId('');
    setFloorId('');
    setUnitId('');
  }
  function onBuildingChange(value: string) {
    setBuildingId(value);
    setFloorId('');
    if (unitId && !reference.units.some((u) => u.id === unitId && (!value || u.buildingId === value))) setUnitId('');
  }
  function onFloorChange(value: string) {
    setFloorId(value);
    if (unitId && value && !reference.units.some((u) => u.id === unitId && u.floorId === value)) setUnitId('');
  }

  const durationMonths = monthsBetween(startDate, endDate);
  const preview = useMemo(() => buildPreview(Number(annualRent) || 0, durationMonths, frequency), [annualRent, durationMonths, frequency]);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="unitId" value={unitId} />
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="tenantId" value={tenantId} />
      {initial?.reservationId ? <input type="hidden" name="reservationId" value={initial.reservationId} /> : null}

      {/* Tenant */}
      <SectionCard icon={<User className="size-4" />} title="Tenant" description="The contract attaches to an existing tenant.">
        {reference.tenants.length === 0 ? (
          <div className="flex flex-col items-start gap-2 rounded-[var(--radius-control)] border border-dashed border-[var(--color-border-strong)] p-4">
            <p className="text-[12.5px] text-[var(--color-text-secondary)]">No tenants exist yet. Create a tenant first.</p>
            <Button variant="secondary" size="sm" asChild><Link href="/tenants/new">Create Tenant</Link></Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Field label="Tenant" required error={err('tenantId')}>
              <NativeSelect
                value={tenantId}
                onChange={setTenantId}
                placeholder="Select a tenant"
                options={reference.tenants.map((t) => ({ id: t.id, name: `${t.displayName} · ${t.customerName}` }))}
                invalid={!!err('tenantId')}
              />
            </Field>
            {selectedTenant ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)] px-3 py-2 text-[12px] text-[var(--color-text-secondary)]">
                <span>
                  <span className="font-medium text-[var(--color-text-primary)]">{selectedTenant.customerName}</span>
                  {selectedTenant.mobile ? ` · ${selectedTenant.mobile}` : ''}{selectedTenant.email ? ` · ${selectedTenant.email}` : ''} ·{' '}
                  <span className="capitalize">{selectedTenant.customerType}</span> · <StatusBadge status={selectedTenant.status} size="sm" />
                </span>
                <Button variant="ghost" size="sm" asChild><Link href={`/leasing/customers/${selectedTenant.customerId}`}>View Customer</Link></Button>
              </div>
            ) : null}
          </div>
        )}
      </SectionCard>

      {/* Property / Building / Floor / Unit */}
      <SectionCard icon={<MapPin className="size-4" />} title="Property / Building / Unit" description="Pick the leased unit. Building and floor narrow the unit list.">
        <div className={grid2}>
          <Field label="Property" required error={err('propertyId')}>
            <NativeSelect value={propertyId} onChange={onPropertyChange} placeholder="Select a property" options={reference.properties} invalid={!!err('propertyId')} />
          </Field>
          <Field label="Building" hint={!propertyId ? 'Select a property first' : buildingOptions.length === 0 ? 'No buildings' : undefined}>
            <NativeSelect value={buildingId} onChange={onBuildingChange} placeholder="Any building" options={buildingOptions} disabled={!propertyId} />
          </Field>
          <Field label="Floor" hint={!buildingId ? 'Select a building first' : floorOptions.length === 0 ? 'No floors' : undefined}>
            <NativeSelect value={floorId} onChange={onFloorChange} placeholder="Any floor" options={floorOptions.map((f) => ({ id: f.id, name: `${f.name} (L${f.level})` }))} disabled={!buildingId} />
          </Field>
          <Field label="Unit" required error={err('unitId')} hint={!propertyId ? 'Select a property first' : undefined}>
            <NativeSelect
              value={unitId}
              onChange={setUnitId}
              placeholder="Select a unit"
              options={unitOptions.map((u) => ({ id: u.id, name: `${u.unitNumber} · ${u.code}` }))}
              disabled={!propertyId}
              invalid={!!err('unitId')}
            />
          </Field>
        </div>

        {unitInfo ? (
          <div className="mt-4 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">Unit {unitInfo.unitNumber}</span>
              <StatusBadge status={unitInfo.statusKey} label={unitInfo.statusLabel} size="sm" />
              <StatusBadge status={unitInfo.availabilityClass} size="sm" />
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] text-[var(--color-text-secondary)] sm:grid-cols-4">
              <span>{unitInfo.propertyName}</span>
              <span>{unitInfo.buildingName ?? '—'}{unitInfo.floorName ? ` · ${unitInfo.floorName}` : ''}</span>
              <span className="capitalize">{unitInfo.typeName} · {unitInfo.usageType}</span>
              <span>{unitInfo.leasableArea} m² · Asking {unitInfo.askingRent.toLocaleString()}</span>
            </div>
            {unitInfo.availabilityClass === 'leased' ? (
              <p className="mt-2 text-[11.5px] text-[var(--color-error)]">
                This unit is currently leased. Creating a contract will be blocked if the period overlaps an active contract (BR-003).
              </p>
            ) : null}
          </div>
        ) : null}
      </SectionCard>

      {/* Lessor */}
      <SectionCard title="Lessor">
        <Field label="Lessor Name" htmlFor="lessorName" error={err('lessorName')}>
          <Input id="lessorName" name="lessorName" defaultValue={initial?.lessorName ?? reference.lessorName} maxLength={200} />
        </Field>
      </SectionCard>

      {/* Period */}
      <SectionCard icon={<CalendarRange className="size-4" />} title="Contract Period">
        <div className={grid3}>
          <Field label="Start Date" required error={err('startDate')}>
            <Input name="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-invalid={!!err('startDate')} />
          </Field>
          <Field label="End Date" required error={err('endDate')}>
            <Input name="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} aria-invalid={!!err('endDate')} />
          </Field>
          <Field label="Duration" hint="Calculated">
            <Input value={durationMonths ? `${durationMonths} months` : '—'} disabled readOnly />
          </Field>
        </div>
      </SectionCard>

      {/* Financial + Payment terms */}
      <SectionCard icon={<CircleDollarSign className="size-4" />} title="Financial & Payment Terms">
        <div className={grid3}>
          <Field label="Annual Rent (SAR)" required error={err('annualRent')}>
            <Input name="annualRent" type="number" min="0" step="0.01" value={annualRent} onChange={(e) => setAnnualRent(e.target.value)} aria-invalid={!!err('annualRent')} />
          </Field>
          <Field label="Payment Frequency" required error={err('paymentFrequency')}>
            <NativeSelect name="paymentFrequency" value={frequency} onChange={setFrequency} options={FREQUENCIES} invalid={!!err('paymentFrequency')} />
          </Field>
          <Field label="Deposit (SAR)" error={err('depositAmount')} hint="Defaults to 25% of annual rent">
            <Input name="depositAmount" type="number" min="0" step="0.01" defaultValue={initial?.depositAmount} />
          </Field>
          <Field label="Service Charges (SAR)" error={err('serviceCharges')}>
            <Input name="serviceCharges" type="number" min="0" step="0.01" defaultValue={initial?.serviceCharges} />
          </Field>
          <Field label="Escalation (%)" error={err('escalationPercent')}>
            <Input name="escalationPercent" type="number" min="0" max="100" step="0.01" defaultValue={initial?.escalationPercent} />
          </Field>
          <Field label="Grace Period (days)" error={err('gracePeriodDays')}>
            <Input name="gracePeriodDays" type="number" min="0" step="1" defaultValue={initial?.gracePeriodDays} />
          </Field>
          <Field label="Fit-Out Period (days)" error={err('fitOutPeriodDays')}>
            <Input name="fitOutPeriodDays" type="number" min="0" step="1" defaultValue={initial?.fitOutPeriodDays} />
          </Field>
        </div>
        <p className="mt-3 text-[11px] text-[var(--color-text-tertiary)]">
          VAT and rent/m² are applied from organization policy and unit area when the schedule is generated. Utilities, parking,
          discounts and incentives are managed on unit pricing, not the contract.
        </p>
      </SectionCard>

      {/* Payment schedule preview */}
      {preview.length > 0 ? (
        <SectionCard title="Payment Schedule Preview" description="Estimated instalments — the final schedule and invoices are generated on signing.">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {preview.map((p) => (
              <div key={p.label} className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] px-3 py-2 text-[12px]">
                <span className="block text-[var(--color-text-tertiary)]">{p.label}</span>
                <span className="font-medium text-[var(--color-text-primary)]">SAR {p.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}

      {/* Special conditions */}
      <SectionCard icon={<FileText className="size-4" />} title="Special Conditions">
        <Field label="Special Conditions" htmlFor="specialConditions" error={err('specialConditions')}>
          <Textarea id="specialConditions" name="specialConditions" rows={3} defaultValue={initial?.specialConditions} />
        </Field>
      </SectionCard>

      {/* Ejar */}
      <SectionCard icon={<Building2 className="size-4" />} title="Ejar Information">
        <p className="text-[12px] text-[var(--color-text-secondary)]">
          Ejar registration status is tracked on the contract record. The Ejar integration activates once government API
          credentials are configured — it is currently <span className="font-medium">not connected</span>, so contracts are created
          with Ejar status “not submitted”.
        </p>
      </SectionCard>

      {state && !state.ok && !state.fieldErrors ? (
        <p className="rounded-[var(--radius-control)] border border-[var(--color-error)] bg-[var(--color-error-soft)] px-3 py-2 text-[12.5px] text-[var(--color-error)]" role="alert">
          {state.error.message}
        </p>
      ) : null}

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)]/90 px-1 py-3 backdrop-blur">
        <Button type="button" variant="ghost" onClick={() => router.push(mode === 'edit' && contractId ? `/contracts/${contractId}` : '/contracts')} disabled={pending}>Cancel</Button>
        <Button type="submit" loading={pending} disabled={pending}>{mode === 'edit' ? 'Save Changes' : 'Create Draft Contract'}</Button>
      </div>
    </form>
  );
}

function buildPreview(annualRent: number, durationMonths: number, frequency: string): Array<{ label: string; amount: number }> {
  if (annualRent <= 0 || durationMonths <= 0) return [];
  const perYear = frequency === 'monthly' ? 12 : frequency === 'quarterly' ? 4 : frequency === 'semi_annual' ? 2 : 1;
  const monthsPer = 12 / perYear;
  const count = Math.max(1, Math.ceil(durationMonths / monthsPer));
  const totalRent = (annualRent * durationMonths) / 12;
  const each = totalRent / count;
  return Array.from({ length: Math.min(count, 12) }, (_, i) => ({ label: `Instalment ${i + 1}`, amount: each }));
}
