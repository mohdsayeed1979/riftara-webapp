import 'server-only';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { pricingApprovals, priceHistory, unitPricing, units } from '@/db/schema';
import { recordAudit } from '@/lib/audit';
import { notFound } from '@/lib/errors';
import { diffPricing, evaluatePricing, type PricingEvaluation } from '@/lib/calculations/pricing';
import { getPolicy } from '@/lib/settings';
import type { SessionUser } from '@/lib/auth/session';
import { round2 } from '@/lib/utils';

/**
 * Pricing service (BRD 16-18).
 *
 * BR-004: discounts beyond the configured tier require approval.
 * BR-005: every price change is written to the append-only price history.
 */

const PRICE_FIELDS = [
  'askingRent',
  'targetRent',
  'minimumRent',
  'approvedRent',
  'marketRent',
  'serviceCharges',
  'depositAmount',
  'parkingCharges',
  'otherCharges',
] as const;

export type PriceField = (typeof PRICE_FIELDS)[number];

export interface UpdatePricingInput {
  unitId: string;
  values: Partial<Record<PriceField, number>>;
  effectiveDate?: string;
  reason: string;
  approvalReference?: string;
  marketReference?: string;
}

export async function updateUnitPricing(
  actor: SessionUser,
  input: UpdatePricingInput,
): Promise<{ changes: number }> {
  const db = await getDb();

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(unitPricing)
      .where(eq(unitPricing.unitId, input.unitId))
      .limit(1);

    const currentValues = existing
      ? (Object.fromEntries(PRICE_FIELDS.map((field) => [field, existing[field] as number | null])) as Record<
          string,
          number | null
        >)
      : (Object.fromEntries(PRICE_FIELDS.map((field) => [field, null])) as Record<string, number | null>);

    const changes = diffPricing(currentValues, input.values, [...PRICE_FIELDS]);
    if (changes.length === 0) return { changes: 0 };

    const effectiveDate = input.effectiveDate ?? new Date().toISOString().slice(0, 10);

    // Recompute rent-per-sqm when the asking rent changes.
    const nextValues: Record<string, unknown> = { ...input.values, effectiveFrom: effectiveDate, updatedAt: new Date() };
    if (input.values.askingRent !== undefined) {
      const [unit] = await tx
        .select({ leasableArea: units.leasableArea })
        .from(units)
        .where(eq(units.id, input.unitId))
        .limit(1);
      const area = Number(unit?.leasableArea ?? 0);
      if (area > 0) nextValues.rentPerSqm = round2(input.values.askingRent / area);
      // Preserve the previous asking rent for reference.
      nextValues.previousRent = currentValues.askingRent;
    }

    if (existing) {
      await tx.update(unitPricing).set(nextValues).where(eq(unitPricing.unitId, input.unitId));
    } else {
      await tx.insert(unitPricing).values({ unitId: input.unitId, ...nextValues } as typeof unitPricing.$inferInsert);
    }

    // BR-005 — append every change to the immutable price history.
    await tx.insert(priceHistory).values(
      changes.map((change) => ({
        unitId: input.unitId,
        field: change.field,
        previousValue: change.previousValue,
        newValue: change.newValue,
        effectiveDate,
        changedByUserId: actor.id,
        reason: input.reason,
        approvalReference: input.approvalReference ?? null,
        marketReference: input.marketReference ?? null,
      })),
    );

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'unit_pricing',
      entityId: input.unitId,
      entityLabel: 'Unit pricing',
      previousValue: currentValues,
      newValue: input.values,
      reason: input.reason,
      approvalReference: input.approvalReference ?? null,
      actor: { id: actor.id, fullName: actor.fullName },
    });

    return { changes: changes.length };
  });
}

