import 'server-only';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, type SQL } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  buildings,
  contracts,
  contractVersions,
  invoices,
  paymentSchedules,
  properties,
  tenants,
  units,
  unitStatuses,
} from '@/db/schema';
import { recordAudit } from '@/lib/audit';
import { businessRuleViolation, notFound, validationError } from '@/lib/errors';
import { computeUnitAvailability } from './availability-service';
import { syncWebsiteListing } from './publishing-service';
import {
  deriveInvoiceStatus,
  generatePaymentSchedule,
} from '@/lib/calculations/finance';
import { getPolicy } from '@/lib/settings';
import { round2 } from '@/lib/utils';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Contract service (BRD 26, 37, 40).
 *
 * BR-003: overlapping active contracts blocked (DB trigger + here).
 * BR-010: signing a contract sets the unit to Leased and generates the
 *         payment schedule and invoices within one transaction.
 * BR-012: signed contracts are protected from deletion (DB trigger).
 */

export interface ContractListFilters {
  organizationId: string;
  allowedPropertyIds?: string[] | null;
  propertyId?: string;
  status?: string;
  search?: string;
  expiringWithinDays?: number;
  page: number;
  pageSize: number;
}

export interface ContractListItem {
  id: string;
  contractNumber: string;
  ejarReference: string | null;
  tenantName: string;
  propertyName: string;
  unitNumber: string;
  startDate: string;
  endDate: string;
  annualRent: number;
  paymentFrequency: string;
  status: string;
  daysToExpiry: number;
}

export async function listContracts(
  filters: ContractListFilters,
): Promise<{ items: ContractListItem[]; total: number }> {
  const db = await getDb();
  const conditions: SQL[] = [eq(contracts.organizationId, filters.organizationId), isNull(contracts.deletedAt)];
  if (filters.allowedPropertyIds?.length) conditions.push(inArray(contracts.propertyId, filters.allowedPropertyIds));
  if (filters.propertyId) conditions.push(eq(contracts.propertyId, filters.propertyId));
  if (filters.status) conditions.push(eq(contracts.status, filters.status as typeof contracts.$inferSelect.status));
  if (filters.search) {
    conditions.push(
      or(
        ilike(contracts.contractNumber, `%${filters.search}%`),
        ilike(contracts.ejarReference, `%${filters.search}%`),
        ilike(tenants.displayName, `%${filters.search}%`),
      ) as SQL,
    );
  }
  if (filters.expiringWithinDays) {
    const horizon = new Date();
    horizon.setUTCDate(horizon.getUTCDate() + filters.expiringWithinDays);
    conditions.push(eq(contracts.isActive, true));
    conditions.push(lte(contracts.endDate, horizon.toISOString().slice(0, 10)));
  }

  const where = and(...conditions) as SQL;

  const rows = await db
    .select({
      id: contracts.id,
      contractNumber: contracts.contractNumber,
      ejarReference: contracts.ejarReference,
      tenantName: tenants.displayName,
      propertyName: properties.nameEn,
      unitNumber: units.unitNumber,
      startDate: contracts.startDate,
      endDate: contracts.endDate,
      annualRent: contracts.annualRent,
      paymentFrequency: contracts.paymentFrequency,
      status: contracts.status,
    })
    .from(contracts)
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .innerJoin(properties, eq(properties.id, contracts.propertyId))
    .innerJoin(units, eq(units.id, contracts.unitId))
    .where(where)
    .orderBy(filters.expiringWithinDays ? asc(contracts.endDate) : desc(contracts.startDate))
    .limit(filters.pageSize)
    .offset((filters.page - 1) * filters.pageSize);

  const [{ total }] = await db
    .select({ total: count() })
    .from(contracts)
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .where(where);

  const now = Date.now();
  return {
    items: rows.map((row) => ({
      id: row.id,
      contractNumber: row.contractNumber,
      ejarReference: row.ejarReference,
      tenantName: row.tenantName,
      propertyName: row.propertyName,
      unitNumber: row.unitNumber,
      startDate: row.startDate,
      endDate: row.endDate,
      annualRent: round2(Number(row.annualRent)),
      paymentFrequency: row.paymentFrequency,
      status: row.status,
      daysToExpiry: Math.ceil((new Date(row.endDate).getTime() - now) / 86_400_000),
    })),
    total: Number(total),
  };
}

