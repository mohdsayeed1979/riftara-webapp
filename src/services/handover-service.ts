import 'server-only';
import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { contracts, handovers, invoices, properties, tenants, unitStatuses, units } from '@/db/schema';
import { recordAudit } from '@/lib/audit';
import { notFound, validationError, businessRuleViolation } from '@/lib/errors';
import { computeUnitAvailability } from './availability-service';
import { getPolicy } from '@/lib/settings';
import { round2 } from '@/lib/utils';
import type { DbExecutor } from '@/db/types';

type Actor = { id: string | null; organizationId: string; fullName: string };

/**
 * Handover service (Phase 17 — move-in / move-out checklist and settlement).
 * Operates entirely on the existing `handovers` table — no schema changes.
 */

const TERMINAL_STATUSES = ['completed', 'cancelled'] as const;
function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export interface OutstandingBalance {
  totalBilled: number;
  totalPaid: number;
  outstanding: number;
}

/** Outstanding balance for the contract being handed over. Never a new table — reads existing invoices. */
export async function getOutstandingBalance(
  organizationId: string,
  contractId: string,
  executor?: DbExecutor,
): Promise<OutstandingBalance> {
  const db = executor ?? (await getDb());
  const rows = await db
    .select({ totalAmount: invoices.totalAmount, paidAmount: invoices.paidAmount, balanceAmount: invoices.balanceAmount })
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        eq(invoices.contractId, contractId),
        ne(invoices.status, 'cancelled'),
        ne(invoices.status, 'waived'),
      ),
    );

  const totalBilled = rows.reduce((sum, r) => sum + Number(r.totalAmount), 0);
  const totalPaid = rows.reduce((sum, r) => sum + Number(r.paidAmount), 0);
  const outstanding = rows.reduce((sum, r) => sum + Number(r.balanceAmount), 0);

  return { totalBilled: round2(totalBilled), totalPaid: round2(totalPaid), outstanding: round2(outstanding) };
}

export interface HandoverListItem {
  id: string;
  contractId: string;
  contractNumber: string;
  tenantName: string;
  propertyName: string;
  unitNumber: string;
  handoverType: string;
  status: string;
  unitReady: boolean;
  createdAt: Date;
}

export interface HandoverListFilters {
  organizationId: string;
  allowedPropertyIds?: string[] | null;
  status?: string;
}

export async function listHandovers(filters: HandoverListFilters): Promise<HandoverListItem[]> {
  const db = await getDb();
  const conditions = [eq(handovers.organizationId, filters.organizationId)];
  if (filters.status) conditions.push(eq(handovers.status, filters.status));

  const rows = await db
    .select({
      id: handovers.id,
      contractId: handovers.contractId,
      contractNumber: contracts.contractNumber,
      tenantName: tenants.displayName,
      propertyName: properties.nameEn,
      propertyId: contracts.propertyId,
      unitNumber: units.unitNumber,
      handoverType: handovers.handoverType,
      status: handovers.status,
      unitReady: handovers.unitReady,
      createdAt: handovers.createdAt,
    })
    .from(handovers)
    .innerJoin(contracts, eq(contracts.id, handovers.contractId))
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .innerJoin(properties, eq(properties.id, contracts.propertyId))
    .innerJoin(units, eq(units.id, handovers.unitId))
    .where(and(...conditions))
    .orderBy(desc(handovers.createdAt));

  return rows
    .filter((row) => !filters.allowedPropertyIds?.length || filters.allowedPropertyIds.includes(row.propertyId))
    .map(({ propertyId: _propertyId, ...row }) => row);
}

