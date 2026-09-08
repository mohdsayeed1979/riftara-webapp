import 'server-only';
import { and, asc, count, desc, eq, ilike, isNull, or } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { customers, leads, pricingApprovals, properties, proposals, units } from '@/db/schema';
import { recordAudit } from '@/lib/audit';
import { notFound, validationError } from '@/lib/errors';
import { createPricingApproval, decidePricingApproval, evaluateProposedRent } from './pricing-service';
import { getPolicy } from '@/lib/settings';
import { round2 } from '@/lib/utils';
import type { DbExecutor } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Proposal service (BRD 31-33). Proposals carry the commercial offer for a unit
 * and route through the EXISTING pricing-approval engine (BR-004): submission
 * evaluates the rent, and when approval is required a pricing_approval is
 * created and linked. Versions are retained (supersedesId); status uses the
 * existing `proposal_status` enum. All mutations are org-scoped and audited.
 */

const RESERVABLE_STATUSES = ['approved', 'accepted'];

export async function getProposalFormReferenceData(organizationId: string) {
  const db = await getDb();
  const [customerRows, leadRows, propertyRows, unitRows] = await Promise.all([
    db.select({ id: customers.id, name: customers.fullNameEn, code: customers.code }).from(customers)
      .where(and(eq(customers.organizationId, organizationId), isNull(customers.deletedAt))).orderBy(asc(customers.fullNameEn)).limit(1000),
    db.select({ id: leads.id, code: leads.code, customerId: leads.customerId }).from(leads)
      .where(and(eq(leads.organizationId, organizationId), isNull(leads.deletedAt))).orderBy(desc(leads.createdAt)).limit(1000),
    db.select({ id: properties.id, name: properties.nameEn }).from(properties)
      .where(and(eq(properties.organizationId, organizationId), isNull(properties.deletedAt))).orderBy(asc(properties.nameEn)),
    db.select({ id: units.id, unitNumber: units.unitNumber, code: units.code, propertyId: units.propertyId, leasableArea: units.leasableArea }).from(units)
      .where(and(eq(units.organizationId, organizationId), isNull(units.deletedAt))).orderBy(asc(units.unitNumber)),
  ]);
  return { customers: customerRows, leads: leadRows, properties: propertyRows, units: unitRows };
}

async function nextProposalReference(executor: DbExecutor, organizationId: string): Promise<string> {
  const [{ total }] = await executor.select({ total: count() }).from(proposals).where(eq(proposals.organizationId, organizationId));
  return `PROP-${String(Number(total) + 1).padStart(4, '0')}`;
}

export interface ProposalWriteInput {
  leadId?: string | null;
  customerId: string;
  propertyId: string;
  unitId: string;
  leasableArea: number;
  annualRent: number;
  serviceCharges?: number;
  depositAmount?: number;
  contractDurationMonths: number;
  paymentTerms?: string;
  escalationPercent?: number;
  gracePeriodDays?: number;
  fitOutPeriodDays?: number;
  parkingSpaces?: number;
  utilitiesTerms?: string | null;
  specialTerms?: string | null;
  validUntil?: string | null;
}

async function validateRefs(tx: DbExecutor, organizationId: string, input: ProposalWriteInput) {
  const [customer] = await tx.select({ id: customers.id }).from(customers)
    .where(and(eq(customers.id, input.customerId), eq(customers.organizationId, organizationId), isNull(customers.deletedAt))).limit(1);
  if (!customer) throw notFound('Customer', input.customerId);
  const [property] = await tx.select({ id: properties.id }).from(properties)
    .where(and(eq(properties.id, input.propertyId), eq(properties.organizationId, organizationId), isNull(properties.deletedAt))).limit(1);
  if (!property) throw notFound('Property', input.propertyId);
  const [unit] = await tx.select({ id: units.id, propertyId: units.propertyId }).from(units)
    .where(and(eq(units.id, input.unitId), eq(units.organizationId, organizationId), isNull(units.deletedAt))).limit(1);
  if (!unit) throw notFound('Unit', input.unitId);
  if (unit.propertyId !== input.propertyId) throw validationError('The selected unit does not belong to the selected property.');
  if (input.leadId) {
    const [lead] = await tx.select({ id: leads.id, customerId: leads.customerId }).from(leads)
      .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, organizationId), isNull(leads.deletedAt))).limit(1);
    if (!lead) throw validationError('The selected lead is not valid for this organization.');
    if (lead.customerId !== input.customerId) throw validationError('The selected lead belongs to a different customer.');
  }
}