export async function getContractDetail(organizationId: string, contractId: string) {
  const db = await getDb();
  const [contract] = await db
    .select({
      id: contracts.id,
      contractNumber: contracts.contractNumber,
      ejarReference: contracts.ejarReference,
      ejarStatus: contracts.ejarStatus,
      tenantId: contracts.tenantId,
      tenantName: tenants.displayName,
      lessorName: contracts.lessorName,
      propertyId: contracts.propertyId,
      propertyName: properties.nameEn,
      buildingName: buildings.nameEn,
      unitId: contracts.unitId,
      unitNumber: units.unitNumber,
      startDate: contracts.startDate,
      endDate: contracts.endDate,
      durationMonths: contracts.durationMonths,
      leasableArea: contracts.leasableArea,
      annualRent: contracts.annualRent,
      rentPerSqm: contracts.rentPerSqm,
      paymentFrequency: contracts.paymentFrequency,
      depositAmount: contracts.depositAmount,
      vatRateBps: contracts.vatRateBps,
      serviceCharges: contracts.serviceCharges,
      escalationPercent: contracts.escalationPercent,
      gracePeriodDays: contracts.gracePeriodDays,
      fitOutPeriodDays: contracts.fitOutPeriodDays,
      specialConditions: contracts.specialConditions,
      status: contracts.status,
      signedAt: contracts.signedAt,
      renewalStatus: contracts.renewalStatus,
    })
    .from(contracts)
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .innerJoin(properties, eq(properties.id, contracts.propertyId))
    .innerJoin(units, eq(units.id, contracts.unitId))
    .leftJoin(buildings, eq(buildings.id, contracts.buildingId))
    .where(and(eq(contracts.id, contractId), eq(contracts.organizationId, organizationId), isNull(contracts.deletedAt)))
    .limit(1);

  if (!contract) return null;

  const [schedule, contractInvoices] = await Promise.all([
    db
      .select()
      .from(paymentSchedules)
      .where(eq(paymentSchedules.contractId, contractId))
      .orderBy(asc(paymentSchedules.installmentNumber)),
    db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        dueDate: invoices.dueDate,
        totalAmount: invoices.totalAmount,
        paidAmount: invoices.paidAmount,
        balance: invoices.balanceAmount,
        status: invoices.status,
      })
      .from(invoices)
      .where(eq(invoices.contractId, contractId))
      .orderBy(asc(invoices.dueDate)),
  ]);

  return { contract, schedule, invoices: contractInvoices };
}

export interface CreateContractInput {
  tenantId: string;
  propertyId: string;
  unitId: string;
  reservationId?: string;
  proposalId?: string;
  startDate: string;
  endDate: string;
  annualRent: number;
  serviceCharges?: number;
  depositAmount?: number;
  paymentFrequency: 'monthly' | 'quarterly' | 'semi_annual' | 'annual';
  escalationPercent?: number;
  gracePeriodDays?: number;
  fitOutPeriodDays?: number;
  specialConditions?: string;
  lessorName?: string;
}