export async function getHandover(organizationId: string, handoverId: string) {
  const db = await getDb();
  const [row] = await db
    .select({
      handover: handovers,
      contractNumber: contracts.contractNumber,
      contractStatus: contracts.status,
      tenantName: tenants.displayName,
      propertyName: properties.nameEn,
      unitNumber: units.unitNumber,
    })
    .from(handovers)
    .innerJoin(contracts, eq(contracts.id, handovers.contractId))
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .innerJoin(properties, eq(properties.id, contracts.propertyId))
    .innerJoin(units, eq(units.id, handovers.unitId))
    .where(and(eq(handovers.id, handoverId), eq(handovers.organizationId, organizationId)))
    .limit(1);
  if (!row) return null;
  const balance = await getOutstandingBalance(organizationId, row.handover.contractId);
  return { ...row, balance };
}

export interface InitiateHandoverInput {
  contractId: string;
  handoverType: 'handover' | 'move_out';
}

/** Idempotent: returns the existing open handover of the same type for the contract instead of duplicating it. */
export async function initiateHandover(
  actor: Actor,
  input: InitiateHandoverInput,
): Promise<{ id: string; created: boolean }> {
  const db = await getDb();

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: handovers.id, status: handovers.status })
      .from(handovers)
      .where(
        and(
          eq(handovers.contractId, input.contractId),
          eq(handovers.organizationId, actor.organizationId),
          eq(handovers.handoverType, input.handoverType),
        ),
      )
      .orderBy(desc(handovers.createdAt))
      .limit(1);
    if (existing && !isTerminal(existing.status)) {
      return { id: existing.id, created: false };
    }

    const [contract] = await tx
      .select({ id: contracts.id, unitId: contracts.unitId, status: contracts.status, deletedAt: contracts.deletedAt })
      .from(contracts)
      .where(and(eq(contracts.id, input.contractId), eq(contracts.organizationId, actor.organizationId)))
      .limit(1);
    if (!contract) throw notFound('Contract', input.contractId);
    if (contract.deletedAt) throw validationError('This contract has been deleted.');

    const [created] = await tx
      .insert(handovers)
      .values({
        organizationId: actor.organizationId,
        contractId: input.contractId,
        unitId: contract.unitId,
        handoverType: input.handoverType,
        status: 'pending',
      })
      .returning({ id: handovers.id });

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'create',
      entityType: 'handover',
      entityId: created.id,
      newValue: { contractId: input.contractId, handoverType: input.handoverType },
      actor: actor.id ? { id: actor.id, fullName: actor.fullName } : undefined,
    });

    return { id: created.id, created: true };
  });
}

export interface HandoverChecklistInput {
  contractSigned?: boolean;
  paymentReceived?: boolean;
  depositReceived?: boolean;
  unitReady?: boolean;
  keysHandedOver?: number;
  accessCards?: number;
  parkingCards?: number;
  electricityMeterReading?: string;
  waterMeterReading?: string;
}

export async function updateHandoverChecklist(
  actor: Actor,
  handoverId: string,
  input: HandoverChecklistInput,
): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [handover] = await tx
      .select()
      .from(handovers)
      .where(and(eq(handovers.id, handoverId), eq(handovers.organizationId, actor.organizationId)))
      .limit(1);
    if (!handover) throw notFound('Handover', handoverId);
    if (isTerminal(handover.status)) throw validationError('This handover has already reached a final outcome.');

    const next = { ...handover, ...input };
    const balance = await getOutstandingBalance(actor.organizationId, handover.contractId, tx);
    const ready =
      next.contractSigned && next.paymentReceived && next.depositReceived && next.unitReady && balance.outstanding === 0;

    await tx
      .update(handovers)
      .set({ ...input, status: ready ? 'ready' : 'pending', updatedAt: new Date() })
      .where(eq(handovers.id, handoverId));

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'handover',
      entityId: handoverId,
      previousValue: {
        contractSigned: handover.contractSigned,
        paymentReceived: handover.paymentReceived,
        depositReceived: handover.depositReceived,
        unitReady: handover.unitReady,
      },
      newValue: input,
      actor: actor.id ? { id: actor.id, fullName: actor.fullName } : undefined,
    });
  });
}

