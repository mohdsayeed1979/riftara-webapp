import 'server-only';
import { and, asc, desc, eq, isNull, ne } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { contracts, contractVersions, properties, renewals, tenants, units } from '@/db/schema';
import { recordAudit } from '@/lib/audit';
import { businessRuleViolation, notFound, validationError } from '@/lib/errors';
import { getPolicy } from '@/lib/settings';
import { round2 } from '@/lib/utils';
import type { DbExecutor } from '@/db/types';

type Actor = { id: string | null; organizationId: string; fullName: string };

/**
 * Renewal service (Phase 17 — BRD 83-84).
 *
 * Operates on the existing `renewals` and `contracts` tables — no new schema
 * beyond an additive FK for `renewals.newContractId` / `contracts.renewedFromContractId`.
 *
 * State model (within the existing `renewals.status` values):
 *   pending -> in_discussion -> offer_sent -> renewed
 *                                          -> declined
 *   pending/in_discussion/offer_sent -> not_renewed
 *
 * `agreedRent` is the single settled figure: set by {@link approveRenewal} when
 * the rent change exceeds the configured tolerance, or automatically by
 * {@link sendRenewalOffer} when it does not. `decidedAt` marks when the tenant
 * responded (accept or decline). {@link generateRenewedContract} requires both
 * to be present before it will create the new contract — this is what stops a
 * tenant's acceptance from bypassing a required internal approval.
 */

const TERMINAL_STATUSES = ['renewed', 'not_renewed', 'declined'] as const;
type RenewalStatus = 'pending' | 'in_discussion' | 'offer_sent' | 'renewed' | 'not_renewed' | 'declined';

function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export interface RenewalEligibility {
  eligible: boolean;
  reason?: string;
}

/** Deterministic, testable eligibility check for a single contract. */
export async function isContractRenewalEligible(
  organizationId: string,
  contractId: string,
  executor?: DbExecutor,
): Promise<RenewalEligibility> {
  const db = executor ?? (await getDb());
  const [contract] = await db
    .select()
    .from(contracts)
    .where(and(eq(contracts.id, contractId), eq(contracts.organizationId, organizationId)))
    .limit(1);

  if (!contract) return { eligible: false, reason: 'Contract not found.' };
  if (contract.deletedAt) return { eligible: false, reason: 'This contract has been deleted.' };
  if (!['signed', 'active'].includes(contract.status)) {
    return { eligible: false, reason: 'Only signed or active contracts can be renewed.' };
  }
  if (contract.terminatedAt) return { eligible: false, reason: 'Terminated contracts cannot be renewed.' };
  if (contract.renewalStatus === 'renewed') {
    return { eligible: false, reason: 'This contract has already been renewed.' };
  }

  const [existingRenewed] = await db
    .select({ id: renewals.id })
    .from(renewals)
    .where(and(eq(renewals.contractId, contractId), eq(renewals.status, 'renewed')))
    .limit(1);
  if (existingRenewed) {
    return { eligible: false, reason: 'A renewal has already been completed for this contract.' };
  }

  return { eligible: true };
}

function requiresRentApproval(currentRent: number, proposedRent: number, toleranceP: number): boolean {
  if (currentRent <= 0) return true;
  const changePercent = Math.abs(((proposedRent - currentRent) / currentRent) * 100);
  return changePercent > toleranceP;
}

export interface RenewalListItem {
  id: string;
  contractId: string;
  contractNumber: string;
  tenantName: string;
  propertyName: string;
  unitNumber: string;
  status: string;
  noticeDueDate: string;
  currentRent: number;
  proposedRent: number | null;
  marketRent: number | null;
  agreedRent: number | null;
  probability: number;
}

export interface RenewalListFilters {
  organizationId: string;
  allowedPropertyIds?: string[] | null;
  status?: string;
}

