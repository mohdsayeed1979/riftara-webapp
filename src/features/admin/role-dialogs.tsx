'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { createRoleAction, deleteRoleAction, updateRoleAction, type RoleActionResult } from '@/app/(app)/roles/actions';
import type { ActionResult } from '@/lib/errors';

export interface RoleFormInitial { [key: string]: string | undefined }

export function RoleFormDialog({ mode, roleId, initial }: { mode: 'create' | 'edit'; roleId?: string; initial?: RoleFormInitial }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const action = mode === 'edit' && roleId ? updateRoleAction.bind(null, roleId) : createRoleAction;
  const [state, formAction, pending] = useActionState<ActionResult<RoleActionResult> | null, FormData>(action, null);

  useEffect(() => {
    if (state?.ok) {
      toast.success(mode === 'edit' ? 'Role updated.' : 'Role created.');
      setOpen(false);
      if (mode === 'create' && state.data.id) router.push(`/roles/${state.data.id}`); else router.refresh();
    } else if (state && !state.ok && !state.fieldErrors) toast.error(state.error.message);
  }, [state, router, mode]);

  const fe = state && !state.ok ? state.fieldErrors : undefined;
  const iv = (n: string) => initial?.[n];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={mode === 'edit' ? 'secondary' : 'primary'} size={mode === 'edit' ? 'sm' : 'md'}>{mode === 'create' ? <Plus /> : null}{mode === 'edit' ? 'Edit' : 'Create Custom Role'}</Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader title={mode === 'edit' ? 'Edit Role' : 'Create Custom Role'} description={mode === 'create' ? 'Create a role, then assign its permissions from the role page.' : 'Update the role name and description.'} />
        <form action={formAction}>
          <DialogBody className="flex flex-col gap-4">
            {mode === 'create' ? (
              <Field label="Key" required error={fe?.key?.[0]} hint="Lowercase letters, numbers and underscores">
                <Input name="key" maxLength={64} placeholder="e.g. regional_supervisor" />
              </Field>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name (EN)" required error={fe?.nameEn?.[0]}>
                <Input name="nameEn" maxLength={120} defaultValue={iv('nameEn')} />
              </Field>
              <Field label="Name (AR)" error={fe?.nameAr?.[0]}>
                <Input name="nameAr" maxLength={120} defaultValue={iv('nameAr')} dir="rtl" />
              </Field>
            </div>
            <Field label="Description" error={fe?.description?.[0]}>
              <Textarea name="description" rows={2} defaultValue={iv('description')} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
            <Button type="submit" loading={pending}>{mode === 'edit' ? 'Save Changes' : 'Create Role'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteRoleButton({ roleId, roleName }: { roleId: string; roleName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const result = await deleteRoleAction(roleId);
      if (result.ok) { toast.success('Role deleted.'); setOpen(false); router.push('/roles'); }
      else toast.error(result.error.message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm"><Trash2 />Delete</Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader title="Delete Role" description={`Permanently delete “${roleName}”. This is only possible when no users are assigned to it.`} />
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
          <Button type="button" variant="destructive" loading={pending} onClick={submit}>Delete Role</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