export async function updateHandoverCondition(
  actor: Actor,
  handoverId: string,
  input: { unitCondition?: string; notes?: string },
): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [handover] = await tx
      .select()
      .from(handovers)
      .where(and(eq(handovers.id, handoverId), eq(handovers.organizationId, actor.organizationId)))
      .limit(1);
    if (!handover) throw notFound('Handover', handoverId);
    if (isTerminal(handover.status)) throw validationError('This handover has already reached a final outcome.');

    await tx
      .update(handovers)
      .set({
        unitCondition: input.unitCondition ?? handover.unitCondition,
        notes: input.notes ?? handover.notes,
        updatedAt: new Date(),
      })
      .where(eq(handovers.id, handoverId));

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'handover',
      entityId: handoverId,
      newValue: input,
      actor: actor.id ? { id: actor.id, fullName: actor.fullName } : undefined,
    });
  });
}

export async function attachHandoverDocuments(
  actor: Actor,
  handoverId: string,
  documentIds: string[],
): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [handover] = await tx
      .select()
      .from(handovers)
      .where(and(eq(handovers.id, handoverId), eq(handovers.organizationId, actor.organizationId)))
      .limit(1);
    if (!handover) throw notFound('Handover', handoverId);
    if (isTerminal(handover.status)) throw validationError('This handover has already reached a final outcome.');

    const merged = Array.from(new Set([...(handover.photoDocumentIds ?? []), ...documentIds]));
    await tx.update(handovers).set({ photoDocumentIds: merged, updatedAt: new Date() }).where(eq(handovers.id, handoverId));

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'handover',
      entityId: handoverId,
      newValue: { photoDocumentIds: merged },
      actor: actor.id ? { id: actor.id, fullName: actor.fullName } : undefined,
    });
  });
}

export interface HandoverCompletionCheck {
  canComplete: boolean;
  blockers: string[];
  balance: OutstandingBalance;
}

/** Read-only readiness check the UI polls to show exactly what is blocking completion. */
export async function validateHandoverCompletion(
  organizationId: string,
  handoverId: string,
): Promise<HandoverCompletionCheck> {
  const db = await getDb();
  const [handover] = await db
    .select()
    .from(handovers)
    .where(and(eq(handovers.id, handoverId), eq(handovers.organizationId, organizationId)))
    .limit(1);
  if (!handover) throw notFound('Handover', handoverId);

  const blockers: string[] = [];
  if (isTerminal(handover.status)) blockers.push('This handover has already reached a final outcome.');
  if (!handover.contractSigned) blockers.push('Contract signature is not confirmed.');
  if (!handover.paymentReceived) blockers.push('Payment has not been confirmed as received.');
  if (!handover.depositReceived) blockers.push('Deposit has not been confirmed as received.');
  if (!handover.unitReady) blockers.push('Unit is not marked ready.');

  const balance = await getOutstandingBalance(organizationId, handover.contractId);
  if (balance.outstanding > 0) {
    blockers.push(`Outstanding balance of ${balance.outstanding.toLocaleString()} must be cleared before completion.`);
  }

  return { canComplete: blockers.length === 0, blockers, balance };
}

/** Manager sign-off that the handover is ready, distinct from final completion. */
export async function approveHandover(actor: Actor, handoverId: string, notes?: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [handover] = await tx
      .select()
      .from(handovers)
      .where(and(eq(handovers.id, handoverId), eq(handovers.organizationId, actor.organizationId)))
      .limit(1);
    if (!handover) throw notFound('Handover', handoverId);
    if (isTerminal(handover.status)) throw validationError('This handover has already reached a final outcome.');

    await tx
      .update(handovers)
      .set({ status: 'ready', notes: notes ?? handover.notes, updatedAt: new Date() })
      .where(eq(handovers.id, handoverId));

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'approve',
      entityType: 'handover',
      entityId: handoverId,
      newValue: { status: 'ready' },
      reason: notes,
      actor: actor.id ? { id: actor.id, fullName: actor.fullName } : undefined,
    });
  });
}