export async function listRenewals(filters: RenewalListFilters): Promise<RenewalListItem[]> {
  const db = await getDb();
  const conditions = [eq(renewals.organizationId, filters.organizationId)];
  if (filters.status) conditions.push(eq(renewals.status, filters.status));

  const rows = await db
    .select({
      id: renewals.id,
      contractId: renewals.contractId,
      contractNumber: contracts.contractNumber,
      tenantName: tenants.displayName,
      propertyName: properties.nameEn,
      propertyId: contracts.propertyId,
      unitNumber: units.unitNumber,
      status: renewals.status,
      noticeDueDate: renewals.noticeDueDate,
      currentRent: renewals.currentRent,
      proposedRent: renewals.proposedRent,
      marketRent: renewals.marketRent,
      agreedRent: renewals.agreedRent,
      probability: renewals.probability,
    })
    .from(renewals)
    .innerJoin(contracts, eq(contracts.id, renewals.contractId))
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .innerJoin(properties, eq(properties.id, contracts.propertyId))
    .innerJoin(units, eq(units.id, contracts.unitId))
    .where(and(...conditions))
    .orderBy(asc(renewals.noticeDueDate));

  return rows
    .filter((row) => !filters.allowedPropertyIds?.length || filters.allowedPropertyIds.includes(row.propertyId))
    .map((row) => ({
      id: row.id,
      contractId: row.contractId,
      contractNumber: row.contractNumber,
      tenantName: row.tenantName,
      propertyName: row.propertyName,
      unitNumber: row.unitNumber,
      status: row.status,
      noticeDueDate: row.noticeDueDate,
      currentRent: round2(Number(row.currentRent)),
      proposedRent: row.proposedRent !== null ? round2(Number(row.proposedRent)) : null,
      marketRent: row.marketRent !== null ? round2(Number(row.marketRent)) : null,
      agreedRent: row.agreedRent !== null ? round2(Number(row.agreedRent)) : null,
      probability: row.probability,
    }));
}

/** Pipeline grouped by status, for the /renewals kanban-style board. */
export async function getRenewalPipeline(
  filters: RenewalListFilters,
): Promise<Record<RenewalStatus, RenewalListItem[]>> {
  const items = await listRenewals(filters);
  const grouped: Record<RenewalStatus, RenewalListItem[]> = {
    pending: [],
    in_discussion: [],
    offer_sent: [],
    renewed: [],
    not_renewed: [],
    declined: [],
  };
  for (const item of items) {
    (grouped[item.status as RenewalStatus] ??= []).push(item);
  }
  return grouped;
}

export async function getRenewalById(organizationId: string, renewalId: string) {
  const db = await getDb();
  const [row] = await db
    .select({
      renewal: renewals,
      contractNumber: contracts.contractNumber,
      contractStatus: contracts.status,
      contractEndDate: contracts.endDate,
      tenantName: tenants.displayName,
      propertyName: properties.nameEn,
      propertyId: contracts.propertyId,
      unitId: contracts.unitId,
      unitNumber: units.unitNumber,
    })
    .from(renewals)
    .innerJoin(contracts, eq(contracts.id, renewals.contractId))
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .innerJoin(properties, eq(properties.id, contracts.propertyId))
    .innerJoin(units, eq(units.id, contracts.unitId))
    .where(and(eq(renewals.id, renewalId), eq(renewals.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

/**
 * Idempotent by design: returns the existing non-terminal renewal for the
 * contract instead of creating a duplicate (safe for repeated cron execution).
 */
export async function createRenewalFromContract(
  actor: Actor,
  contractId: string,
): Promise<{ id: string; created: boolean }> {
  const db = await getDb();

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: renewals.id, status: renewals.status })
      .from(renewals)
      .where(and(eq(renewals.contractId, contractId), eq(renewals.organizationId, actor.organizationId)))
      .orderBy(desc(renewals.createdAt))
      .limit(1);
    if (existing && !isTerminal(existing.status)) {
      return { id: existing.id, created: false };
    }

    const eligibility = await isContractRenewalEligible(actor.organizationId, contractId, tx);
    if (!eligibility.eligible) {
      throw businessRuleViolation('RENEWAL-ELIGIBILITY', eligibility.reason ?? 'This contract is not eligible for renewal.');
    }

    const [contract] = await tx.select().from(contracts).where(eq(contracts.id, contractId)).limit(1);
    if (!contract) throw notFound('Contract', contractId);

    const [created] = await tx
      .insert(renewals)
      .values({
        organizationId: actor.organizationId,
        contractId,
        noticeDueDate: contract.endDate,
        status: 'pending',
        currentRent: contract.annualRent,
        probability: contract.renewalProbability,
        ownerUserId: actor.id,
      })
      .returning({ id: renewals.id });

    await tx
      .update(contracts)
      .set({ renewalStatus: 'in_progress', updatedAt: new Date() })
      .where(eq(contracts.id, contractId));

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'create',
      entityType: 'renewal',
      entityId: created.id,
      entityLabel: contract.contractNumber,
      newValue: { contractId, currentRent: contract.annualRent },
      actor: actor.id ? { id: actor.id, fullName: actor.fullName } : undefined,
    });

    return { id: created.id, created: true };
  });
}

