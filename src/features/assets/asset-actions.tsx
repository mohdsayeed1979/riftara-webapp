'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ArrowLeftRight, Ban, Eye, MapPin, MoreHorizontal, Pencil, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Field, Input, Textarea } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {
  assignAssetAction,
  changeAssetStatusAction,
  disposeAssetAction,
  transferAssetAction,
} from '@/app/(app)/assets/actions';
import { AssetFormDialog, type AssetFormInitial, type AssetFormReference } from './asset-form';
import { CHANGEABLE_ASSET_STATUSES } from './status';

export interface AssetActionTarget {
  id: string;
  code: string;
  nameEn: string;
  status: string;
  propertyId: string;
  buildingId: string | null;
  location: string | null;
  initial: AssetFormInitial;
}
export interface AssetPermissions {
  canEdit: boolean;
  canDelete: boolean;
}

type DialogKind = 'edit' | 'assign' | 'transfer' | 'status' | 'dispose' | null;

function useRefreshAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, success: string, onDone: () => void) =>
    start(async () => {
      const result = await fn();
      if (result.ok) {
        toast.success(success);
        onDone();
        router.refresh();
      } else {
        toast.error(result.error?.message ?? 'Something went wrong.');
      }
    });
  return { pending, run };
}

/* --------------------------------- Assign -------------------------------- */

