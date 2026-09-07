'use client';

import { useEffect, useState, useTransition, useActionState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/misc';
import { NativeSelect } from '@/components/ui/native-select';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { BUILDING_STATUSES } from '@/lib/units/enums';
import type { ActionResult } from '@/lib/errors';
import {
  archiveBuildingAction,
  archiveFloorAction,
  createBuildingAction,
  createFloorAction,
  updateBuildingAction,
  updateFloorAction,
  type EntityActionResult,
} from '@/features/properties/building-actions';

interface FloorItem {
  id: string;
  level: number;
  nameEn: string;
  nameAr: string | null;
  grossArea: number | null;
  unitCount: number;
}
interface BuildingItem {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  floorCount: number;
  unitCount: number;
  grossLeasableArea: number | null;
  constructionYear: number | null;
  elevatorCount: number | null;
  parkingCapacity: number | null;
  status: string;
  floors: FloorItem[];
}

export interface BuildingPermissions {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

const grid2 = 'grid grid-cols-1 gap-3 sm:grid-cols-2';

export function BuildingsPanel({
  propertyId,
  buildings,
  permissions,
  suggestedCode,
}: {
  propertyId: string;
  buildings: BuildingItem[];
  permissions: BuildingPermissions;
  suggestedCode: string;
}) {
  return (
    <Card>
      <CardHeader
        title="Buildings"
        description="Manage the buildings, floors and their units for this property."
        action={
          permissions.canCreate ? (
            <BuildingDialog propertyId={propertyId} suggestedCode={suggestedCode} trigger={<Button size="sm"><Plus />Add Building</Button>} />
          ) : null
        }
      />
      <CardBody className="pt-0">
        {buildings.length === 0 ? (
          <EmptyState
            icon={<Building2 />}
            title="No buildings yet"
            description="Create a building first to add floors and units."
            action={
              permissions.canCreate ? (
                <BuildingDialog propertyId={propertyId} suggestedCode={suggestedCode} trigger={<Button><Plus />Add Building</Button>} />
              ) : undefined
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            {buildings.map((building) => (
              <BuildingCard key={building.id} propertyId={propertyId} building={building} permissions={permissions} />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function BuildingCard({
  propertyId,
  building,
  permissions,
}: {
  propertyId: string;
  building: BuildingItem;
  permissions: BuildingPermissions;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function archive() {
    if (!confirm(`Archive building "${building.nameEn}"? This cannot be undone from the UI.`)) return;
    startTransition(async () => {
      const result = await archiveBuildingAction(building.id, propertyId);
      if (result.ok) {
        toast.success('Building archived.');
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-[var(--color-text-primary)]">{building.nameEn}</span>
            <span className="text-[11px] text-[var(--color-text-tertiary)]">{building.code}</span>
            <StatusBadge status={building.status} />
          </div>
          <p className="mt-0.5 text-[11.5px] text-[var(--color-text-tertiary)]">
            {building.floors.length} floors · {building.unitCount} units
            {building.constructionYear ? ` · Built ${building.constructionYear}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {permissions.canEdit ? (
            <FloorDialog propertyId={propertyId} buildingId={building.id} trigger={<Button size="sm" variant="secondary"><Plus />Add Floor</Button>} />
          ) : null}
          {permissions.canEdit ? (
            <BuildingDialog propertyId={propertyId} building={building} trigger={<Button size="sm" variant="ghost"><Pencil className="size-3.5" />Edit</Button>} />
          ) : null}
          {permissions.canDelete ? (
            <Button size="sm" variant="ghost" onClick={archive} loading={pending} aria-label="Archive building">
              <Trash2 className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>

      {building.floors.length > 0 ? (
        <div className="mt-3">
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH>Floor</TH>
                  <TH alignment="end">Level</TH>
                  <TH alignment="end">Units</TH>
                  <TH alignment="end">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {building.floors.map((floor) => (
                  <FloorRow key={floor.id} propertyId={propertyId} floor={floor} permissions={permissions} />
                ))}
              </TBody>
            </Table>
          </TableContainer>
        </div>
      ) : (
        <p className="mt-3 text-[12px] text-[var(--color-text-tertiary)]">
          No floors yet.{permissions.canEdit ? ' Use "Add Floor" to create one.' : ''}
        </p>
      )}
    </div>
  );
}

function FloorRow({
  propertyId,
  floor,
  permissions,
}: {
  propertyId: string;
  floor: FloorItem;
  permissions: BuildingPermissions;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function archive() {
    if (!confirm(`Archive floor "${floor.nameEn}"?`)) return;
    startTransition(async () => {
      const result = await archiveFloorAction(floor.id, propertyId);
      if (result.ok) {
        toast.success('Floor archived.');
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }
  return (
    <TR>
      <TD className="font-medium">{floor.nameEn}</TD>
      <TD alignment="end" numeric>{floor.level}</TD>
      <TD alignment="end" numeric>{floor.unitCount}</TD>
      <TD alignment="end" className="whitespace-nowrap">
        {permissions.canEdit ? (
          <FloorDialog
            propertyId={propertyId}
            floor={floor}
            trigger={<button className="text-[12px] font-medium text-[var(--color-info)] hover:underline">Edit</button>}
          />
        ) : null}
        {permissions.canEdit ? (
          <button onClick={archive} disabled={pending} className="ms-3 text-[12px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-error)]">
            Archive
          </button>
        ) : null}
      </TD>
    </TR>
  );
}

/* ------------------------------- Dialogs -------------------------------- */

function BuildingDialog({
  propertyId,
  building,
  suggestedCode,
  trigger,
}: {
  propertyId: string;
  building?: BuildingItem;
  suggestedCode?: string;
  trigger: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const isEdit = Boolean(building);
  const action = isEdit && building ? updateBuildingAction.bind(null, building.id, propertyId) : createBuildingAction;
  const [state, formAction, pending] = useActionState<ActionResult<EntityActionResult> | null, FormData>(action, null);

  useEffect(() => {
    if (state?.ok) {
      toast.success(isEdit ? 'Building updated.' : 'Building created.');
      setOpen(false);
      router.refresh();
    } else if (state && !state.ok && !state.fieldErrors) {
      toast.error(state.error.message);
    }
  }, [state, isEdit, router]);

  const fe = state && !state.ok ? state.fieldErrors : undefined;
  const err = (n: string) => fe?.[n]?.[0];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader title={isEdit ? 'Edit Building' : 'Add Building'} description="Buildings belong to this property." />
        <form action={formAction}>
          <DialogBody className="flex flex-col gap-3">
            {!isEdit ? <input type="hidden" name="propertyId" value={propertyId} /> : null}
            <div className={grid2}>
              <Field label="Building Code" required error={err('code')}>
                <Input name="code" defaultValue={building?.code ?? suggestedCode} maxLength={32} aria-invalid={!!err('code')} />
              </Field>
              <Field label="Status" error={err('status')}>
                <NativeSelect name="status" defaultValue={building?.status ?? 'active'} options={BUILDING_STATUSES} />
              </Field>
            </div>
            <Field label="Building Name" required error={err('nameEn')}>
              <Input name="nameEn" defaultValue={building?.nameEn} maxLength={160} aria-invalid={!!err('nameEn')} />
            </Field>
            <Field label="Building Name (Arabic)" error={err('nameAr')}>
              <Input name="nameAr" defaultValue={building?.nameAr ?? undefined} dir="rtl" maxLength={160} />
            </Field>
            <div className={grid2}>
              <Field label="Number of Floors" error={err('floorCount')}>
                <Input name="floorCount" type="number" min="0" step="1" defaultValue={building ? String(building.floorCount) : undefined} />
              </Field>
              <Field label="Gross Leasable Area (m²)" error={err('grossLeasableArea')}>
                <Input name="grossLeasableArea" type="number" min="0" step="0.01" defaultValue={building?.grossLeasableArea != null ? String(building.grossLeasableArea) : undefined} />
              </Field>
              <Field label="Construction Year" error={err('constructionYear')}>
                <Input name="constructionYear" type="number" min="1300" max="2200" step="1" defaultValue={building?.constructionYear != null ? String(building.constructionYear) : undefined} />
              </Field>
              <Field label="Elevators" error={err('elevatorCount')}>
                <Input name="elevatorCount" type="number" min="0" step="1" defaultValue={building?.elevatorCount != null ? String(building.elevatorCount) : undefined} />
              </Field>
              <Field label="Parking Capacity" error={err('parkingCapacity')}>
                <Input name="parkingCapacity" type="number" min="0" step="1" defaultValue={building?.parkingCapacity != null ? String(building.parkingCapacity) : undefined} />
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" loading={pending}>{isEdit ? 'Save Changes' : 'Add Building'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FloorDialog({
  propertyId,
  buildingId,
  floor,
  trigger,
}: {
  propertyId: string;
  buildingId?: string;
  floor?: FloorItem;
  trigger: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const isEdit = Boolean(floor);
  const action = isEdit && floor ? updateFloorAction.bind(null, floor.id, propertyId) : createFloorAction.bind(null, propertyId);
  const [state, formAction, pending] = useActionState<ActionResult<EntityActionResult> | null, FormData>(action, null);

  useEffect(() => {
    if (state?.ok) {
      toast.success(isEdit ? 'Floor updated.' : 'Floor created.');
      setOpen(false);
      router.refresh();
    } else if (state && !state.ok && !state.fieldErrors) {
      toast.error(state.error.message);
    }
  }, [state, isEdit, router]);

  const fe = state && !state.ok ? state.fieldErrors : undefined;
  const err = (n: string) => fe?.[n]?.[0];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader title={isEdit ? 'Edit Floor' : 'Add Floor'} description="Floors belong to the selected building." />
        <form action={formAction}>
          <DialogBody className="flex flex-col gap-3">
            {!isEdit && buildingId ? <input type="hidden" name="buildingId" value={buildingId} /> : null}
            <div className={grid2}>
              <Field label="Floor Level" required error={err('level')} hint="e.g. 0 = ground, -1 = basement">
                <Input name="level" type="number" step="1" defaultValue={floor ? String(floor.level) : undefined} aria-invalid={!!err('level')} />
              </Field>
              <Field label="Gross Area (m²)" error={err('grossArea')}>
                <Input name="grossArea" type="number" min="0" step="0.01" defaultValue={floor?.grossArea != null ? String(floor.grossArea) : undefined} />
              </Field>
            </div>
            <Field label="Floor Name" required error={err('nameEn')}>
              <Input name="nameEn" defaultValue={floor?.nameEn} maxLength={120} aria-invalid={!!err('nameEn')} placeholder="Ground Floor" />
            </Field>
            <Field label="Floor Name (Arabic)" error={err('nameAr')}>
              <Input name="nameAr" defaultValue={floor?.nameAr ?? undefined} dir="rtl" maxLength={120} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" loading={pending}>{isEdit ? 'Save Changes' : 'Add Floor'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