export interface RenewalProposalInput {
  proposedRent?: number;
  marketRent?: number;
  probability?: number;
  notes?: string;
}

export async function updateRenewalProposal(
  actor: Actor,
  renewalId: string,
  input: RenewalProposalInput,
): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [renewal] = await tx
      .select()
      .from(renewals)
      .where(and(eq(renewals.id, renewalId), eq(renewals.organizationId, actor.organizationId)))
      .limit(1);
    if (!renewal) throw notFound('Renewal', renewalId);
    if (isTerminal(renewal.status)) {
      throw validationError('This renewal has already reached a final outcome and cannot be modified.');
    }

    const nextStatus = renewal.status === 'pending' && input.proposedRent !== undefined ? 'in_discussion' : renewal.status;

    await tx
      .update(renewals)
      .set({
        proposedRent: input.proposedRent !== undefined ? round2(input.proposedRent) : renewal.proposedRent,
        marketRent: input.marketRent !== undefined ? round2(input.marketRent) : renewal.marketRent,
        probability: input.probability ?? renewal.probability,
        notes: input.notes !== undefined ? input.notes : renewal.notes,
        status: nextStatus,
        updatedAt: new Date(),
      })
      .where(eq(renewals.id, renewalId));

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'renewal',
      entityId: renewalId,
      previousValue: { proposedRent: renewal.proposedRent, marketRent: renewal.marketRent },
      newValue: { proposedRent: input.proposedRent, marketRent: input.marketRent },
      actor: actor.id ? { id: actor.id, fullName: actor.fullName } : undefined,
    });
  });
}

/** Whether the current proposal on a renewal needs internal approval before an offer can be sent. */
export async function renewalRequiresApproval(organizationId: string, renewalId: string): Promise<boolean> {
  const db = await getDb();
  const [renewal] = await db.select().from(renewals).where(eq(renewals.id, renewalId)).limit(1);
  if (!renewal || renewal.proposedRent === null) return false;
  const policy = await getPolicy(organizationId);
  return requiresRentApproval(Number(renewal.currentRent), Number(renewal.proposedRent), policy.defaultRenewalEscalationPercent);
}

