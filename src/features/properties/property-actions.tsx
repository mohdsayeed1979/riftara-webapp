'use client';

import { useRouter } from 'next/navigation';
import { Archive, Eye, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTranslations } from '@/i18n/provider';
import {
  archivePropertyAction,
  deletePropertyAction,
  getPropertyDependenciesAction,
} from '@/app/(app)/properties/actions';
import type { PropertyDependencies } from '@/services/property-service';

const DEP_KEYS: Array<[keyof PropertyDependencies, string]> = [
  ['buildings', 'properties.depBuildings'],
  ['units', 'properties.depUnits'],
  ['contracts', 'properties.depContracts'],
  ['invoices', 'properties.depInvoices'],
  ['payments', 'properties.depPayments'],
  ['reservations', 'properties.depReservations'],
  ['proposals', 'properties.depProposals'],
  ['viewings', 'properties.depViewings'],
  ['leads', 'properties.depLeads'],
  ['workOrders', 'properties.depWorkOrders'],
  ['assets', 'properties.depAssets'],
  ['valuations', 'properties.depValuations'],
  ['documents', 'properties.depDocuments'],
];

export function PropertyActions({
  propertyId,
  name,
  code,
  location,
  canEdit,
  canDelete,
  variant = 'card',
}: {
  propertyId: string;
  name: string;
  code: string;
  location: string;
  canEdit: boolean;
  canDelete: boolean;
  variant?: 'card' | 'detail';
}) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deps, setDeps] = useState<PropertyDependencies | null>(null);
  const [confirmName, setConfirmName] = useState('');

  if (!canEdit && !canDelete) return null;

  function openDelete() {
    setDeps(null);
    setConfirmName('');
    setDeleteOpen(true);
    startTransition(async () => {
      const result = await getPropertyDependenciesAction(propertyId);
      if (result.ok) setDeps(result.data);
      else toast.error(result.error.message);
    });
  }

  function doArchive() {
    startTransition(async () => {
      const result = await archivePropertyAction(propertyId);
      if (result.ok) {
        toast.success(t('properties.archived'));
        setArchiveOpen(false);
        setDeleteOpen(false);
        if (variant === 'detail') router.push('/properties');
        else router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function doDelete() {
    startTransition(async () => {
      const result = await deletePropertyAction(propertyId, confirmName);
      if (result.ok) {
        toast.success(t('properties.deleted'));
        setDeleteOpen(false);
        if (variant === 'detail') router.push('/properties');
        else router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  const activeDeps = deps ? DEP_KEYS.filter(([key]) => (deps[key] as number) > 0) : [];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {variant === 'detail' ? (
            <Button variant="secondary" aria-label={t('properties.actions')}>
              <MoreVertical />
              {t('properties.actions')}
            </Button>
          ) : (
            <button
              type="button"
              aria-label={t('properties.actions')}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)]"
            >
              <MoreVertical className="size-4" aria-hidden />
            </button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => router.push(`/properties/${propertyId}`)}>
            <Eye />
            {t('properties.viewDetails')}
          </DropdownMenuItem>
          {canEdit ? (
            <DropdownMenuItem onSelect={() => router.push(`/properties/${propertyId}/edit`)}>
              <Pencil />
              {t('properties.editProperty')}
            </DropdownMenuItem>
          ) : null}
          {canDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setArchiveOpen(true)}>
                <Archive />
                {t('properties.archiveProperty')}
              </DropdownMenuItem>
              <DropdownMenuItem destructive onSelect={openDelete}>
                <Trash2 />
                {t('properties.deleteProperty')}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Archive confirmation */}
      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent size="sm">
          <DialogHeader title={t('properties.archiveTitle')} description={`${name} · ${code}`} />
          <DialogBody>
            <p className="text-[13px] leading-5 text-[var(--color-text-secondary)]">
              {t('properties.archiveDescription')}
            </p>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" size="sm">{t('properties.cancel')}</Button>
            </DialogClose>
            <Button size="sm" onClick={doArchive} loading={pending}>
              {t('properties.archive')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete flow — dependency aware */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent size="md">
          <DialogHeader
            title={deps && !deps.canHardDelete ? t('properties.deleteBlockedTitle') : t('properties.deleteTitle')}
            description={`${name} · ${code}${location ? ` · ${location}` : ''}`}
          />
          <DialogBody className="flex flex-col gap-3">
            {deps === null ? (
              <p className="text-[13px] text-[var(--color-text-secondary)]">…</p>
            ) : deps.canHardDelete ? (
              <>
                <p className="rounded-[var(--radius-control)] border border-[var(--color-error-border)] bg-[var(--color-error-soft)] px-3 py-2 text-[12.5px] leading-5 text-[var(--color-error)]">
                  {t('properties.deleteWarning')}
                </p>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12.5px] text-[var(--color-text-secondary)]">
                    {t('properties.typeToConfirm')}
                  </span>
                  <input
                    value={confirmName}
                    onChange={(e) => setConfirmName(e.target.value)}
                    placeholder={name}
                    autoComplete="off"
                    className="h-9.5 w-full rounded-[var(--radius-control)] border border-[var(--color-border-base)] bg-[var(--color-surface)] px-3 text-[13.5px] focus:border-[var(--color-gold-400)] focus:outline-none focus:ring-2 focus:ring-[var(--color-gold-200)]"
                  />
                </label>
              </>
            ) : (
              <>
                <p className="text-[13px] text-[var(--color-text-secondary)]">
                  {t('properties.deleteBlockedIntro')}
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {activeDeps.map(([key, labelKey]) => (
                    <li
                      key={key}
                      className="rounded-[var(--radius-pill)] border border-[var(--color-border-base)] bg-[var(--color-surface-muted)] px-2.5 py-1 text-[12px] text-[var(--color-text-secondary)]"
                    >
                      {deps[key] as number} {t(labelKey)}
                    </li>
                  ))}
                </ul>
                <p className="text-[12.5px] text-[var(--color-text-tertiary)]">{t('properties.deleteBlockedHint')}</p>
              </>
            )}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" size="sm">{t('properties.cancel')}</Button>
            </DialogClose>
            {deps && !deps.canHardDelete ? (
              <Button size="sm" onClick={doArchive} loading={pending}>
                <Archive />
                {t('properties.archiveProperty')}
              </Button>
            ) : (
              <Button
                variant="destructive"
                size="sm"
                onClick={doDelete}
                loading={pending}
                disabled={deps === null || confirmName.trim() !== name}
              >
                <Trash2 />
                {t('properties.permanentlyDelete')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