/** Creates a draft contract. Overlap (BR-003) is checked before insert. */
export async function createContract(
  actor: SessionUser,
  input: CreateContractInput,
): Promise<{ id: string; contractNumber: string }> {
  if (new Date(input.endDate) <= new Date(input.startDate)) {
    throw validationError('The contract end date must be after the start date.');
  }

  const db = await getDb();
  const policy = await getPolicy(actor.organizationId);

  return db.transaction(async (tx) => {
    // Explicit overlap check gives a friendly message before the DB trigger fires.
    const overlapping = await tx
      .select({ contractNumber: contracts.contractNumber })
      .from(contracts)
      .where(
        and(
          eq(contracts.unitId, input.unitId),
          eq(contracts.isActive, true),
          isNull(contracts.deletedAt),
          lte(contracts.startDate, input.endDate),
          gte(contracts.endDate, input.startDate),
        ),
      )
      .limit(1);
    if (overlapping.length > 0) {
      throw businessRuleViolation(
        'BR-003',
        `This unit already has an active contract (${overlapping[0].contractNumber}) overlapping the selected period.`,
      );
    }

    const [unit] = await tx
      .select({ leasableArea: units.leasableArea, buildingId: units.buildingId })
      .from(units)
      .where(eq(units.id, input.unitId))
      .limit(1);
    if (!unit) throw notFound('Unit', input.unitId);

    const contractNumber = await nextContractNumber(tx, actor.organizationId);
    const durationMonths =
      (new Date(input.endDate).getUTCFullYear() - new Date(input.startDate).getUTCFullYear()) * 12 +
      (new Date(input.endDate).getUTCMonth() - new Date(input.startDate).getUTCMonth()) +
      1;
    const area = Number(unit.leasableArea ?? 0);

    const [created] = await tx
      .insert(contracts)
      .values({
        organizationId: actor.organizationId,
        contractNumber,
        tenantId: input.tenantId,
        lessorName: input.lessorName ?? 'RIFTARA Real Estate Company LLC',
        propertyId: input.propertyId,
        buildingId: unit.buildingId,
        unitId: input.unitId,
        reservationId: input.reservationId ?? null,
        proposalId: input.proposalId ?? null,
        startDate: input.startDate,
        endDate: input.endDate,
        durationMonths,
        leasableArea: area || null,
        annualRent: round2(input.annualRent),
        rentPerSqm: area > 0 ? round2(input.annualRent / area) : null,
        paymentFrequency: input.paymentFrequency,
        depositAmount: round2(input.depositAmount ?? input.annualRent * 0.25),
        vatRateBps: Math.round(policy.vatRatePercent * 100),
        serviceCharges: round2(input.serviceCharges ?? 0),
        escalationPercent: input.escalationPercent ?? 0,
        gracePeriodDays: input.gracePeriodDays ?? 0,
        fitOutPeriodDays: input.fitOutPeriodDays ?? 0,
        specialConditions: input.specialConditions ?? null,
        status: 'draft',
        isActive: false,
        createdByUserId: actor.id,
      })
      .returning({ id: contracts.id });

    await tx.insert(contractVersions).values({
      contractId: created.id,
      version: 1,
      snapshot: { ...input, contractNumber },
      changeReason: 'Initial contract draft.',
      createdByUserId: actor.id,
    });

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'create',
      entityType: 'contract',
      entityId: created.id,
      entityLabel: contractNumber,
      newValue: { annualRent: input.annualRent, startDate: input.startDate, endDate: input.endDate },
      actor: { id: actor.id, fullName: actor.fullName },
    });

    return { id: created.id, contractNumber };
  });
}

/**
 * Signs and activates a contract (BR-010). Sets the unit to Leased, generates
 * the payment schedule and issues due invoices — all atomically.
 */