/** Internal sign-off on a rent change that exceeds the configured tolerance (permission-gated by the caller). */
export async function approveRenewal(actor: Actor, renewalId: string, notes?: string): Promise<void> {
  const db = await getDb();
  const policy = await getPolicy(actor.organizationId);

  await db.transaction(async (tx) => {
    const [renewal] = await tx
      .select()
      .from(renewals)
      .where(and(eq(renewals.id, renewalId), eq(renewals.organizationId, actor.organizationId)))
      .limit(1);
    if (!renewal) throw notFound('Renewal', renewalId);
    if (isTerminal(renewal.status)) throw validationError('This renewal has already reached a final outcome.');
    if (renewal.proposedRent === null) throw validationError('Set a proposed rent before requesting approval.');
    if (!requiresRentApproval(Number(renewal.currentRent), Number(renewal.proposedRent), policy.defaultRenewalEscalationPercent)) {
      throw validationError('This rent change is within the auto-approved tolerance and does not require approval.');
    }

    await tx
      .update(renewals)
      .set({ agreedRent: renewal.proposedRent, notes: notes ?? renewal.notes, updatedAt: new Date() })
      .where(eq(renewals.id, renewalId));

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'approve',
      entityType: 'renewal',
      entityId: renewalId,
      newValue: { agreedRent: renewal.proposedRent },
      reason: notes,
      actor: actor.id ? { id: actor.id, fullName: actor.fullName } : undefined,
    });
  });
}

/** Sends the renewal offer to the tenant. Blocks if a required approval has not happened yet. */
export async function sendRenewalOffer(actor: Actor, renewalId: string): Promise<void> {
  const db = await getDb();
  const policy = await getPolicy(actor.organizationId);

  await db.transaction(async (tx) => {
    const [renewal] = await tx
      .select()
      .from(renewals)
      .where(and(eq(renewals.id, renewalId), eq(renewals.organizationId, actor.organizationId)))
      .limit(1);
    if (!renewal) throw notFound('Renewal', renewalId);
    if (renewal.status !== 'pending' && renewal.status !== 'in_discussion') {
      throw validationError('An offer can only be sent while the renewal is in discussion.');
    }
    if (renewal.proposedRent === null) throw validationError('Set a proposed rent before sending an offer.');

    const needsApproval = requiresRentApproval(
      Number(renewal.currentRent),
      Number(renewal.proposedRent),
      policy.defaultRenewalEscalationPercent,
    );
    if (needsApproval && renewal.agreedRent === null) {
      throw businessRuleViolation(
        'RENEWAL-APPROVAL-REQUIRED',
        'This rent change exceeds the auto-approved tolerance and must be approved before an offer can be sent.',
      );
    }

    await tx
      .update(renewals)
      .set({
        status: 'offer_sent',
        agreedRent: renewal.agreedRent ?? renewal.proposedRent,
        updatedAt: new Date(),
      })
      .where(eq(renewals.id, renewalId));

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'renewal',
      entityId: renewalId,
      newValue: { status: 'offer_sent' },
      actor: actor.id ? { id: actor.id, fullName: actor.fullName } : undefined,
    });
  });
}

/** Tenant accepts or declines the sent offer. Acceptance never bypasses a required approval —
 *  by the time an offer exists, `agreedRent` is already settled (see {@link sendRenewalOffer}). */
export async function recordTenantRenewalDecision(
  actor: Actor,
  renewalId: string,
  decision: 'accept' | 'decline',
  reason?: string,
): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [renewal] = await tx
      .select()
      .from(renewals)
      .where(and(eq(renewals.id, renewalId), eq(renewals.organizationId, actor.organizationId)))
      .limit(1);
    if (!renewal) throw notFound('Renewal', renewalId);
    if (renewal.status !== 'offer_sent') {
      throw validationError('A tenant decision can only be recorded once an offer has been sent.');
    }

    await tx
      .update(renewals)
      .set({
        status: decision === 'decline' ? 'declined' : renewal.status,
        decidedAt: new Date(),
        notes: reason ? [renewal.notes, reason].filter(Boolean).join('\n') : renewal.notes,
        updatedAt: new Date(),
      })
      .where(eq(renewals.id, renewalId));

    if (decision === 'decline') {
      await tx
        .update(contracts)
        .set({ renewalStatus: 'not_started', updatedAt: new Date() })
        .where(eq(contracts.id, renewal.contractId));
    }

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'renewal',
      entityId: renewalId,
      newValue: { decision, reason },
      reason,
      actor: actor.id ? { id: actor.id, fullName: actor.fullName } : undefined,
    });
  });
}

