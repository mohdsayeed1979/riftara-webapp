'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useActionState, type ReactNode } from 'react';
import { ClipboardList, Target, User } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { CUSTOMER_TYPES } from '@/lib/parties/enums';
import { createLeadAction, updateLeadAction, type LeadActionResult } from '@/app/(app)/leasing/leads/actions';

interface Ref {
  id: string;
  name: string;
}
export interface LeadFormReference {
  openStages: Array<Ref & { key: string }>;
  sources: Ref[];
  agents: Ref[];
  properties: Ref[];
  unitTypes: Ref[];
  units: Array<{ id: string; unitNumber: string; propertyId: string }>;
  customers: Array<Ref & { code: string }>;
}
export interface LeadFormInitial {
  [key: string]: string | undefined;
}

const grid3 = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3';
const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

function SectionCard({ icon, title, description, children }: { icon?: ReactNode; title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2">{icon ? <span className="text-[var(--color-text-tertiary)]">{icon}</span> : null}{title}</span>} description={description} />
      <CardBody className="pt-0">{children}</CardBody>
    </Card>
  );
}

export function LeadForm({
  reference,
  initial,
  mode = 'create',
  leadId,
  presetCustomerId,
}: {
  reference: LeadFormReference;
  initial?: LeadFormInitial;
  mode?: 'create' | 'edit';
  leadId?: string;
  presetCustomerId?: string;
}) {
  const router = useRouter();
  const action = mode === 'edit' && leadId ? updateLeadAction.bind(null, leadId) : createLeadAction;
  const [state, formAction, pending] = useActionState<LeadActionResult | null, FormData>(action, null);

  const [customerMode, setCustomerMode] = useState<'existing' | 'new'>(presetCustomerId ? 'existing' : 'existing');
  const [customerId, setCustomerId] = useState(presetCustomerId ?? '');
  const [customerType, setCustomerType] = useState('individual');
  const [propertyId, setPropertyId] = useState(initial?.requestedPropertyId ?? '');
  const [requestedUnitId, setRequestedUnitId] = useState(initial?.requestedUnitId ?? '');
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [dupDismissed, setDupDismissed] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const unitOptions = useMemo(() => (propertyId ? reference.units.filter((u) => u.propertyId === propertyId) : reference.units), [reference.units, propertyId]);

  const duplicates = state && !state.ok && 'duplicates' in state ? state.duplicates : undefined;
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const err = (n: string) => fieldErrors?.[n]?.[0];
  const iv = (n: string) => initial?.[n];

  useEffect(() => {
    if (!state) return;
    setDupDismissed(false);
    if (state.ok) {
      toast.success(mode === 'edit' ? 'Lead updated.' : 'Lead created.');
      router.push(`/leasing/leads/${state.data.id}`);
    } else if (!duplicates && !state.fieldErrors) {
      toast.error(state.error.message);
    }
    setPendingConfirm(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    if (pendingConfirm) formRef.current?.requestSubmit();
  }, [pendingConfirm]);

  const isCorporate = customerType === 'corporate';

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="confirmed" value={pendingConfirm ? 'true' : ''} readOnly />

      {mode === 'create' ? (
        <SectionCard icon={<User className="size-4" />} title="Customer" description="A lead is always linked to a customer.">
          <input type="hidden" name="customerMode" value={customerMode} />
          <div className="mb-3 inline-flex rounded-[var(--radius-control)] border border-[var(--color-border-base)] p-0.5 text-[12.5px]">
            {(['existing', 'new'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setCustomerMode(m)}
                className={`rounded-[6px] px-3 py-1 font-medium ${customerMode === m ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-secondary)]'}`}
              >
                {m === 'existing' ? 'Existing customer' : 'New customer'}
              </button>
            ))}
          </div>

          {customerMode === 'existing' ? (
            <div className="flex items-end gap-2">
              <Field label="Customer" required error={err('customerId')} className="flex-1">
                <NativeSelect name="customerId" value={customerId} onChange={setCustomerId} placeholder="Select a customer" options={reference.customers.map((c) => ({ id: c.id, name: `${c.name} · ${c.code}` }))} invalid={!!err('customerId')} />
              </Field>
              <Button variant="secondary" size="sm" asChild><Link href="/leasing/customers/new">New</Link></Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className={grid3}>
                <Field label="Type" error={err('customerType')}>
                  <NativeSelect name="customerType" value={customerType} onChange={setCustomerType} options={CUSTOMER_TYPES} />
                </Field>
                <Field label={isCorporate ? 'Legal / Contact Name' : 'Full Name'} required error={err('fullNameEn')}>
                  <Input name="fullNameEn" maxLength={200} aria-invalid={!!err('fullNameEn')} />
                </Field>
                {isCorporate ? (
                  <Field label="Company Name" error={err('companyName')}>
                    <Input name="companyName" maxLength={200} />
                  </Field>
                ) : null}
              </div>
              <div className={grid3}>
                <Field label="Mobile" error={err('mobile')} hint="Used for duplicate detection"><Input name="mobile" maxLength={32} /></Field>
                <Field label="Email" error={err('email')} hint="Used for duplicate detection"><Input name="email" type="email" maxLength={160} /></Field>
                {isCorporate ? (
                  <Field label="Commercial Registration" error={err('commercialRegistration')}><Input name="commercialRegistration" maxLength={40} /></Field>
                ) : (
                  <Field label="National ID / Iqama" error={err('nationalId')}><Input name="nationalId" maxLength={64} /></Field>
                )}
              </div>
            </div>
          )}
        </SectionCard>
      ) : null}

      {/* Lead details */}
      <SectionCard icon={<ClipboardList className="size-4" />} title="Lead Details">
        <div className={grid3}>
          {mode === 'create' ? (
            <Field label="Stage" error={err('stageId')} hint="Defaults to the first open stage">
              <NativeSelect name="stageId" defaultValue={iv('stageId')} placeholder="First open stage" options={reference.openStages} />
            </Field>
          ) : null}
          <Field label="Source" error={err('sourceId')}>
            <NativeSelect name="sourceId" defaultValue={iv('sourceId')} placeholder="Unknown" options={reference.sources} />
          </Field>
          <Field label="Assigned Agent" error={err('assignedUserId')}>
            <NativeSelect name="assignedUserId" defaultValue={iv('assignedUserId')} placeholder="Unassigned" options={reference.agents} />
          </Field>
          <Field label="Priority" error={err('priority')}>
            <NativeSelect name="priority" defaultValue={iv('priority') ?? 'medium'} options={PRIORITIES} />
          </Field>
        </div>
      </SectionCard>

      {/* Requirements */}
      <SectionCard icon={<Target className="size-4" />} title="Requirements">
        <div className="flex flex-col gap-4">
          <div className={grid3}>
            <Field label="Requested Property" error={err('requestedPropertyId')}>
              <NativeSelect name="requestedPropertyId" value={propertyId} onChange={(v) => { setPropertyId(v); if (requestedUnitId && !reference.units.some((u) => u.id === requestedUnitId && u.propertyId === v)) setRequestedUnitId(''); }} placeholder="Any property" options={reference.properties} />
            </Field>
            <Field label="Requested Unit" error={err('requestedUnitId')} hint={!propertyId ? 'Optional' : undefined}>
              <NativeSelect name="requestedUnitId" value={requestedUnitId} onChange={setRequestedUnitId} placeholder="Any unit" options={unitOptions.map((u) => ({ id: u.id, name: u.unitNumber }))} />
            </Field>
            <Field label="Requested Unit Type" error={err('requestedUnitTypeId')}>
              <NativeSelect name="requestedUnitTypeId" defaultValue={iv('requestedUnitTypeId')} placeholder="Any type" options={reference.unitTypes} />
            </Field>
            <Field label="Required Area (m²)" error={err('requiredArea')}>
              <Input name="requiredArea" type="number" min="0" step="0.01" defaultValue={iv('requiredArea')} />
            </Field>
            <Field label="Budget Min (SAR/yr)" error={err('budgetMin')}>
              <Input name="budgetMin" type="number" min="0" step="0.01" defaultValue={iv('budgetMin')} />
            </Field>
            <Field label="Budget Max (SAR/yr)" error={err('budgetMax')}>
              <Input name="budgetMax" type="number" min="0" step="0.01" defaultValue={iv('budgetMax')} />
            </Field>
            <Field label="Expected Move-in" htmlFor="moveInDate" error={err('moveInDate')}>
              <Input id="moveInDate" name="moveInDate" type="date" defaultValue={iv('moveInDate')} />
            </Field>
          </div>
        </div>
      </SectionCard>

      {/* Follow-up */}
      <SectionCard title="Follow-up & Notes">
        <div className="flex flex-col gap-4">
          <Field label="Next Action" htmlFor="nextAction" error={err('nextAction')}>
            <Input id="nextAction" name="nextAction" maxLength={200} defaultValue={iv('nextAction')} placeholder="e.g. Call to schedule a viewing" />
          </Field>
          <Field label="Notes" htmlFor="notes" error={err('notes')}>
            <Textarea id="notes" name="notes" rows={3} defaultValue={iv('notes')} />
          </Field>
        </div>
      </SectionCard>

      {state && !state.ok && !duplicates && !state.fieldErrors ? (
        <p className="rounded-[var(--radius-control)] border border-[var(--color-error)] bg-[var(--color-error-soft)] px-3 py-2 text-[12.5px] text-[var(--color-error)]" role="alert">{state.error.message}</p>
      ) : null}

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)]/90 px-1 py-3 backdrop-blur">
        <Button type="button" variant="ghost" onClick={() => router.push(mode === 'edit' && leadId ? `/leasing/leads/${leadId}` : '/leasing')} disabled={pending}>Cancel</Button>
        <Button type="submit" loading={pending} disabled={pending}>{mode === 'edit' ? 'Save Changes' : 'Create Lead'}</Button>
      </div>

      <Dialog open={!!duplicates && !dupDismissed} onOpenChange={(open) => { if (!open) setDupDismissed(true); }}>
        <DialogContent size="sm">
          <DialogHeader title="Possible existing customer found" description="One or more identifiers match an existing customer. Use the existing customer or create anyway." />
          <DialogBody className="flex flex-col gap-2">
            {(duplicates ?? []).map((d) => (
              <div key={d.customerId} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">{d.name}</p>
                  <p className="text-[11.5px] text-[var(--color-text-tertiary)]">{d.code} · matched on {d.matchedOn.replace(/_/g, ' ')}</p>
                </div>
                <Button size="sm" variant="secondary" asChild><Link href={`/leasing/customers/${d.customerId}`}>View</Link></Button>
              </div>
            ))}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDupDismissed(true)}>Go back</Button>
            <Button type="button" onClick={() => setPendingConfirm(true)} loading={pending}>Create anyway</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
