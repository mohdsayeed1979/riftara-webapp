'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { KeyRound, Power, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { adminResetPasswordAction, setUserActiveAction, setUserRolesAction } from '@/app/(app)/users/actions';
import type { AssignableRoleOption } from './user-form-dialog';

/** Manage the target user's role set (atomic replace, escalation-guarded). */
export function ManageRolesButton({
  userId,
  roles,
  currentRoleIds,
}: {
  userId: string;
  roles: AssignableRoleOption[];
  currentRoleIds: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(currentRoleIds));
  const [pending, start] = useTransition();

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function save() {
    start(async () => {
      const result = await setUserRolesAction(userId, Array.from(selected));
      if (result.ok) { toast.success('Roles updated.'); setOpen(false); router.refresh(); }
      else toast.error(result.error.message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm"><ShieldCheck />Roles</Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader title="Manage Roles" description="Assign or remove roles. You can only grant roles within your own permissions." />
        <DialogBody>
          <div className="flex flex-col gap-1.5">
            {roles.map((role) => {
              const checked = selected.has(role.id);
              const locked = !role.assignable && !checked;
              return (
                <label key={role.id} className={`flex items-center gap-2 text-[13px] ${locked ? 'opacity-50' : ''}`}>
                  <input type="checkbox" checked={checked} disabled={locked} onChange={() => toggle(role.id)} />
                  {role.name}
                  {role.isSystem ? <span className="text-[10px] text-[var(--color-text-tertiary)]">system</span> : null}
                  {locked ? <span className="text-[10px] text-[var(--color-text-tertiary)]">— not assignable</span> : null}
                </label>
              );
            })}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
          <Button type="button" loading={pending} onClick={save}>Save Roles</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Administrator password reset: forces a change and revokes all sessions. */
export function ResetPasswordButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const result = await adminResetPasswordAction(userId, password);
      if (result.ok) { toast.success('Password reset. The user must change it at next sign-in; sessions revoked.'); setOpen(false); setPassword(''); router.refresh(); }
      else toast.error(result.error.message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setPassword(''); }}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm"><KeyRound />Reset Password</Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader title="Reset Password" description="Sets a temporary password, forces a change at next sign-in and signs the user out everywhere." />
        <DialogBody>
          <Field label="Temporary Password" hint="Min 12 chars incl. upper, lower, digit and symbol">
            <Input type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
          <Button type="button" loading={pending} onClick={submit} disabled={!password}>Reset Password</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Activate / deactivate with confirmation. Deactivation revokes sessions. */
export function StatusToggleButton({ userId, isActive, isSelf }: { userId: string; isActive: boolean; isSelf: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const result = await setUserActiveAction(userId, !isActive);
      if (result.ok) { toast.success(isActive ? 'User deactivated.' : 'User activated.'); setOpen(false); router.refresh(); }
      else toast.error(result.error.message);
    });
  }

  if (isActive && isSelf) return null; // cannot deactivate self

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={isActive ? 'secondary' : 'primary'} size="sm"><Power />{isActive ? 'Deactivate' : 'Activate'}</Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader
          title={isActive ? 'Deactivate User' : 'Activate User'}
          description={isActive ? 'The user will be signed out of all sessions and unable to sign in until reactivated.' : 'The user will be able to sign in again with their existing password and roles.'}
        />
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
          <Button type="button" variant={isActive ? 'destructive' : 'primary'} loading={pending} onClick={submit}>{isActive ? 'Deactivate' : 'Activate'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
