'use client';

import { AlertCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { useI18n } from '@/i18n/provider';
import type { ActionResult } from '@/lib/errors';
import { signInAction, type SignInPayload } from './actions';

export interface DemoAccount {
  email: string;
  name: string;
  role: string;
}

export function LoginForm({
  redirectTo,
  demoAccounts,
  demoPassword,
}: {
  redirectTo: string;
  demoAccounts: DemoAccount[];
  demoPassword: string | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult<SignInPayload> | null, FormData>(
    signInAction,
    null,
  );
  const [email, setEmail] = useState(demoAccounts[0]?.email ?? '');
  const [password, setPassword] = useState(demoPassword ?? '');

  useEffect(() => {
    if (state?.ok) {
      router.push(state.data.redirectTo);
      router.refresh();
    }
  }, [state, router]);

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const formError = state && !state.ok && !state.fieldErrors ? state.error.message : null;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="redirectTo" value={redirectTo} />

      {formError ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-[var(--radius-control)] border border-[var(--color-error-border)] bg-[var(--color-error-soft)] px-3.5 py-3"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-[var(--color-error)]" aria-hidden />
          <p className="text-[12.5px] text-[var(--color-error)]">{formError}</p>
        </div>
      ) : null}

      <Field label={t('auth.email')} htmlFor="email" required error={fieldErrors?.email?.[0]}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={Boolean(fieldErrors?.email)}
          placeholder="name@riftara.sa"
        />
      </Field>

      <Field label={t('auth.password')} htmlFor="password" required error={fieldErrors?.password?.[0]}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={Boolean(fieldErrors?.password)}
        />
      </Field>

      <Button type="submit" size="lg" loading={pending} className="mt-1 w-full">
        {pending ? t('auth.signingIn') : t('auth.signIn')}
      </Button>

      {demoAccounts.length > 0 ? (
        <div className="mt-2 rounded-[var(--radius-control)] border border-[var(--color-border-base)] bg-[var(--color-surface-muted)] p-3">
          <p className="text-[11.5px] font-semibold text-[var(--color-text-primary)]">
            {t('auth.demoAccounts')}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--color-text-secondary)]">
            {t('auth.demoAccountsHint')}
          </p>
          <div className="mt-2.5 flex flex-col gap-1">
            {demoAccounts.map((account) => (
              <button
                key={account.email}
                type="button"
                onClick={() => {
                  setEmail(account.email);
                  if (demoPassword) setPassword(demoPassword);
                }}
                className="flex items-center justify-between gap-3 rounded-[6px] px-2 py-1.5 text-start transition-colors hover:bg-[var(--color-surface-alt)]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium text-[var(--color-text-primary)]">
                    {account.name}
                  </span>
                  <span className="block truncate text-[11px] text-[var(--color-text-secondary)]">
                    {account.email}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-[var(--color-gold-100)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-gold-700)]">
                  {account.role}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </form>
  );
}
