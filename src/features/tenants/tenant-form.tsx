'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useActionState, type ReactNode } from 'react';
import { Briefcase, User } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { TENANT_STATUSES } from '@/lib/parties/enums';
import { createTenantAction, updateTenantAction, type TenantActionResult } from '@/app/(app)/tenants/actions';
import type { ActionResult } from '@/lib/errors';

interface RefItem {
  id: string;
  name: string;
}

export interface TenantFormInitial {
  [key: string]: string | undefined;
}

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

const grid2 = 'grid grid-cols-1 gap-4 sm:grid-cols-2';
const grid3 = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3';

export function TenantForm({
  mode,
  tenantId,
  customers,
  managers,
  initial,
  lockedCustomerName,
}: {
  mode: 'create' | 'edit';
  tenantId?: string;
  customers: Array<RefItem & { code: string }>;
  managers: RefItem[];
  initial?: TenantFormInitial;
  lockedCustomerName?: string;
}) {
  const router = useRouter();
  const action = mode === 'edit' && tenantId ? updateTenantAction.bind(null, tenantId) : createTenantAction;
  const [state, formAction, pending] = useActionState<ActionResult<TenantActionResult> | null, FormData>(action, null);

  const [customerId, setCustomerId] = useState(initial?.customerId ?? '');
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [displayTouched, setDisplayTouched] = useState(Boolean(initial?.displayName));

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const err = (n: string) => fieldErrors?.[n]?.[0];
  const iv = (n: string) => initial?.[n];

  function onCustomerChange(value: string) {
    setCustomerId(value);
    if (!displayTouched) {
      const c = customers.find((x) => x.id === value);
      if (c) setDisplayName(c.name);
    }
  }

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(mode === 'edit' ? 'Tenant updated.' : 'Tenant created.');
      router.push(`/tenants/${state.data.id}`);
    } else if (!state.fieldErrors) {
      toast.error(state.error.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {/* Customer */}
      <SectionCard icon={<User className="size-4" />} title="Customer" description="A tenant is a customer's leasing account. Select an existing customer.">
        {mode === 'edit' ? (
          <>
            <input type="hidden" name="customerId" value={customerId} />
            <Field label="Customer">
              <Input value={lockedCustomerName ?? ''} disabled readOnly />
            </Field>
          </>
        ) : (
          <Field label="Customer" required error={err('customerId')} hint="Can't find them? Create the customer first.">
            <NativeSelect
              name="customerId"
              value={customerId}
              onChange={onCustomerChange}
              placeholder="Select a customer"
              options={customers.map((c) => ({ id: c.id, name: `${c.name} · ${c.code}` }))}
              invalid={!!err('customerId')}
            />
          </Field>
        )}
      </SectionCard>

      {/* Leasing / Occupancy Information */}
      <SectionCard icon={<Briefcase className="size-4" />} title="Leasing Account Information">
        <div className="flex flex-col gap-4">
          <div className={grid2}>
            <Field label="Display Name" required error={err('displayName')}>
              <Input
                name="displayName"
                value={displayName}
                onChange={(e) => { setDisplayName(e.target.value); setDisplayTouched(true); }}
                maxLength={200}
                aria-invalid={!!err('displayName')}
              />
            </Field>
            <Field label="Display Name (Arabic)" error={err('displayNameAr')}>
              <Input name="displayNameAr" defaultValue={iv('displayNameAr')} dir="rtl" maxLength={200} />
            </Field>
          </div>
          <div className={grid3}>
            <Field label="Industry" error={err('industry')}>
              <Input name="industry" defaultValue={iv('industry')} maxLength={120} />
            </Field>
            <Field label="Account Manager" error={err('accountManagerId')}>
              <NativeSelect name="accountManagerId" defaultValue={iv('accountManagerId')} placeholder="Unassigned" options={managers} />
            </Field>
            <Field label="Credit Rating" error={err('creditRating')} hint="e.g. A / B / C">
              <Input name="creditRating" defaultValue={iv('creditRating')} maxLength={16} />
            </Field>
          </div>
        </div>
      </SectionCard>

      {/* Status & Dates */}
      <SectionCard title="Status & Dates">
        <div className={grid2}>
          <Field label="Tenant Status" required error={err('status')}>
            <NativeSelect name="status" defaultValue={iv('status') ?? 'prospective'} options={TENANT_STATUSES} invalid={!!err('status')} />
          </Field>
          <Field label="Onboarded Date" htmlFor="onboardedAt" error={err('onboardedAt')}>
            <Input id="onboardedAt" name="onboardedAt" type="date" defaultValue={iv('onboardedAt')} />
          </Field>
        </div>
        <p className="mt-3 text-[11.5px] text-[var(--color-text-tertiary)]">
          Property, unit and move-in/move-out are set when a contract is created for this tenant.
        </p>
      </SectionCard>

      {/* Notes */}
      <SectionCard title="Notes">
        <Field label="Notes" htmlFor="notes" error={err('notes')}>
          <Textarea id="notes" name="notes" rows={3} defaultValue={iv('notes')} />
        </Field>
      </SectionCard>

      {state && !state.ok && !state.fieldErrors ? (
        <p className="rounded-[var(--radius-control)] border border-[var(--color-error)] bg-[var(--color-error-soft)] px-3 py-2 text-[12.5px] text-[var(--color-error)]" role="alert">
          {state.error.message}
        </p>
      ) : null}

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)]/90 px-1 py-3 backdrop-blur">
        <Button type="button" variant="ghost" onClick={() => router.push(mode === 'edit' && tenantId ? `/tenants/${tenantId}` : '/tenants')} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending} disabled={pending}>
          {mode === 'edit' ? 'Save Changes' : 'Save Tenant'}
        </Button>
      </div>
    </form>
  );
}
