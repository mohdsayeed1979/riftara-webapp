'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { ASSET_TYPES } from '@/services/asset-constants';
import { createAssetAction, updateAssetAction, type AssetActionResult } from '@/app/(app)/assets/actions';
import type { ActionResult } from '@/lib/errors';
import { humanizeAssetType } from './status';

interface Ref { id: string; name: string }
export interface AssetFormReference {
  properties: Ref[];
  buildings: Array<{ id: string; name: string; propertyId: string }>;
  vendors: Ref[];
}
export interface AssetFormInitial {
  nameEn?: string;
  nameAr?: string;
  assetType?: string;
  propertyId?: string;
  buildingId?: string;
  location?: string;
  manufacturer?: string;
  modelNumber?: string;
  serialNumber?: string;
  supplierVendorId?: string;
  purchaseDate?: string;
  purchaseCost?: string;
  warrantyExpiryDate?: string;
}

const TYPE_OPTIONS = ASSET_TYPES.map((t) => ({ id: t, name: humanizeAssetType(t) }));
const grid2 = 'grid grid-cols-1 gap-4 sm:grid-cols-2';

export function AssetFormDialog({
  mode,
  assetId,
  reference,
  initial,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  mode: 'create' | 'edit';
  assetId?: string;
  reference: AssetFormReference;
  initial?: AssetFormInitial;
  trigger?: ReactNode;
  /** When provided, the dialog is controlled by the parent (no default trigger). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const isControlled = controlledOpen !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (isControlled) onOpenChange?.(next);
      else setUncontrolledOpen(next);
    },
    [isControlled, onOpenChange],
  );
  const [propertyId, setPropertyId] = useState(initial?.propertyId ?? '');

  const action = useMemo(
    () =>
      mode === 'create'
        ? createAssetAction
        : (prev: ActionResult<AssetActionResult> | null, formData: FormData) => updateAssetAction(assetId!, prev, formData),
    [mode, assetId],
  );
  const [state, formAction, pending] = useActionState<ActionResult<AssetActionResult> | null, FormData>(action, null);

  useEffect(() => {
    if (state?.ok) {
      toast.success(mode === 'create' ? `Asset ${state.data.code ?? ''} created.` : 'Asset updated.');
      setOpen(false);
      router.refresh();
    } else if (state && !state.ok && !state.fieldErrors) {
      toast.error(state.error.message);
    }
  }, [state, mode, router, setOpen]);

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const buildingOptions = reference.buildings.filter((b) => b.propertyId === propertyId).map((b) => ({ id: b.id, name: b.name }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {isControlled && !trigger ? null : (
        <DialogTrigger asChild>{trigger ?? <Button><Plus />New Asset</Button>}</DialogTrigger>
      )}
      <DialogContent size="lg">
        <DialogHeader
          title={mode === 'create' ? 'New Asset' : 'Edit Asset'}
          description={mode === 'create' ? 'Register a new operational asset.' : 'Update asset details. Use Assign/Transfer to change its location.'}
        />
        <form action={formAction}>
          <DialogBody className="flex flex-col gap-4">
            <div className={grid2}>
              <Field label="Asset Name (EN)" required error={fieldErrors?.nameEn?.[0]}>
                <Input name="nameEn" maxLength={160} defaultValue={initial?.nameEn} placeholder="e.g. Chiller Unit 1" />
              </Field>
              <Field label="Asset Name (AR)" error={fieldErrors?.nameAr?.[0]}>
                <Input name="nameAr" maxLength={160} defaultValue={initial?.nameAr} dir="rtl" />
              </Field>
            </div>
            <div className={grid2}>
              <Field label="Type" required error={fieldErrors?.assetType?.[0]}>
                <NativeSelect name="assetType" defaultValue={initial?.assetType} placeholder="Select a type" options={TYPE_OPTIONS} />
              </Field>
              {mode === 'create' ? (
                <Field label="Code" error={fieldErrors?.code?.[0]} hint="Leave blank to auto-generate (AST-#####).">
                  <Input name="code" maxLength={40} placeholder="Auto" />
                </Field>
              ) : (
                <div />
              )}
            </div>

            {mode === 'create' ? (
              <div className={grid2}>
                <Field label="Property" required error={fieldErrors?.propertyId?.[0]}>
                  <NativeSelect name="propertyId" value={propertyId} onChange={setPropertyId} placeholder="Select a property" options={reference.properties} />
                </Field>
                <Field label="Building" error={fieldErrors?.buildingId?.[0]}>
                  <NativeSelect name="buildingId" placeholder={propertyId ? 'Unassigned' : 'Select a property first'} options={buildingOptions} disabled={!propertyId} />
                </Field>
              </div>
            ) : null}

            <div className={grid2}>
              <Field label="Location" error={fieldErrors?.location?.[0]}>
                <Input name="location" maxLength={160} defaultValue={initial?.location} placeholder="e.g. Roof, Mechanical Room" />
              </Field>
              <Field label="Supplier / Vendor" error={fieldErrors?.supplierVendorId?.[0]}>
                <NativeSelect name="supplierVendorId" defaultValue={initial?.supplierVendorId} placeholder="None" options={reference.vendors} />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Manufacturer" error={fieldErrors?.manufacturer?.[0]}>
                <Input name="manufacturer" maxLength={120} defaultValue={initial?.manufacturer} />
              </Field>
              <Field label="Model" error={fieldErrors?.modelNumber?.[0]}>
                <Input name="modelNumber" maxLength={80} defaultValue={initial?.modelNumber} />
              </Field>
              <Field label="Serial Number" error={fieldErrors?.serialNumber?.[0]}>
                <Input name="serialNumber" maxLength={80} defaultValue={initial?.serialNumber} />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Purchase Date" error={fieldErrors?.purchaseDate?.[0]}>
                <Input type="date" name="purchaseDate" defaultValue={initial?.purchaseDate} />
              </Field>
              <Field label="Purchase Cost" error={fieldErrors?.purchaseCost?.[0]}>
                <Input type="number" name="purchaseCost" min={0} step="0.01" defaultValue={initial?.purchaseCost} />
              </Field>
              <Field label="Warranty Expiry" error={fieldErrors?.warrantyExpiryDate?.[0]}>
                <Input type="date" name="warrantyExpiryDate" defaultValue={initial?.warrantyExpiryDate} />
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
            <Button type="submit" loading={pending}>{mode === 'create' ? 'Create Asset' : 'Save Changes'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