export async function declineRenewal(actor: Actor, renewalId: string, reason?: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [renewal] = await tx
      .select()
      .from(renewals)
      .where(and(eq(renewals.id, renewalId), eq(renewals.organizationId, actor.organizationId)))
      .limit(1);
    if (!renewal) throw notFound('Renewal', renewalId);
    if (isTerminal(renewal.status)) throw validationError('This renewal has already reached a final outcome.');

    await tx
      .update(renewals)
      .set({
        status: 'declined',
        decidedAt: new Date(),
        notes: reason ? [renewal.notes, reason].filter(Boolean).join('\n') : renewal.notes,
        updatedAt: new Date(),
      })
      .where(eq(renewals.id, renewalId));

    await tx
      .update(contracts)
      .set({ renewalStatus: 'not_started', updatedAt: new Date() })
      .where(eq(contracts.id, renewal.contractId));

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'renewal',
      entityId: renewalId,
      newValue: { status: 'declined' },
      reason,
      actor: actor.id ? { id: actor.id, fullName: actor.fullName } : undefined,
    });
  });
}

/** The organization decides not to pursue renewal, independent of a tenant response. Preserves the original contract untouched. */
export async function markNotRenewed(actor: Actor, renewalId: string, reason?: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [renewal] = await tx
      .select()
      .from(renewals)
      .where(and(eq(renewals.id, renewalId), eq(renewals.organizationId, actor.organizationId)))
      .limit(1);
    if (!renewal) throw notFound('Renewal', renewalId);
    if (isTerminal(renewal.status)) throw validationError('This renewal has already reached a final outcome.');

    await tx
      .update(renewals)
      .set({ status: 'not_renewed', decidedAt: new Date(), notes: reason ?? renewal.notes, updatedAt: new Date() })
      .where(eq(renewals.id, renewalId));

    await tx
      .update(contracts)
      .set({ renewalStatus: 'not_renewed', updatedAt: new Date() })
      .where(eq(contracts.id, renewal.contractId));

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'renewal',
      entityId: renewalId,
      newValue: { status: 'not_renewed' },
      reason,
      actor: actor.id ? { id: actor.id, fullName: actor.fullName } : undefined,
    });
  });
}

export interface GenerateRenewedContractInput {
  startDate: string;
  endDate: string;
  paymentFrequency?: 'monthly' | 'quarterly' | 'semi_annual' | 'annual';
  depositAmount?: number;
}

async function nextContractNumber(tx: DbExecutor, organizationId: string): Promise<string> {
  const { count } = await import('drizzle-orm');
  const [{ total }] = await tx.select({ total: count() }).from(contracts).where(eq(contracts.organizationId, organizationId));
  const year = new Date().getUTCFullYear();
  return `LC-${year}-${String(Number(total) + 1).padStart(4, '0')}`;
}

/**
 * Generates the renewed contract once the tenant has accepted and the rent is
 * settled. Runs the same BR-003 overlap check as `createContract`, excluding
 * the contract being renewed itself, all inside one transaction (BR-003 is
 * also enforced at the database level as a backstop).
 */
