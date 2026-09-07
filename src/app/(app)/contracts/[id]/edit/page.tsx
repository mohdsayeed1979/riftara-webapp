import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page';
import { requirePermission } from '@/lib/auth/guard';
import { isUuid } from '@/lib/utils';
import { getContractForEdit, getContractFormReferenceData } from '@/services/contract-service';
import { ContractForm, type ContractFormInitial } from '@/features/contracts/contract-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Edit Contract' };

const EDITABLE = ['draft', 'issued', 'pending_approval'];

function str(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(value);
}

export default async function EditContractPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('contracts:edit');
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [contract, reference] = await Promise.all([
    getContractForEdit(user.organizationId, id),
    getContractFormReferenceData(user.organizationId),
  ]);
  if (!contract) notFound();
  if (!EDITABLE.includes(contract.status)) {
    // Signed/active contracts are locked — send the user to the read-only detail.
    notFound();
  }

  const unit = reference.units.find((u) => u.id === contract.unitId);
  const initial: ContractFormInitial = {
    tenantId: contract.tenantId,
    propertyId: contract.propertyId,
    buildingId: unit?.buildingId ?? undefined,
    floorId: unit?.floorId ?? undefined,
    unitId: contract.unitId,
    annualRent: str(contract.annualRent),
    paymentFrequency: contract.paymentFrequency,
    startDate: str(contract.startDate),
    endDate: str(contract.endDate),
    serviceCharges: str(contract.serviceCharges),
    depositAmount: str(contract.depositAmount),
    escalationPercent: str(contract.escalationPercent),
    gracePeriodDays: str(contract.gracePeriodDays),
    fitOutPeriodDays: str(contract.fitOutPeriodDays),
    specialConditions: contract.specialConditions ?? undefined,
    lessorName: contract.lessorName,
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[
          { label: 'Contracts', href: '/contracts' },
          { label: contract.contractNumber, href: `/contracts/${id}` },
          { label: 'Edit' },
        ]}
        title={`Edit ${contract.contractNumber}`}
        subtitle="Only draft contracts can be edited. Signing later generates the schedule and invoices."
      />
      <ContractForm reference={reference} initial={initial} mode="edit" contractId={id} />
    </div>
  );
}
