'use client';

import { ShieldCheck, ShieldOff } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { useTranslations } from '@/i18n/provider';
import {
  activateMfaAction,
  beginEnrollmentAction,
  disableMfaAction,
  regenerateRecoveryCodesAction,
} from '@/app/(app)/account/actions';
import type { EnrollmentChallenge, MfaStatus } from '@/services/mfa-service';

type Mode = 'idle' | 'enroll' | 'recovery' | 'disable' | 'regenerate';

export function MfaPanel({ initialStatus }: { initialStatus: MfaStatus }) {
  const t = useTranslations();
  const [status, setStatus] = useState<MfaStatus>(initialStatus);
  const [mode, setMode] = useState<Mode>('idle');
  const [pending, startTransition] = useTransition();
  const [challenge, setChallenge] = useState<EnrollmentChallenge | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  function reset() {
    setMode('idle');
    setCode('');
    setChallenge(null);
  }

  function startEnroll() {
    startTransition(async () => {
      const result = await beginEnrollmentAction();
      if (result.ok) {
        setChallenge(result.data);
        setCode('');
        setMode('enroll');
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function confirmEnroll() {
    startTransition(async () => {
      const result = await activateMfaAction(code);
      if (result.ok) {
        setRecoveryCodes(result.data.recoveryCodes);
        setStatus({ enrolled: true, activated: true, recoveryCodesRemaining: result.data.recoveryCodes.length });
        setMode('recovery');
        setCode('');
        toast.success(t('mfa.enabledToast'));
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function confirmDisable() {
    startTransition(async () => {
      const result = await disableMfaAction(code);
      if (result.ok) {
        setStatus({ enrolled: false, activated: false, recoveryCodesRemaining: 0 });
        reset();
        toast.success(t('mfa.disabledToast'));
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function confirmRegenerate() {
    startTransition(async () => {
      const result = await regenerateRecoveryCodesAction(code);
      if (result.ok) {
        setRecoveryCodes(result.data.recoveryCodes);
        setStatus((s) => ({ ...s, recoveryCodesRemaining: result.data.recoveryCodes.length }));
        setMode('recovery');
        setCode('');
        toast.success(t('mfa.regeneratedToast'));
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {status.activated ? (
          <Badge tone="success" dot><ShieldCheck className="size-3.5" aria-hidden /> {t('mfa.statusOn')}</Badge>
        ) : (
          <Badge tone="neutral" dot><ShieldOff className="size-3.5" aria-hidden /> {t('mfa.statusOff')}</Badge>
        )}
        {status.activated ? (
          <span className="text-[12px] text-[var(--color-text-tertiary)]">
            {t('mfa.codesRemaining', { count: status.recoveryCodesRemaining })}
          </span>
        ) : null}
      </div>

      <p className="text-[12.5px] text-[var(--color-text-secondary)]">{t('mfa.description')}</p>

      <div className="flex flex-wrap gap-2">
        {!status.activated ? (
          <Button size="sm" onClick={startEnroll} loading={pending && mode === 'idle'}>
            {t('mfa.enable')}
          </Button>
        ) : (
          <>
            <Button size="sm" variant="secondary" onClick={() => { setCode(''); setMode('regenerate'); }}>
              {t('mfa.regenerate')}
            </Button>
            <Button size="sm" variant="destructive" onClick={() => { setCode(''); setMode('disable'); }}>
              {t('mfa.disable')}
            </Button>
          </>
        )}
      </div>

      {/* Enrollment: QR + manual key + verify */}
      <Dialog open={mode === 'enroll'} onOpenChange={(o) => !o && reset()}>
        <DialogContent size="md">
          <DialogHeader title={t('mfa.scanTitle')} description={t('mfa.scanInstruction')} />
          <DialogBody className="flex flex-col gap-4">
            {challenge ? (
              <>
                <div
                  className="mx-auto w-[200px] rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-white p-2"
                  // The SVG is generated server-side from the otpauth URI; safe, static markup.
                  dangerouslySetInnerHTML={{ __html: challenge.qrSvg }}
                />
                <div>
                  <p className="text-[12px] text-[var(--color-text-secondary)]">{t('mfa.manualKey')}</p>
                  <code className="mt-1 block break-all rounded-[var(--radius-control)] bg-[var(--color-surface-muted)] px-3 py-2 text-[13px] tracking-wider text-[var(--color-text-primary)]">
                    {challenge.manualKey}
                  </code>
                </div>
                <Field label={t('mfa.code')} htmlFor="mfa-code" hint={t('mfa.verifyInstruction')}>
                  <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" value={code} placeholder="000000" onChange={(e) => setCode(e.target.value)} />
                </Field>
              </>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={reset}>{t('mfa.cancel')}</Button>
            <Button size="sm" onClick={confirmEnroll} loading={pending} disabled={code.trim().length < 6}>
              {t('mfa.verifyEnable')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recovery codes display (once) */}
      <Dialog open={mode === 'recovery'} onOpenChange={(o) => !o && reset()}>
        <DialogContent size="sm">
          <DialogHeader title={t('mfa.recoveryTitle')} description={t('mfa.recoveryIntro')} />
          <DialogBody>
            <ul className="grid grid-cols-2 gap-2">
              {recoveryCodes.map((rc) => (
                <li key={rc} className="rounded-[var(--radius-control)] bg-[var(--color-surface-muted)] px-3 py-2 text-center text-[13px] font-medium tracking-wider text-[var(--color-text-primary)]">
                  {rc}
                </li>
              ))}
            </ul>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button size="sm" onClick={reset}>{t('mfa.recoveryDone')}</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disable */}
      <Dialog open={mode === 'disable'} onOpenChange={(o) => !o && reset()}>
        <DialogContent size="sm">
          <DialogHeader title={t('mfa.disableTitle')} description={t('mfa.disablePrompt')} />
          <DialogBody>
            <Field label={t('mfa.code')} htmlFor="mfa-disable-code">
              <Input id="mfa-disable-code" autoComplete="one-time-code" value={code} placeholder="000000" onChange={(e) => setCode(e.target.value)} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={reset}>{t('mfa.cancel')}</Button>
            <Button variant="destructive" size="sm" onClick={confirmDisable} loading={pending} disabled={!code.trim()}>
              {t('mfa.confirmDisable')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Regenerate recovery codes */}
      <Dialog open={mode === 'regenerate'} onOpenChange={(o) => !o && reset()}>
        <DialogContent size="sm">
          <DialogHeader title={t('mfa.regenerateTitle')} description={t('mfa.regeneratePrompt')} />
          <DialogBody>
            <Field label={t('mfa.code')} htmlFor="mfa-regen-code">
              <Input id="mfa-regen-code" inputMode="numeric" autoComplete="one-time-code" value={code} placeholder="000000" onChange={(e) => setCode(e.target.value)} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={reset}>{t('mfa.cancel')}</Button>
            <Button size="sm" onClick={confirmRegenerate} loading={pending} disabled={code.trim().length < 6}>
              {t('mfa.confirmRegenerate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
