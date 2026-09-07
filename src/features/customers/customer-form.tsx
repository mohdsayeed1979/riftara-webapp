'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useRef, useState, useActionState, type ReactNode } from 'react';
import { Building2, IdCard, Mail, User } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';
import { NativeSelect } from '@/components/ui/native-select';
import { CUSTOMER_PRIORITIES, CUSTOMER_TYPES } from '@/lib/parties/enums';
import {
  createCustomerAction,
  updateCustomerAction,
  type CustomerActionResult,
} from '@/app/(app)/leasing/customers/actions';

export interface CustomerFormInitial {
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

export function CustomerForm({
  mode,
  customerId,
  initial,
}: {
  mode: 'create' | 'edit';
  customerId?: string;
  initial?: CustomerFormInitial;
}) {
  const router = useRouter();
  const action = mode === 'edit' && customerId ? updateCustomerAction.bind(null, customerId) : createCustomerAction;
  const [state, formAction, pending] = useActionState<CustomerActionResult | null, FormData>(action, null);

  const [customerType, setCustomerType] = useState((initial?.customerType as string) ?? 'individual');
  const [consents, setConsents] = useState<Record<string, boolean>>({
    marketingConsent: initial?.marketingConsent === true,
    communicationConsent: initial?.communicationConsent !== false, // default true
  });
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [dupDismissed, setDupDismissed] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const isCorporate = customerType === 'corporate';
  const duplicates = state && !state.ok && 'duplicates' in state ? state.duplicates : undefined;
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const err = (n: string) => fieldErrors?.[n]?.[0];
  const iv = (n: string) => (typeof initial?.[n] === 'string' ? (initial[n] as string) : undefined);

  useEffect(() => {
    if (!state) return;
    setDupDismissed(false);
    if (state.ok) {
      toast.success(mode === 'edit' ? 'Customer updated.' : 'Customer created.');
      router.push(`/leasing/customers/${state.data.id}`);
    } else if (!duplicates && !state.fieldErrors) {
      toast.error(state.error.message);
    }
    setPendingConfirm(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    if (pendingConfirm) formRef.current?.requestSubmit();
  }, [pendingConfirm]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="confirmed" value={pendingConfirm ? 'true' : ''} readOnly />

      {/* 1. Customer Type / Identity */}
      <SectionCard icon={<User className="size-4" />} title="Customer Type & Identity">
        <div className={grid3}>
          <Field label="Customer Type" required error={err('customerType')}>
            <NativeSelect name="customerType" value={customerType} onChange={setCustomerType} options={CUSTOMER_TYPES} invalid={!!err('customerType')} />
          </Field>
          <Field label="Priority" error={err('priority')}>
            <NativeSelect name="priority" defaultValue={iv('priority') ?? 'medium'} options={CUSTOMER_PRIORITIES} />
          </Field>
        </div>
      </SectionCard>

      {/* 2. Personal or Company Information */}
      {isCorporate ? (
        <SectionCard icon={<Building2 className="size-4" />} title="Company Information">
          <div className="flex flex-col gap-4">
            <div className={grid2}>
              <Field label="Company Name" required error={err('companyName')}>
                <Input name="companyName" defaultValue={iv('companyName')} maxLength={200} aria-invalid={!!err('companyName')} />
              </Field>
              <Field label="Company Name (Arabic)" error={err('fullNameAr')}>
                <Input name="fullNameAr" defaultValue={iv('fullNameAr')} dir="rtl" maxLength={200} />
              </Field>
            </div>
            <div className={grid3}>
              <Field label="Legal / Contact Name" required error={err('fullNameEn')} hint="Primary contact or legal name">
                <Input name="fullNameEn" defaultValue={iv('fullNameEn')} maxLength={200} aria-invalid={!!err('fullNameEn')} />
              </Field>
              <Field label="Authorized Representative" error={err('authorizedRepresentative')}>
                <Input name="authorizedRepresentative" defaultValue={iv('authorizedRepresentative')} maxLength={160} />
              </Field>
              <Field label="Business Activity" error={err('businessActivity')}>
                <Input name="businessActivity" defaultValue={iv('businessActivity')} maxLength={160} />
              </Field>
              <Field label="Unified National Number" error={err('unifiedNumber')}>
                <Input name="unifiedNumber" defaultValue={iv('unifiedNumber')} maxLength={40} />
              </Field>
              <Field label="VAT Number" error={err('vatNumber')}>
                <Input name="vatNumber" defaultValue={iv('vatNumber')} maxLength={40} />
              </Field>
            </div>
          </div>
        </SectionCard>
      ) : (
        <SectionCard icon={<User className="size-4" />} title="Personal Information">
          <div className={grid3}>
            <Field label="Full Name (English)" required error={err('fullNameEn')}>
              <Input name="fullNameEn" defaultValue={iv('fullNameEn')} maxLength={200} aria-invalid={!!err('fullNameEn')} />
            </Field>
            <Field label="Full Name (Arabic)" error={err('fullNameAr')}>
              <Input name="fullNameAr" defaultValue={iv('fullNameAr')} dir="rtl" maxLength={200} />
            </Field>
            <Field label="Nationality" error={err('nationality')}>
              <Input name="nationality" defaultValue={iv('nationality')} maxLength={64} />
            </Field>
            <Field label="Employer" error={err('employer')}>
              <Input name="employer" defaultValue={iv('employer')} maxLength={160} />
            </Field>
            <Field label="Monthly Income (SAR)" error={err('monthlyIncome')}>
              <Input name="monthlyIncome" type="number" min="0" step="0.01" defaultValue={iv('monthlyIncome')} />
            </Field>
          </div>
        </SectionCard>
      )}

      {/* 3. Contact Information */}
      <SectionCard icon={<Mail className="size-4" />} title="Contact Information">
        <div className={grid3}>
          <Field label="Mobile" error={err('mobile')} hint="Used for duplicate detection">
            <Input name="mobile" defaultValue={iv('mobile')} maxLength={32} placeholder="+9665XXXXXXXX" />
          </Field>
          <Field label="Alternate Mobile" error={err('alternateMobile')}>
            <Input name="alternateMobile" defaultValue={iv('alternateMobile')} maxLength={32} />
          </Field>
          <Field label="Email" error={err('email')} hint="Used for duplicate detection">
            <Input name="email" type="email" defaultValue={iv('email')} maxLength={160} aria-invalid={!!err('email')} />
          </Field>
        </div>
      </SectionCard>

      {/* 4. Identification */}
      <SectionCard icon={<IdCard className="size-4" />} title="Identification" description="Used for duplicate detection (BR-007). Each identifier is unique per organization.">
        {isCorporate ? (
          <div className={grid2}>
            <Field label="Commercial Registration" error={err('commercialRegistration')}>
              <Input name="commercialRegistration" defaultValue={iv('commercialRegistration')} maxLength={40} />
            </Field>
            <Field label="CR Expiry" error={err('commercialRegistrationExpiry')}>
              <Input name="commercialRegistrationExpiry" type="date" defaultValue={iv('commercialRegistrationExpiry')} />
            </Field>
          </div>
        ) : (
          <div className={grid2}>
            <Field label="National ID" error={err('nationalId')}>
              <Input name="nationalId" defaultValue={iv('nationalId')} maxLength={64} />
            </Field>
            <Field label="National ID Expiry" error={err('nationalIdExpiry')}>
              <Input name="nationalIdExpiry" type="date" defaultValue={iv('nationalIdExpiry')} />
            </Field>
            <Field label="Iqama" error={err('iqama')}>
              <Input name="iqama" defaultValue={iv('iqama')} maxLength={64} />
            </Field>
            <Field label="Iqama Expiry" error={err('iqamaExpiry')}>
              <Input name="iqamaExpiry" type="date" defaultValue={iv('iqamaExpiry')} />
            </Field>
          </div>
        )}
      </SectionCard>

      {/* 5. Address */}
      <SectionCard title="Address">
        <Field label="Address" htmlFor="addressLine" error={err('addressLine')}>
          <Textarea id="addressLine" name="addressLine" rows={2} defaultValue={iv('addressLine')} />
        </Field>
      </SectionCard>

      {/* 6. Preferences & Consent */}
      <SectionCard title="Leasing Preferences & Consent">
        <div className="flex flex-col gap-4">
          <Field label="Tags" htmlFor="tags" error={err('tags')} hint="Comma-separated">
            <Input id="tags" name="tags" defaultValue={iv('tags')} placeholder="VIP, Repeat, Broker" />
          </Field>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] px-3 py-2 text-[12.5px] text-[var(--color-text-secondary)]">
              <span>Marketing consent</span>
              <Switch name="marketingConsent" checked={consents.marketingConsent} onCheckedChange={(c) => setConsents((p) => ({ ...p, marketingConsent: c === true }))} />
            </label>
            <label className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] px-3 py-2 text-[12.5px] text-[var(--color-text-secondary)]">
              <span>Communication consent</span>
              <Switch name="communicationConsent" checked={consents.communicationConsent} onCheckedChange={(c) => setConsents((p) => ({ ...p, communicationConsent: c === true }))} />
            </label>
          </div>
        </div>
      </SectionCard>

      {/* 7. Additional */}
      <SectionCard title="Additional Information">
        <Field label="Notes" htmlFor="notes" error={err('notes')}>
          <Textarea id="notes" name="notes" rows={3} defaultValue={iv('notes')} />
        </Field>
      </SectionCard>

      {state && !state.ok && !duplicates && !state.fieldErrors ? (
        <p className="rounded-[var(--radius-control)] border border-[var(--color-error)] bg-[var(--color-error-soft)] px-3 py-2 text-[12.5px] text-[var(--color-error)]" role="alert">
          {state.error.message}
        </p>
      ) : null}

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)]/90 px-1 py-3 backdrop-blur">
        <Button type="button" variant="ghost" onClick={() => router.push(mode === 'edit' && customerId ? `/leasing/customers/${customerId}` : '/leasing/customers')} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending} disabled={pending}>
          {mode === 'edit' ? 'Save Changes' : 'Save Customer'}
        </Button>
      </div>

      {/* Duplicate warning */}
      <Dialog open={!!duplicates && !dupDismissed} onOpenChange={(open) => { if (!open) setDupDismissed(true); }}>
        <DialogContent size="sm">
          <DialogHeader title="Possible existing customer found" description="One or more identifiers match an existing customer. Open it instead of creating a duplicate." />
          <DialogBody className="flex flex-col gap-2">
            {(duplicates ?? []).map((d) => (
              <div key={d.customerId} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">{d.name}</p>
                  <p className="text-[11.5px] text-[var(--color-text-tertiary)]">{d.code} · matched on {d.matchedOn.replace(/_/g, ' ')}</p>
                </div>
                <Button size="sm" variant="secondary" asChild>
                  <Link href={`/leasing/customers/${d.customerId}`}>View</Link>
                </Button>
              </div>
            ))}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDupDismissed(true)}>Go back</Button>
            <Button type="button" onClick={() => setPendingConfirm(true)} loading={pending}>
              Create anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