/** Evaluates a proposed rent against the approval tiers (BR-004). */
export async function evaluateProposedRent(
  organizationId: string,
  input: { unitId: string; requestedRent: number; contractTermMonths: number },
): Promise<PricingEvaluation & { askingRent: number }> {
  const db = await getDb();
  const policy = await getPolicy(organizationId);

  const [pricing] = await db
    .select({ askingRent: unitPricing.askingRent })
    .from(unitPricing)
    .where(eq(unitPricing.unitId, input.unitId))
    .limit(1);

  const askingRent = Number(pricing?.askingRent ?? 0);

  return {
    ...evaluatePricing(
      { askingRent, requestedRent: input.requestedRent, contractTermMonths: input.contractTermMonths },
      policy.approvalTiers,
      policy.minimumRentFloorPercent,
    ),
    askingRent,
  };
}

/** Creates a pricing exception approval request (BRD 18). */
export async function createPricingApproval(
  actor: SessionUser,
  input: {
    unitId: string;
    customerId?: string;
    proposalId?: string;
    requestedRent: number;
    contractTermMonths: number;
    justification: string;
  },
): Promise<{ id: string; reference: string }> {
  const db = await getDb();
  const evaluation = await evaluateProposedRent(actor.organizationId, input);

  return db.transaction(async (tx) => {
    const [unit] = await tx
      .select({ propertyId: units.propertyId })
      .from(units)
      .where(eq(units.id, input.unitId))
      .limit(1);
    if (!unit) throw notFound('Unit', input.unitId);

    const { count } = await import('drizzle-orm');
    const [{ total }] = await tx
      .select({ total: count() })
      .from(pricingApprovals)
      .where(eq(pricingApprovals.organizationId, actor.organizationId));
    const reference = `PA-${String(Number(total) + 1).padStart(5, '0')}`;

    const [created] = await tx
      .insert(pricingApprovals)
      .values({
        organizationId: actor.organizationId,
        reference,
        unitId: input.unitId,
        propertyId: unit.propertyId,
        customerId: input.customerId ?? null,
        proposalId: input.proposalId ?? null,
        askingPrice: evaluation.askingRent,
        requestedPrice: input.requestedRent,
        discountAmount: evaluation.discountAmount,
        discountPercent: evaluation.discountPercent,
        annualImpact: evaluation.annualImpact,
        contractTermMonths: input.contractTermMonths,
        totalContractValue: evaluation.totalContractValue,
        justification: input.justification,
        requiredRoleKey: evaluation.requiredRoleKey ?? 'executive',
        status: 'pending',
        requestedByUserId: actor.id,
      })
      .returning({ id: pricingApprovals.id });

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'create',
      entityType: 'pricing_approval',
      entityId: created.id,
      entityLabel: reference,
      newValue: { requestedRent: input.requestedRent, discountPercent: evaluation.discountPercent },
      actor: { id: actor.id, fullName: actor.fullName },
    });

    return { id: created.id, reference };
  });
}

export async function decidePricingApproval(
  actor: SessionUser,
  approvalId: string,
  decision: 'approved' | 'rejected' | 'returned',
  notes?: string,
): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [approval] = await tx
      .select()
      .from(pricingApprovals)
      .where(
        and(
          eq(pricingApprovals.id, approvalId),
          eq(pricingApprovals.organizationId, actor.organizationId),
        ),
      )
      .limit(1);
    if (!approval) throw notFound('Pricing approval', approvalId);

    await tx
      .update(pricingApprovals)
      .set({ status: decision, decidedByUserId: actor.id, decidedAt: new Date(), decisionNotes: notes ?? null })
      .where(eq(pricingApprovals.id, approvalId));

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: decision === 'approved' ? 'approve' : 'reject',
      entityType: 'pricing_approval',
      entityId: approvalId,
      entityLabel: approval.reference,
      previousValue: { status: approval.status },
      newValue: { status: decision },
      reason: notes,
      approvalReference: approval.reference,
      actor: { id: actor.id, fullName: actor.fullName },
    });
  });
}