function AssignDialog({
  target,
  reference,
  open,
  onOpenChange,
}: {
  target: AssetActionTarget;
  reference: AssetFormReference;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [buildingId, setBuildingId] = useState(target.buildingId ?? '');
  const [location, setLocation] = useState(target.location ?? '');
  const { pending, run } = useRefreshAction();
  const buildings = reference.buildings.filter((b) => b.propertyId === target.propertyId).map((b) => ({ id: b.id, name: b.name }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader title="Assign Asset" description="Assign a building and location within the current property." />
        <DialogBody className="flex flex-col gap-4">
          <Field label="Building">
            <NativeSelect value={buildingId} onChange={setBuildingId} placeholder="Unassigned" options={buildings} />
          </Field>
          <Field label="Location">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={160} placeholder="e.g. Roof, Mechanical Room" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
          <Button
            type="button"
            loading={pending}
            onClick={() => run(() => assignAssetAction(target.id, { buildingId: buildingId || null, location }), 'Asset assignment updated.', () => onOpenChange(false))}
          >
            Save Assignment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------- Transfer ------------------------------- */

function TransferDialog({
  target,
  reference,
  open,
  onOpenChange,
}: {
  target: AssetActionTarget;
  reference: AssetFormReference;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [propertyId, setPropertyId] = useState('');
  const [buildingId, setBuildingId] = useState('');
  const [location, setLocation] = useState('');
  const { pending, run } = useRefreshAction();
  const buildings = reference.buildings.filter((b) => b.propertyId === propertyId).map((b) => ({ id: b.id, name: b.name }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader title="Transfer Asset" description="Move this asset to a different property. Its history is preserved." />
        <DialogBody className="flex flex-col gap-4">
          <Field label="Destination Property" required>
            <NativeSelect
              value={propertyId}
              onChange={(v) => { setPropertyId(v); setBuildingId(''); }}
              placeholder="Select a property"
              options={reference.properties}
            />
          </Field>
          <Field label="Building">
            <NativeSelect value={buildingId} onChange={setBuildingId} placeholder={propertyId ? 'Unassigned' : 'Select a property first'} options={buildings} disabled={!propertyId} />
          </Field>
          <Field label="Location">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={160} placeholder="Optional" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
          <Button
            type="button"
            loading={pending}
            disabled={!propertyId}
            onClick={() => run(() => transferAssetAction(target.id, { propertyId, buildingId: buildingId || null, location }), 'Asset transferred.', () => onOpenChange(false))}
          >
            Transfer Asset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ Change status ---------------------------- */

function StatusDialog({
  target,
  open,
  onOpenChange,
}: {
  target: AssetActionTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [status, setStatus] = useState(target.status === 'decommissioned' ? '' : target.status);
  const { pending, run } = useRefreshAction();
  const options = CHANGEABLE_ASSET_STATUSES;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader title="Change Status" description="Move the asset along its operational lifecycle." />
        <DialogBody className="flex flex-col gap-4">
          <Field label="Status">
            <NativeSelect value={status} onChange={setStatus} placeholder="Select a status" options={options} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
          <Button
            type="button"
            loading={pending}
            disabled={!status || status === target.status}
            onClick={() => run(() => changeAssetStatusAction(target.id, status), 'Asset status updated.', () => onOpenChange(false))}
          >
            Update Status
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------- Dispose -------------------------------- */

function DisposeDialog({
  target,
  open,
  onOpenChange,
}: {
  target: AssetActionTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState('');
  const { pending, run } = useRefreshAction();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader title="Dispose Asset" description={`Decommission ${target.code}. This is permanent — the asset cannot be reactivated, and the record is kept for history.`} />
        <DialogBody className="flex flex-col gap-4">
          <Field label="Disposal Reason" required hint="Recorded in the audit trail.">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={240} rows={3} placeholder="e.g. End of life, sold, replaced" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
          <Button
            type="button"
            variant="destructive"
            loading={pending}
            disabled={reason.trim().length < 3}
            onClick={() => run(() => disposeAssetAction(target.id, reason), 'Asset disposed.', () => onOpenChange(false))}
          >
            Dispose Asset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------- Shared dialog host -------------------------- */

function ActionDialogs({
  target,
  reference,
  dialog,
  setDialog,
}: {
  target: AssetActionTarget;
  reference: AssetFormReference;
  dialog: DialogKind;
  setDialog: (kind: DialogKind) => void;
}) {
  const close = () => setDialog(null);
  return (
    <>
      <AssetFormDialog mode="edit" assetId={target.id} reference={reference} initial={target.initial} open={dialog === 'edit'} onOpenChange={(o) => (o ? setDialog('edit') : close())} />
      <AssignDialog target={target} reference={reference} open={dialog === 'assign'} onOpenChange={(o) => (o ? setDialog('assign') : close())} />
      <TransferDialog target={target} reference={reference} open={dialog === 'transfer'} onOpenChange={(o) => (o ? setDialog('transfer') : close())} />
      <StatusDialog target={target} open={dialog === 'status'} onOpenChange={(o) => (o ? setDialog('status') : close())} />
      <DisposeDialog target={target} open={dialog === 'dispose'} onOpenChange={(o) => (o ? setDialog('dispose') : close())} />
    </>
  );
}

/* ------------------------ Register row action menu ----------------------- */

export function AssetRowActions({
  target,
  reference,
  permissions,
}: {
  target: AssetActionTarget;
  reference: AssetFormReference;
  permissions: AssetPermissions;
}) {
  const [dialog, setDialog] = useState<DialogKind>(null);
  const disposed = target.status === 'decommissioned';
  const { canEdit, canDelete } = permissions;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Asset actions"><MoreHorizontal /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem asChild>
            <Link href={`/assets/${target.id}`}><Eye />View details</Link>
          </DropdownMenuItem>
          {canEdit && !disposed ? <DropdownMenuItem onSelect={() => setDialog('edit')}><Pencil />Edit</DropdownMenuItem> : null}
          {canEdit && !disposed ? <DropdownMenuItem onSelect={() => setDialog('assign')}><MapPin />Assign</DropdownMenuItem> : null}
          {canEdit && !disposed ? <DropdownMenuItem onSelect={() => setDialog('transfer')}><ArrowLeftRight />Transfer</DropdownMenuItem> : null}
          {canEdit && !disposed ? <DropdownMenuItem onSelect={() => setDialog('status')}><RefreshCw />Change status</DropdownMenuItem> : null}
          {canDelete && !disposed ? <DropdownMenuItem destructive onSelect={() => setDialog('dispose')}><Ban />Dispose</DropdownMenuItem> : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ActionDialogs target={target} reference={reference} dialog={dialog} setDialog={setDialog} />
    </>
  );
}

/* --------------------------- Detail action bar --------------------------- */

export function AssetDetailActions({
  target,
  reference,
  permissions,
}: {
  target: AssetActionTarget;
  reference: AssetFormReference;
  permissions: AssetPermissions;
}) {
  const [dialog, setDialog] = useState<DialogKind>(null);
  const disposed = target.status === 'decommissioned';
  const { canEdit, canDelete } = permissions;

  if (!canEdit && !canDelete) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canEdit && !disposed ? (
        <>
          <Button variant="secondary" onClick={() => setDialog('edit')}><Pencil />Edit</Button>
          <Button variant="secondary" onClick={() => setDialog('assign')}><MapPin />Assign</Button>
          <Button variant="secondary" onClick={() => setDialog('transfer')}><ArrowLeftRight />Transfer</Button>
          <Button variant="secondary" onClick={() => setDialog('status')}><RefreshCw />Change Status</Button>
        </>
      ) : null}
      {canDelete && !disposed ? <Button variant="destructive" onClick={() => setDialog('dispose')}><Ban />Dispose</Button> : null}
      <ActionDialogs target={target} reference={reference} dialog={dialog} setDialog={setDialog} />
    </div>
  );
}
