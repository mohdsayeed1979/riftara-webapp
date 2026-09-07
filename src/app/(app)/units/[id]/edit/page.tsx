import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page';
import { requirePermission } from '@/lib/auth/guard';
import { isUuid } from '@/lib/utils';
import { getUnitForEdit, getUnitFormReferenceData, nextUnitCode } from '@/services/unit-service';
import { UnitForm, type UnitFormInitial } from '@/features/units/unit-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Edit Unit' };

function str(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(value);
}

export default async function EditUnitPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('units:edit');
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [record, reference, suggestedCode] = await Promise.all([
    getUnitForEdit(user.organizationId, id),
    getUnitFormReferenceData(user.organizationId),
    nextUnitCode(user.organizationId),
  ]);
  if (!record) notFound();

  const { unit, pricing } = record;
  const initial: UnitFormInitial = {
    propertyId: unit.propertyId,
    buildingId: unit.buildingId ?? undefined,
    floorId: unit.floorId ?? undefined,
    code: unit.code,
    unitNumber: unit.unitNumber,
    unitTypeId: unit.unitTypeId,
    usageType: unit.usageType,
    statusId: unit.statusId,
    grossArea: str(unit.grossArea),
    netArea: str(unit.netArea),
    leasableArea: str(unit.leasableArea),
    terraceArea: str(unit.terraceArea),
    balconyArea: str(unit.balconyArea),
    storageArea: str(unit.storageArea),
    parkingAllocation: str(unit.parkingAllocation),
    roomCount: str(unit.roomCount),
    bedroomCount: str(unit.bedroomCount),
    bathroomCount: str(unit.bathroomCount),
    hasKitchen: unit.hasKitchen,
    hasMaidRoom: unit.hasMaidRoom,
    hasDriverRoom: unit.hasDriverRoom,
    furnishingStatus: unit.furnishingStatus,
    condition: unit.condition ?? undefined,
    fitOutStatus: unit.fitOutStatus,
    hvacType: unit.hvacType ?? undefined,
    electricityMeterNumber: unit.electricityMeterNumber ?? undefined,
    waterMeterNumber: unit.waterMeterNumber ?? undefined,
    electricityAccount: unit.electricityAccount ?? undefined,
    waterAccount: unit.waterAccount ?? undefined,
    frontage: str(unit.frontage),
    ceilingHeight: str(unit.ceilingHeight),
    electricalLoad: unit.electricalLoad ?? undefined,
    permittedActivities: (unit.permittedActivities ?? []).join(', '),
    signageRights: unit.signageRights,
    loadingAccess: unit.loadingAccess,
    deliveryAccess: unit.deliveryAccess,
    fireSystem: unit.fireSystem,
    hvacCapacity: unit.hvacCapacity ?? undefined,
    utilityCapacity: unit.utilityCapacity ?? undefined,
    fitOutRequirements: unit.fitOutRequirements ?? undefined,
    availabilityDate: str(unit.availabilityDate),
    descriptionEn: unit.descriptionEn ?? undefined,
    descriptionAr: unit.descriptionAr ?? undefined,
    askingRent: str(pricing?.askingRent),
    targetRent: str(pricing?.targetRent),
    minimumRent: str(pricing?.minimumRent),
    approvedRent: str(pricing?.approvedRent),
    marketRent: str(pricing?.marketRent),
    serviceCharges: str(pricing?.serviceCharges),
    depositAmount: str(pricing?.depositAmount),
    parkingCharges: str(pricing?.parkingCharges),
    otherCharges: str(pricing?.otherCharges),
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[
          { label: 'Units', href: '/units' },
          { label: `Unit ${unit.unitNumber}`, href: `/units/${id}` },
          { label: 'Edit' },
        ]}
        title={`Edit Unit ${unit.unitNumber}`}
        subtitle="Update unit details. Pricing changes are recorded in the price history."
      />
      <UnitForm mode="edit" unitId={id} reference={reference} suggestedCode={suggestedCode} initial={initial} />
    </div>
  );
}