/**
 * Finalizes the handover. Re-checks every condition — including the
 * outstanding balance — inside the transaction, so the UI's earlier read
 * cannot be bypassed by a stale client state. Only a `move_out` handover
 * releases the unit, and only when no OTHER active contract still holds it.
 */
export async function completeHandover(actor: Actor, handoverId: string): Promise<{ unitReleased: boolean }> {
  const db = await getDb();
  // Pre-warm the settings cache (org policy) before opening the transaction.
  // computeUnitAvailability() reads it via getPolicy(), which — on a cache
  // miss — opens its own DB query; PGlite has a single connection, so doing
  // that from inside an already-open transaction deadlocks the connection.
  await getPolicy(actor.organizationId);

  return db.transaction(async (tx) => {
    const [handover] = await tx
      .select()
      .from(handovers)
      .where(and(eq(handovers.id, handoverId), eq(handovers.organizationId, actor.organizationId)))
      .limit(1);
    if (!handover) throw notFound('Handover', handoverId);
    if (isTerminal(handover.status)) throw validationError('This handover has already been completed.');

    if (!handover.contractSigned || !handover.paymentReceived || !handover.depositReceived || !handover.unitReady) {
      throw businessRuleViolation('HANDOVER-INCOMPLETE', 'The handover checklist is not fully complete.');
    }

    const balanceRows = await tx
      .select({ balanceAmount: invoices.balanceAmount })
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, actor.organizationId),
          eq(invoices.contractId, handover.contractId),
          ne(invoices.status, 'cancelled'),
          ne(invoices.status, 'waived'),
        ),
      );
    const outstanding = round2(balanceRows.reduce((sum, r) => sum + Number(r.balanceAmount), 0));
    if (outstanding > 0) {
      throw businessRuleViolation(
        'HANDOVER-OUTSTANDING-BALANCE',
        `This handover cannot be completed while an outstanding balance of ${outstanding.toLocaleString()} remains.`,
      );
    }

    await tx
      .update(handovers)
      .set({ status: 'completed', completedAt: new Date(), completedByUserId: actor.id, updatedAt: new Date() })
      .where(eq(handovers.id, handoverId));

    let unitReleased = false;
    if (handover.handoverType === 'move_out') {
      const [otherActive] = await tx
        .select({ id: contracts.id })
        .from(contracts)
        .where(
          and(
            eq(contracts.unitId, handover.unitId),
            eq(contracts.isActive, true),
            isNull(contracts.deletedAt),
            ne(contracts.id, handover.contractId),
          ),
        )
        .limit(1);

      if (!otherActive) {
        const [availableStatus] = await tx
          .select({ id: unitStatuses.id })
          .from(unitStatuses)
          .where(and(eq(unitStatuses.organizationId, actor.organizationId), eq(unitStatuses.key, 'available')))
          .limit(1);
        if (availableStatus) {
          await tx.update(units).set({ statusId: availableStatus.id }).where(eq(units.id, handover.unitId));
          await computeUnitAvailability(tx, handover.unitId, actor.organizationId);
          unitReleased = true;
        }
      }
    }

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'handover',
      entityId: handoverId,
      newValue: { status: 'completed', unitReleased },
      actor: actor.id ? { id: actor.id, fullName: actor.fullName } : undefined,
    });

    return { unitReleased };
  });
}

/** Reference data for the handover UI (available contracts eligible for a move-out/handover). */
export async function getEligibleContractsForHandover(organizationId: string) {
  const db = await getDb();
  return db
    .select({ id: contracts.id, contractNumber: contracts.contractNumber, unitId: contracts.unitId })
    .from(contracts)
    .where(and(eq(contracts.organizationId, organizationId), inArray(contracts.status, ['signed', 'active']), isNull(contracts.deletedAt)));
}