export async function generateRenewedContract(
  actor: Actor,
  renewalId: string,
  input: GenerateRenewedContractInput,
): Promise<{ id: string; contractNumber: string }> {
  if (new Date(input.endDate) <= new Date(input.startDate)) {
    throw validationError('The contract end date must be after the start date.');
  }

  const db = await getDb();
  const policy = await getPolicy(actor.organizationId);

  return db.transaction(async (tx) => {
    const [renewal] = await tx
      .select()
      .from(renewals)
      .where(and(eq(renewals.id, renewalId), eq(renewals.organizationId, actor.organizationId)))
      .limit(1);
    if (!renewal) throw notFound('Renewal', renewalId);
    if (renewal.newContractId) {
      throw validationError('A renewed contract has already been generated for this renewal.');
    }
    if (renewal.status !== 'offer_sent' || !renewal.decidedAt || renewal.agreedRent === null) {
      throw businessRuleViolation(
        'RENEWAL-NOT-READY',
        'The tenant must accept a settled offer before the renewed contract can be generated.',
      );
    }

    const [original] = await tx.select().from(contracts).where(eq(contracts.id, renewal.contractId)).limit(1);
    if (!original) throw notFound('Contract', renewal.contractId);
    if (!['signed', 'active'].includes(original.status) || original.terminatedAt) {
      throw businessRuleViolation('RENEWAL-NOT-READY', 'The original contract is no longer active.');
    }
    if (new Date(input.startDate) <= new Date(original.endDate)) {
      throw businessRuleViolation(
        'BR-003',
        'The renewed contract must start after the original contract ends.',
      );
    }

    // BR-003 overlap check, excluding the contract being renewed.
    const { lte, gte } = await import('drizzle-orm');
    const overlapping = await tx
      .select({ contractNumber: contracts.contractNumber })
      .from(contracts)
      .where(
        and(
          eq(contracts.unitId, original.unitId),
          eq(contracts.isActive, true),
          isNull(contracts.deletedAt),
          ne(contracts.id, original.id),
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

    const durationMonths =
      (new Date(input.endDate).getUTCFullYear() - new Date(input.startDate).getUTCFullYear()) * 12 +
      (new Date(input.endDate).getUTCMonth() - new Date(input.startDate).getUTCMonth()) +
      1;
    const area = Number(original.leasableArea ?? 0);
    const agreedRent = Number(renewal.agreedRent);
    const contractNumber = await nextContractNumber(tx, actor.organizationId);

    const [created] = await tx
      .insert(contracts)
      .values({
        organizationId: actor.organizationId,
        contractNumber,
        tenantId: original.tenantId,
        lessorName: original.lessorName,
        propertyId: original.propertyId,
        buildingId: original.buildingId,
        unitId: original.unitId,
        startDate: input.startDate,
        endDate: input.endDate,
        durationMonths,
        leasableArea: original.leasableArea,
        annualRent: round2(agreedRent),
        rentPerSqm: area > 0 ? round2(agreedRent / area) : null,
        paymentFrequency: input.paymentFrequency ?? original.paymentFrequency,
        depositAmount: round2(input.depositAmount ?? Number(original.depositAmount)),
        vatRateBps: Math.round(policy.vatRatePercent * 100),
        serviceCharges: original.serviceCharges,
        escalationPercent: original.escalationPercent,
        gracePeriodDays: original.gracePeriodDays,
        fitOutPeriodDays: original.fitOutPeriodDays,
        specialConditions: original.specialConditions,
        status: 'draft',
        isActive: false,
        renewedFromContractId: original.id,
        createdByUserId: actor.id,
      })
      .returning({ id: contracts.id });

    await tx.insert(contractVersions).values({
      contractId: created.id,
      version: 1,
      snapshot: { renewedFromContractId: original.id, renewalId, annualRent: agreedRent, startDate: input.startDate, endDate: input.endDate },
      changeReason: `Renewed from contract ${original.contractNumber}.`,
      createdByUserId: actor.id,
    });

    await tx
      .update(renewals)
      .set({ newContractId: created.id, status: 'renewed', updatedAt: new Date() })
      .where(eq(renewals.id, renewalId));

    await tx
      .update(contracts)
      .set({ renewalStatus: 'renewed', updatedAt: new Date() })
      .where(eq(contracts.id, original.id));

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'create',
      entityType: 'contract',
      entityId: created.id,
      entityLabel: contractNumber,
      newValue: { renewedFromContractId: original.id, annualRent: agreedRent },
      actor: actor.id ? { id: actor.id, fullName: actor.fullName } : undefined,
    });
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'renewal',
      entityId: renewalId,
      newValue: { status: 'renewed', newContractId: created.id },
      actor: actor.id ? { id: actor.id, fullName: actor.fullName } : undefined,
    });

    return { id: created.id, contractNumber };
  });
}