function computeDerived(input: ProposalWriteInput, vatRatePercent: number) {
  const rentPerSqm = input.leasableArea > 0 ? round2(input.annualRent / input.leasableArea) : 0;
  const vatAmount = round2((input.annualRent * vatRatePercent) / 100);
  const years = input.contractDurationMonths / 12;
  const serviceCharges = input.serviceCharges ?? 0;
  const totalContractValue = round2((input.annualRent + serviceCharges) * years);
  return { rentPerSqm, vatAmount, totalContractValue };
}

function proposalColumns(input: ProposalWriteInput, derived: ReturnType<typeof computeDerived>) {
  return {
    leadId: input.leadId ?? null,
    customerId: input.customerId,
    propertyId: input.propertyId,
    unitId: input.unitId,
    leasableArea: input.leasableArea,
    rentPerSqm: derived.rentPerSqm,
    annualRent: round2(input.annualRent),
    vatAmount: derived.vatAmount,
    serviceCharges: round2(input.serviceCharges ?? 0),
    depositAmount: round2(input.depositAmount ?? 0),
    contractDurationMonths: input.contractDurationMonths,
    paymentTerms: input.paymentTerms ?? 'quarterly',
    escalationPercent: input.escalationPercent ?? 0,
    gracePeriodDays: input.gracePeriodDays ?? 0,
    fitOutPeriodDays: input.fitOutPeriodDays ?? 0,
    parkingSpaces: input.parkingSpaces ?? 0,
    utilitiesTerms: input.utilitiesTerms ?? null,
    specialTerms: input.specialTerms ?? null,
    totalContractValue: derived.totalContractValue,
    validUntil: input.validUntil ?? null,
  };
}

export async function createProposal(actor: SessionUser, input: ProposalWriteInput): Promise<{ id: string }> {
  const db = await getDb();
  const policy = await getPolicy(actor.organizationId);
  return db.transaction(async (tx) => {
    await validateRefs(tx, actor.organizationId, input);
    const reference = await nextProposalReference(tx, actor.organizationId);
    const derived = computeDerived(input, policy.vatRatePercent);
    const [created] = await tx.insert(proposals).values({
      organizationId: actor.organizationId, reference, version: 1, status: 'draft', createdByUserId: actor.id, ...proposalColumns(input, derived),
    }).returning({ id: proposals.id });
    await recordAudit(tx, { organizationId: actor.organizationId, action: 'create', entityType: 'proposal', entityId: created.id, entityLabel: reference, newValue: { reference, annualRent: input.annualRent }, actor: { id: actor.id, fullName: actor.fullName } });
    return created;
  });
}

export async function updateProposal(actor: SessionUser, proposalId: string, input: ProposalWriteInput): Promise<{ id: string }> {
  const db = await getDb();
  const policy = await getPolicy(actor.organizationId);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(proposals)
      .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, actor.organizationId), isNull(proposals.deletedAt))).limit(1);
    if (!existing) throw notFound('Proposal', proposalId);
    if (existing.status !== 'draft') throw validationError('Only draft proposals can be edited. Create a new version instead.');
    await validateRefs(tx, actor.organizationId, input);
    const derived = computeDerived(input, policy.vatRatePercent);
    await tx.update(proposals).set({ ...proposalColumns(input, derived), updatedAt: new Date() }).where(eq(proposals.id, proposalId));
    await recordAudit(tx, { organizationId: actor.organizationId, action: 'update', entityType: 'proposal', entityId: proposalId, entityLabel: existing.reference, newValue: { annualRent: input.annualRent }, actor: { id: actor.id, fullName: actor.fullName } });
    return { id: proposalId };
  });
}

/** Submits a draft proposal for pricing approval (BR-004). Evaluates the rent
 *  via the existing pricing engine; if approval is required a pricing_approval
 *  is created and linked and the proposal goes to pending_approval, otherwise it
 *  is auto-approved. */
