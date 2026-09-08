'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useEffect, useActionState, type ReactNode } from 'react';
import { CircleDollarSign, FileText, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { createProposalAction, updateProposalAction, createProposalVersionAction, type ProposalActionResult } from '@/app/(app)/leasing/proposals/actions';
import type { ActionResult } from '@/lib/errors';

interface Ref { id: string; name: string }
export interface ProposalFormReference {
  customers: Array<Ref & { code: string }>;
  leads: Array<{ id: string; code: string; customerId: string }>;
  properties: Ref[];
  units: Array<{ id: string; unitNumber: string; propertyId: string; leasableArea: number | null }>;
}
export interface ProposalFormInitial { [key: string]: string | undefined }

const grid2 = 'grid grid-cols-1 gap-4 sm:grid-cols-2';
const grid3 = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3';
const PAYMENT_TERMS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semi_annual', label: 'Semi-Annual' },
  { value: 'annual', label: 'Annual' },
];

function SectionCard({ icon, title, children }: { icon?: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2">{icon ? <span className="text-[var(--color-text-tertiary)]">{icon}</span> : null}{title}</span>} />
      <CardBody className="pt-0">{children}</CardBody>
    </Card>
  );
}

export function ProposalForm({ reference, initial, mode = 'create', proposalId }: { reference: ProposalFormReference; initial?: ProposalFormInitial; mode?: 'create' | 'edit' | 'version'; proposalId?: string }) {
  const router = useRouter();
  const action = mode === 'edit' && proposalId ? updateProposalAction.bind(null, proposalId) : mode === 'version' && proposalId ? createProposalVersionAction.bind(null, proposalId) : createProposalAction;
  const [state, formAction, pending] = useActionState<ActionResult<ProposalActionResult> | null, FormData>(action, null);

  const [customerId, setCustomerId] = useState(initial?.customerId ?? '');
  const [leadId, setLeadId] = useState(initial?.leadId ?? '');
  const [propertyId, setPropertyId] = useState(initial?.propertyId ?? '');
  const [unitId, setUnitId] = useState(initial?.unitId ?? '');
  const [leasableArea, setLeasableArea] = useState(initial?.leasableArea ?? '');

  const unitOptions = useMemo(() => (propertyId ? reference.units.filter((u) => u.propertyId === propertyId) : reference.units), [reference.units, propertyId]);
  const leadOptions = useMemo(() => (customerId ? reference.leads.filter((l) => l.customerId === customerId) : reference.leads), [reference.leads, customerId]);

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const err = (n: string) => fieldErrors?.[n]?.[0];
  const iv = (n: string) => initial?.[n];

  useEffect(() => {
    if (!state) return;
    if (state.ok) { toast.success(mode === 'edit' ? 'Proposal updated.' : mode === 'version' ? 'New version created.' : 'Proposal created.'); router.push(`/leasing/proposals/${state.data.id}`); }
    else if (!state.fieldErrors) toast.error(state.error.message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function onUnitChange(v: string) {
    setUnitId(v);
    const unit = reference.units.find((u) => u.id === v);
    if (unit?.leasableArea && !leasableArea) setLeasableArea(String(unit.leasableArea));
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="unitId" value={unitId} />

      <SectionCard icon={<FileText className="size-4" />} title="Customer & Lead">
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
            <NativeSelect value={propertyId} onChange={(v) => { setPropertyId(v); setUnitId(''); }} placeholder="Select a property" options={reference.properties} invalid={!!err('propertyId')} />
          </Field>
          <Field label="Unit" required error={err('unitId')} hint={!propertyId ? 'Select a property first' : undefined}>
            <NativeSelect value={unitId} onChange={onUnitChange} placeholder="Select a unit" options={unitOptions.map((u) => ({ id: u.id, name: u.unitNumber }))} disabled={!propertyId} invalid={!!err('unitId')} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard icon={<CircleDollarSign className="size-4" />} title="Commercial Terms">
        <div className={grid3}>
          <Field label="Leasable Area (m²)" required error={err('leasableArea')}>
            <Input name="leasableArea" type="number" min="0" step="0.01" value={leasableArea} onChange={(e) => setLeasableArea(e.target.value)} aria-invalid={!!err('leasableArea')} />
          </Field>
          <Field label="Annual Rent (SAR)" required error={err('annualRent')}>
            <Input name="annualRent" type="number" min="0" step="0.01" defaultValue={iv('annualRent')} aria-invalid={!!err('annualRent')} />
          </Field>
          <Field label="Contract Duration (months)" required error={err('contractDurationMonths')}>
            <Input name="contractDurationMonths" type="number" min="1" step="1" defaultValue={iv('contractDurationMonths') ?? '12'} aria-invalid={!!err('contractDurationMonths')} />
          </Field>
          <Field label="Service Charges (SAR)" error={err('serviceCharges')}><Input name="serviceCharges" type="number" min="0" step="0.01" defaultValue={iv('serviceCharges')} /></Field>
          <Field label="Deposit (SAR)" error={err('depositAmount')}><Input name="depositAmount" type="number" min="0" step="0.01" defaultValue={iv('depositAmount')} /></Field>
          <Field label="Payment Terms" error={err('paymentTerms')}><NativeSelect name="paymentTerms" defaultValue={iv('paymentTerms') ?? 'quarterly'} options={PAYMENT_TERMS} /></Field>
          <Field label="Escalation (%)" error={err('escalationPercent')}><Input name="escalationPercent" type="number" min="0" max="100" step="0.01" defaultValue={iv('escalationPercent')} /></Field>
          <Field label="Grace Period (days)" error={err('gracePeriodDays')}><Input name="gracePeriodDays" type="number" min="0" step="1" defaultValue={iv('gracePeriodDays')} /></Field>
          <Field label="Fit-Out Period (days)" error={err('fitOutPeriodDays')}><Input name="fitOutPeriodDays" type="number" min="0" step="1" defaultValue={iv('fitOutPeriodDays')} /></Field>
          <Field label="Parking Spaces" error={err('parkingSpaces')}><Input name="parkingSpaces" type="number" min="0" step="1" defaultValue={iv('parkingSpaces')} /></Field>
          <Field label="Valid Until" error={err('validUntil')}><Input name="validUntil" type="date" defaultValue={iv('validUntil')} /></Field>
        </div>
        <p className="mt-3 text-[11px] text-[var(--color-text-tertiary)]">VAT, rent/m² and total contract value are computed from policy and the entered terms. Submitting for approval evaluates the rent against the pricing tiers (BR-004).</p>
      </SectionCard>

      <SectionCard title="Terms">
        <div className="flex flex-col gap-4">
          <Field label="Utilities Terms" htmlFor="utilitiesTerms" error={err('utilitiesTerms')}><Textarea id="utilitiesTerms" name="utilitiesTerms" rows={2} defaultValue={iv('utilitiesTerms')} /></Field>
          <Field label="Special Terms" htmlFor="specialTerms" error={err('specialTerms')}><Textarea id="specialTerms" name="specialTerms" rows={2} defaultValue={iv('specialTerms')} /></Field>
        </div>
      </SectionCard>

      {state && !state.ok && !state.fieldErrors ? (
        <p className="rounded-[var(--radius-control)] border border-[var(--color-error)] bg-[var(--color-error-soft)] px-3 py-2 text-[12.5px] text-[var(--color-error)]" role="alert">{state.error.message}</p>
      ) : null}

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)]/90 px-1 py-3 backdrop-blur">
        <Button type="button" variant="ghost" onClick={() => router.push(mode !== 'create' && proposalId ? `/leasing/proposals/${proposalId}` : '/leasing/proposals')} disabled={pending}>Cancel</Button>
        <Button type="submit" loading={pending} disabled={pending}>{mode === 'edit' ? 'Save Changes' : mode === 'version' ? 'Create Version' : 'Create Proposal'}</Button>
      </div>
    </form>
  );
}
