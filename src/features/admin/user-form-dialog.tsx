'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { createUserAction, updateUserAction, type UserActionResult } from '@/app/(app)/users/actions';
import { useTranslations } from '@/i18n/provider';
import type { ActionResult } from '@/lib/errors';

export interface AssignableRoleOption { id: string; name: string; key: string; isSystem: boolean; assignable: boolean }
export interface UserFormInitial { [key: string]: string | undefined }

const LOCALES = [{ id: 'en', name: 'English' }, { id: 'ar', name: 'العربية' }];

/** Create or edit a user. Create includes a temporary password + role selection;
 *  edit changes profile fields only (roles, password and status are separate,
 *  independently-authorized actions). */
export function UserFormDialog({
  mode,
  userId,
  initial,
  roles = [],
  triggerLabel,
  triggerVariant = 'primary',
}: {
  mode: 'create' | 'edit';
  userId?: string;
  initial?: UserFormInitial;
  roles?: AssignableRoleOption[];
  triggerLabel?: string;
  triggerVariant?: 'primary' | 'secondary';
}) {
  const router = useRouter();
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const action = mode === 'edit' && userId ? updateUserAction.bind(null, userId) : createUserAction;
  const [state, formAction, pending] = useActionState<ActionResult<UserActionResult> | null, FormData>(action, null);

  useEffect(() => {
    if (state?.ok) { toast.success(mode === 'edit' ? t('users.userUpdated') : t('users.userCreated')); setOpen(false); router.refresh(); }
    else if (state && !state.ok && !state.fieldErrors) toast.error(state.error.message);
  }, [state, router, mode, t]);

  const fe = state && !state.ok ? state.fieldErrors : undefined;
  const iv = (n: string) => initial?.[n];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size={mode === 'edit' ? 'sm' : 'md'}>{mode === 'create' ? <Plus /> : null}{triggerLabel ?? (mode === 'edit' ? t('common.edit') : t('users.createUser'))}</Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader
          title={mode === 'edit' ? t('users.editUser') : t('users.createUser')}
          description={mode === 'edit' ? t('users.editUserDesc') : t('users.createUserDesc')}
        />
        <form action={formAction}>
          <DialogBody className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('users.fullName')} required error={fe?.fullName?.[0]}>
                <Input name="fullName" maxLength={160} defaultValue={iv('fullName')} />
              </Field>
              <Field label={t('users.fullNameAr')} error={fe?.fullNameAr?.[0]}>
                <Input name="fullNameAr" maxLength={160} defaultValue={iv('fullNameAr')} dir="rtl" />
              </Field>
            </div>
            <Field label={t('users.email')} required error={fe?.email?.[0]}>
              <Input name="email" type="email" maxLength={160} defaultValue={iv('email')} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('users.jobTitle')} error={fe?.jobTitle?.[0]}>
                <Input name="jobTitle" maxLength={120} defaultValue={iv('jobTitle')} />
              </Field>
              <Field label={t('users.phone')} error={fe?.phone?.[0]}>
                <Input name="phone" maxLength={32} defaultValue={iv('phone')} />
              </Field>
            </div>
            <Field label={t('users.language')}>
              <NativeSelect name="locale" defaultValue={iv('locale') ?? 'en'} options={LOCALES} />
            </Field>

            {mode === 'create' ? (
              <>
                <Field label={t('users.temporaryPassword')} required error={fe?.password?.[0]} hint={t('users.tempPasswordHint')}>
                  <Input name="password" type="text" autoComplete="off" />
                </Field>
                {roles.length > 0 ? (
                  <Field label={t('users.roles')}>
                    <div className="flex flex-col gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-base)] p-2.5 max-h-44 overflow-y-auto">
                      {roles.map((role) => (
                        <label key={role.id} className={`flex items-center gap-2 text-[13px] ${role.assignable ? '' : 'opacity-50'}`}>
                          <input type="checkbox" name="roleIds" value={role.id} disabled={!role.assignable} />
                          {role.name}
                          {role.isSystem ? <span className="text-[10px] text-[var(--color-text-tertiary)]">{t('users.systemTag')}</span> : null}
                          {!role.assignable ? <span className="text-[10px] text-[var(--color-text-tertiary)]">{t('users.notAssignableTag')}</span> : null}
                        </label>
                      ))}
                    </div>
                  </Field>
                ) : null}
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" name="isActive" defaultChecked />
                  {t('users.active')}
                </label>
              </>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="ghost">{t('common.cancel')}</Button></DialogClose>
            <Button type="submit" loading={pending}>{mode === 'edit' ? t('users.saveChanges') : t('users.createUser')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