export async function submitProposalForApproval(actor: SessionUser, proposalId: string, justification?: string): Promise<{ status: string; requiresApproval: boolean }> {
  const db = await getDb();
  const [proposal] = await db.select().from(proposals)
    .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, actor.organizationId), isNull(proposals.deletedAt))).limit(1);
  if (!proposal) throw notFound('Proposal', proposalId);
  if (proposal.status !== 'draft') throw validationError('Only a draft proposal can be submitted for approval.');

  const evaluation = await evaluateProposedRent(actor.organizationId, {
    unitId: proposal.unitId,
    requestedRent: Number(proposal.annualRent),
    contractTermMonths: proposal.contractDurationMonths,
  });
  // Any discount requires approval (a below-floor request escalates to the
  // highest/executive tier — the existing pricing engine is authoritative).
  if (evaluation.requiresApproval) {
    const approval = await createPricingApproval(actor, {
      unitId: proposal.unitId,
      customerId: proposal.customerId,
      proposalId: proposal.id,
      requestedRent: Number(proposal.annualRent),
      contractTermMonths: proposal.contractDurationMonths,
      justification: justification ?? 'Proposal pricing approval request.',
    });
    await db.transaction(async (tx) => {
      await tx.update(proposals).set({ status: 'pending_approval', pricingApprovalId: approval.id, updatedAt: new Date() }).where(eq(proposals.id, proposalId));
      await recordAudit(tx, { organizationId: actor.organizationId, action: 'update', entityType: 'proposal', entityId: proposalId, entityLabel: proposal.reference, previousValue: { status: 'draft' }, newValue: { status: 'pending_approval', pricingApprovalId: approval.id }, actor: { id: actor.id, fullName: actor.fullName } });
    });
    return { status: 'pending_approval', requiresApproval: true };
  }

  await db.transaction(async (tx) => {
    await tx.update(proposals).set({ status: 'approved', updatedAt: new Date() }).where(eq(proposals.id, proposalId));
    await recordAudit(tx, { organizationId: actor.organizationId, action: 'approve', entityType: 'proposal', entityId: proposalId, entityLabel: proposal.reference, previousValue: { status: 'draft' }, newValue: { status: 'approved', requiresApproval: false }, actor: { id: actor.id, fullName: actor.fullName } });
  });
  return { status: 'approved', requiresApproval: false };
}

/** Approves or rejects a pending proposal, delegating the pricing decision to
 *  the existing pricing-approval service. */
export async function decideProposal(actor: SessionUser, proposalId: string, decision: 'approved' | 'rejected', notes?: string): Promise<{ id: string }> {
  const db = await getDb();
  const [proposal] = await db.select().from(proposals)
    .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, actor.organizationId), isNull(proposals.deletedAt))).limit(1);
  if (!proposal) throw notFound('Proposal', proposalId);
  if (proposal.status !== 'pending_approval') throw validationError('Only a proposal pending approval can be decided.');

  if (proposal.pricingApprovalId) {
    await decidePricingApproval(actor, proposal.pricingApprovalId, decision, notes);
  }
  await db.transaction(async (tx) => {
    await tx.update(proposals).set({ status: decision, respondedAt: new Date(), updatedAt: new Date() }).where(eq(proposals.id, proposalId));
    await recordAudit(tx, { organizationId: actor.organizationId, action: decision === 'approved' ? 'approve' : 'reject', entityType: 'proposal', entityId: proposalId, entityLabel: proposal.reference, previousValue: { status: 'pending_approval' }, newValue: { status: decision }, reason: notes, actor: { id: actor.id, fullName: actor.fullName } });
  });
  return { id: proposalId };
}

async function transition(actor: SessionUser, proposalId: string, from: string[], to: 'sent' | 'accepted', action: 'update'): Promise<{ id: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [proposal] = await tx.select({ id: proposals.id, reference: proposals.reference, status: proposals.status }).from(proposals)
      .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, actor.organizationId), isNull(proposals.deletedAt))).limit(1);
    if (!proposal) throw notFound('Proposal', proposalId);
    if (!from.includes(proposal.status)) throw validationError(`A ${proposal.status} proposal cannot move to ${to}.`);
    await tx.update(proposals).set({ status: to, sentAt: to === 'sent' ? new Date() : undefined, respondedAt: to === 'accepted' ? new Date() : undefined, updatedAt: new Date() }).where(eq(proposals.id, proposalId));
    await recordAudit(tx, { organizationId: actor.organizationId, action, entityType: 'proposal', entityId: proposalId, entityLabel: proposal.reference, previousValue: { status: proposal.status }, newValue: { status: to }, actor: { id: actor.id, fullName: actor.fullName } });
    return { id: proposalId };
  });
}
export const sendProposal = (actor: SessionUser, id: string) => transition(actor, id, ['approved'], 'sent', 'update');
export const acceptProposal = (actor: SessionUser, id: string) => transition(actor, id, ['approved', 'sent'], 'accepted', 'update');

/** Creates a new version of a proposal, superseding the current one (BRD 32). */
export async function createProposalVersion(actor: SessionUser, proposalId: string, input: ProposalWriteInput): Promise<{ id: string }> {
  const db = await getDb();
  const policy = await getPolicy(actor.organizationId);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(proposals)
      .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, actor.organizationId), isNull(proposals.deletedAt))).limit(1);
    if (!existing) throw notFound('Proposal', proposalId);
    await validateRefs(tx, actor.organizationId, input);
    const derived = computeDerived(input, policy.vatRatePercent);
    const [created] = await tx.insert(proposals).values({
      organizationId: actor.organizationId, reference: existing.reference, version: existing.version + 1, supersedesId: existing.id,
      status: 'draft', createdByUserId: actor.id, ...proposalColumns(input, derived),
    }).returning({ id: proposals.id });
    await tx.update(proposals).set({ status: 'superseded', updatedAt: new Date() }).where(eq(proposals.id, existing.id));
    await recordAudit(tx, { organizationId: actor.organizationId, action: 'create', entityType: 'proposal', entityId: created.id, entityLabel: `${existing.reference} v${existing.version + 1}`, previousValue: { supersedes: existing.id, version: existing.version }, newValue: { version: existing.version + 1 }, actor: { id: actor.id, fullName: actor.fullName } });
    return created;
  });
}