export async function signContract(
  actor: SessionUser,
  contractId: string,
): Promise<{ scheduleCount: number; invoiceCount: number }> {
  const db = await getDb();
  const policy = await getPolicy(actor.organizationId);

  return db.transaction(async (tx) => {
    const [contract] = await tx
      .select()
      .from(contracts)
      .where(and(eq(contracts.id, contractId), eq(contracts.organizationId, actor.organizationId)))
      .limit(1);
    if (!contract) throw notFound('Contract', contractId);
    if (contract.status === 'active' || contract.status === 'signed') {
      throw validationError('This contract is already signed.');
    }

    // Activating triggers the BR-003 overlap check at the database level.
    await tx
      .update(contracts)
      .set({ status: 'active', isActive: true, signedAt: new Date(), activatedAt: new Date(), updatedAt: new Date() })
      .where(eq(contracts.id, contractId));

    // BR-010 — set the unit to Leased.
    const [leasedStatus] = await tx
      .select({ id: unitStatuses.id })
      .from(unitStatuses)
      .where(and(eq(unitStatuses.organizationId, actor.organizationId), eq(unitStatuses.key, 'leased')))
      .limit(1);
    if (leasedStatus) {
      await tx
        .update(units)
        .set({ statusId: leasedStatus.id, lastLeasedAt: contract.startDate, vacancyStartDate: null })
        .where(eq(units.id, contract.unitId));
      await computeUnitAvailability(tx, contract.unitId, actor.organizationId);
      await syncWebsiteListing(tx, contract.unitId);
    }

    // Generate the payment schedule (BRD 40).
    const installments = generatePaymentSchedule({
      startDate: new Date(contract.startDate),
      endDate: new Date(contract.endDate),
      annualRent: Number(contract.annualRent),
      serviceCharges: Number(contract.serviceCharges),
      paymentFrequency: contract.paymentFrequency,
      vatRateBps: contract.vatRateBps,
      escalationPercent: Number(contract.escalationPercent),
      escalationFrequencyMonths: contract.escalationFrequencyMonths,
      gracePeriodDays: contract.gracePeriodDays,
      invoiceLeadDays: policy.invoiceLeadDays,
    });

    if (installments.length > 0) {
      await tx.insert(paymentSchedules).values(
        installments.map((installment) => ({
          organizationId: actor.organizationId,
          contractId,
          installmentNumber: installment.installmentNumber,
          periodStart: installment.periodStart.toISOString().slice(0, 10),
          periodEnd: installment.periodEnd.toISOString().slice(0, 10),
          invoiceDate: installment.invoiceDate.toISOString().slice(0, 10),
          dueDate: installment.dueDate.toISOString().slice(0, 10),
          rentAmount: installment.rentAmount,
          serviceChargeAmount: installment.serviceChargeAmount,
          vatAmount: installment.vatAmount,
          totalAmount: installment.totalAmount,
        })),
      );
    }

    // Issue invoices for instalments whose invoice date has passed.
    const now = new Date();
    const dueInstallments = installments.filter((installment) => installment.invoiceDate <= now);
    let invoiceCount = 0;
    for (const installment of dueInstallments) {
      const invoiceNumber = await nextInvoiceNumber(tx, actor.organizationId);
      const status = deriveInvoiceStatus({
        totalAmount: installment.totalAmount,
        paidAmount: 0,
        dueDate: installment.dueDate,
        invoiceDate: installment.invoiceDate,
        now,
      });
      await tx.insert(invoices).values({
        organizationId: actor.organizationId,
        invoiceNumber,
        contractId,
        tenantId: contract.tenantId,
        propertyId: contract.propertyId,
        unitId: contract.unitId,
        invoiceDate: installment.invoiceDate.toISOString().slice(0, 10),
        dueDate: installment.dueDate.toISOString().slice(0, 10),
        periodStart: installment.periodStart.toISOString().slice(0, 10),
        periodEnd: installment.periodEnd.toISOString().slice(0, 10),
        rentAmount: installment.rentAmount,
        serviceChargeAmount: installment.serviceChargeAmount,
        vatAmount: installment.vatAmount,
        totalAmount: installment.totalAmount,
        paidAmount: 0,
        balanceAmount: installment.totalAmount,
        status,
      });
      invoiceCount += 1;
    }

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'sign',
      entityType: 'contract',
      entityId: contractId,
      entityLabel: contract.contractNumber,
      previousValue: { status: contract.status },
      newValue: { status: 'active', scheduleCount: installments.length, invoiceCount },
      actor: { id: actor.id, fullName: actor.fullName },
    });

    return { scheduleCount: installments.length, invoiceCount };
  });
}

async function nextContractNumber(tx: DbLike, organizationId: string): Promise<string> {
  const [{ total }] = await tx
    .select({ total: count() })
    .from(contracts)
    .where(eq(contracts.organizationId, organizationId));
  const year = new Date().getUTCFullYear();
  return `LC-${year}-${String(Number(total) + 1).padStart(4, '0')}`;
}

async function nextInvoiceNumber(tx: DbLike, organizationId: string): Promise<string> {
  const [{ total }] = await tx
    .select({ total: count() })
    .from(invoices)
    .where(eq(invoices.organizationId, organizationId));
  return `INV-${String(Number(total) + 1).padStart(6, '0')}`;
}

type DbLike = Awaited<ReturnType<typeof getDb>>;