export function isProposalReservable(status: string): boolean {
  return RESERVABLE_STATUSES.includes(status);
}

export async function getProposalForEdit(organizationId: string, proposalId: string) {
  const db = await getDb();
  const [proposal] = await db.select().from(proposals)
    .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId), isNull(proposals.deletedAt))).limit(1);
  return proposal ?? null;
}

export async function getProposalDetail(organizationId: string, proposalId: string) {
  const db = await getDb();
  const [proposal] = await db
    .select({
      id: proposals.id, reference: proposals.reference, version: proposals.version, supersedesId: proposals.supersedesId, status: proposals.status,
      leadId: proposals.leadId, customerId: proposals.customerId, customerName: customers.fullNameEn,
      propertyId: proposals.propertyId, propertyName: properties.nameEn, unitId: proposals.unitId, unitNumber: units.unitNumber,
      leasableArea: proposals.leasableArea, rentPerSqm: proposals.rentPerSqm, annualRent: proposals.annualRent, vatAmount: proposals.vatAmount,
      serviceCharges: proposals.serviceCharges, depositAmount: proposals.depositAmount, contractDurationMonths: proposals.contractDurationMonths,
      paymentTerms: proposals.paymentTerms, escalationPercent: proposals.escalationPercent, gracePeriodDays: proposals.gracePeriodDays,
      fitOutPeriodDays: proposals.fitOutPeriodDays, parkingSpaces: proposals.parkingSpaces, utilitiesTerms: proposals.utilitiesTerms,
      specialTerms: proposals.specialTerms, totalContractValue: proposals.totalContractValue, validUntil: proposals.validUntil,
      pricingApprovalId: proposals.pricingApprovalId,
    })
    .from(proposals)
    .innerJoin(customers, eq(customers.id, proposals.customerId))
    .innerJoin(properties, eq(properties.id, proposals.propertyId))
    .innerJoin(units, eq(units.id, proposals.unitId))
    .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId), isNull(proposals.deletedAt)))
    .limit(1);
  if (!proposal) return null;
  let approval = null;
  if (proposal.pricingApprovalId) {
    [approval] = await db.select({ reference: pricingApprovals.reference, status: pricingApprovals.status, requiredRoleKey: pricingApprovals.requiredRoleKey, discountPercent: pricingApprovals.discountPercent, decisionNotes: pricingApprovals.decisionNotes })
      .from(pricingApprovals).where(eq(pricingApprovals.id, proposal.pricingApprovalId)).limit(1);
  }
  return { proposal, approval: approval ?? null };
}

export interface ProposalListFilters {
  organizationId: string;
  status?: string;
  propertyId?: string;
  search?: string;
  page: number;
  pageSize: number;
}

export async function listProposals(filters: ProposalListFilters) {
  const db = await getDb();
  const where = and(
    eq(proposals.organizationId, filters.organizationId),
    isNull(proposals.deletedAt),
    filters.status ? eq(proposals.status, filters.status as typeof proposals.$inferSelect.status) : undefined,
    filters.propertyId ? eq(proposals.propertyId, filters.propertyId) : undefined,
    filters.search ? or(ilike(proposals.reference, `%${filters.search}%`), ilike(customers.fullNameEn, `%${filters.search}%`)) : undefined,
  );
  const [rows, totalRow] = await Promise.all([
    db.select({
        id: proposals.id, reference: proposals.reference, version: proposals.version, customerName: customers.fullNameEn,
        propertyName: properties.nameEn, unitNumber: units.unitNumber, annualRent: proposals.annualRent, status: proposals.status,
        validUntil: proposals.validUntil, createdAt: proposals.createdAt,
      })
      .from(proposals)
      .innerJoin(customers, eq(customers.id, proposals.customerId))
      .innerJoin(properties, eq(properties.id, proposals.propertyId))
      .innerJoin(units, eq(units.id, proposals.unitId))
      .where(where)
      .orderBy(desc(proposals.createdAt))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize),
    db.select({ total: count() }).from(proposals).innerJoin(customers, eq(customers.id, proposals.customerId)).innerJoin(units, eq(units.id, proposals.unitId)).where(where),
  ]);
  return { items: rows, total: Number(totalRow[0]?.total ?? 0) };
}
