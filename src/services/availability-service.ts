import 'server-only';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { contracts, reservations, units, unitStatuses, workOrders } from '@/db/schema';
import type { DbExecutor } from '@/db/types';
import {
  matchAlternativeUnits,
  resolveAvailability,
  type AvailabilityFacts,
  type AvailabilityResult,
  type MatchCandidate,
  type MatchRequirement,
} from '@/lib/calculations/availability';
import { getPolicy } from '@/lib/settings';

/**
 * Availability engine (BRD 14).
 *
 * Gathers the contract, reservation and maintenance facts for a unit, runs the
 * pure resolver, and persists the derived class and available-from date so
 * dashboards and the website read a single indexed column.
 */

function toDate(value: string | Date | null): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

export async function computeUnitAvailability(
  executor: DbExecutor,
  unitId: string,
  organizationId: string,
): Promise<AvailabilityResult> {
  const policy = await getPolicy(organizationId);

  const [unit] = await executor
    .select({
      id: units.id,
      availabilityDate: units.availabilityDate,
      statusKey: unitStatuses.key,
      availabilityClass: unitStatuses.availabilityClass,
      blocksLeasing: unitStatuses.blocksLeasing,
      publishable: unitStatuses.publishable,
    })
    .from(units)
    .innerJoin(unitStatuses, eq(unitStatuses.id, units.statusId))
    .where(eq(units.id, unitId))
    .limit(1);

  if (!unit) {
    return {
      availabilityClass: 'not_available',
      availableFrom: null,
      isAvailableSoon: false,
      reason: 'Unit not found',
      publishable: false,
    };
  }

  const [activeContract] = await executor
    .select({
      endDate: contracts.endDate,
      noticeDate: contracts.noticeDate,
      expectedVacateDate: contracts.expectedVacateDate,
      status: contracts.status,
    })
    .from(contracts)
    .where(and(eq(contracts.unitId, unitId), eq(contracts.isActive, true), isNull(contracts.deletedAt)))
    .orderBy(desc(contracts.endDate))
    .limit(1);

  const [activeReservation] = await executor
    .select({ expiryDate: reservations.expiryDate })
    .from(reservations)
    .where(and(eq(reservations.unitId, unitId), eq(reservations.isActive, true)))
    .limit(1);

  const [blockingWorkOrder] = await executor
    .select({ completedAt: workOrders.completedAt, createdAt: workOrders.createdAt })
    .from(workOrders)
    .where(
      and(
        eq(workOrders.unitId, unitId),
        inArray(workOrders.maintenanceType, ['renovation', 'unit_turnaround']),
        inArray(workOrders.status, ['open', 'assigned', 'in_progress', 'pending']),
        isNull(workOrders.deletedAt),
      ),
    )
    .limit(1);

  const facts: AvailabilityFacts = {
    status: {
      key: unit.statusKey,
      availabilityClass: unit.availabilityClass as AvailabilityFacts['status']['availabilityClass'],
      blocksLeasing: unit.blocksLeasing,
      publishable: unit.publishable,
    },
    activeContract: activeContract
      ? {
          endDate: toDate(activeContract.endDate) as Date,
          noticeDate: toDate(activeContract.noticeDate),
          expectedVacateDate: toDate(activeContract.expectedVacateDate),
          terminated: activeContract.status === 'terminated',
        }
      : null,
    activeReservation: activeReservation
      ? { expiryDate: toDate(activeReservation.expiryDate) as Date }
      : null,
    blockingMaintenance: blockingWorkOrder
      ? { expectedCompletionDate: toDate(blockingWorkOrder.completedAt) }
      : null,
    administrativeBlockUntil: null,
    declaredAvailabilityDate: toDate(unit.availabilityDate),
  };

  const result = resolveAvailability(facts, {
    turnaroundDays: policy.turnaroundDays,
    availableSoonWindowDays: policy.availableSoonWindowDays,
  });

  await executor
    .update(units)
    .set({
      computedAvailabilityClass: result.availabilityClass,
      computedAvailableFrom: result.availableFrom
        ? result.availableFrom.toISOString().slice(0, 10)
        : null,
      availabilityComputedAt: new Date(),
    })
    .where(eq(units.id, unitId));

  return result;
}

/** Recomputes availability for every unit in a property (after bulk changes). */
export async function recomputePropertyAvailability(
  executor: DbExecutor,
  propertyId: string,
  organizationId: string,
): Promise<number> {
  const rows = await executor.select({ id: units.id }).from(units).where(eq(units.propertyId, propertyId));
  for (const row of rows) {
    await computeUnitAvailability(executor, row.id, organizationId);
  }
  return rows.length;
}

/**
 * Alternative unit matching (BRD 30). Returns available units scored against
 * the customer's requirement.
 */
export async function findAlternativeUnits(
  organizationId: string,
  requirement: MatchRequirement,
  options: { excludeUnitId?: string; limit?: number } = {},
) {
  const db = await getDb();
  const { properties } = await import('@/db/schema');
  const { unitPricing } = await import('@/db/schema');

  const rows = await db
    .select({
      unitId: units.id,
      unitCode: units.code,
      unitNumber: units.unitNumber,
      propertyId: units.propertyId,
      propertyName: properties.nameEn,
      districtId: properties.districtId,
      cityId: properties.cityId,
      unitTypeId: units.unitTypeId,
      usageType: units.usageType,
      leasableArea: units.leasableArea,
      askingRent: unitPricing.askingRent,
      availableFrom: units.computedAvailableFrom,
    })
    .from(units)
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .leftJoin(unitPricing, eq(unitPricing.unitId, units.id))
    .where(
      and(
        eq(units.organizationId, organizationId),
        eq(units.computedAvailabilityClass, 'available'),
        isNull(units.deletedAt),
      ),
    )
    .limit(400);

  const candidates: MatchCandidate[] = rows
    .filter((row) => row.unitId !== options.excludeUnitId)
    .map((row) => ({
      unitId: row.unitId,
      propertyId: row.propertyId,
      districtId: row.districtId,
      cityId: row.cityId,
      unitTypeId: row.unitTypeId,
      usageType: row.usageType,
      leasableArea: Number(row.leasableArea ?? 0),
      askingRent: Number(row.askingRent ?? 0),
      availableFrom: row.availableFrom ? new Date(row.availableFrom) : null,
    }));

  const matches = matchAlternativeUnits(requirement, candidates, options.limit ?? 8);
  const detailByUnitId = new Map(rows.map((row) => [row.unitId, row]));

  return matches.map((match) => {
    const detail = detailByUnitId.get(match.unitId);
    return {
      ...match,
      unitCode: detail?.unitCode ?? '',
      unitNumber: detail?.unitNumber ?? '',
      propertyName: detail?.propertyName ?? '',
    };
  });
}

/**
 * Expires reservations that have passed their expiry date and releases the
 * unit according to policy (BR-011). Safe to run repeatedly.
 */
export async function expireLapsedReservations(organizationId: string): Promise<number> {
  const db = await getDb();
  const policy = await getPolicy(organizationId);
  const today = new Date().toISOString().slice(0, 10);

  const lapsed = await db
    .select({ id: reservations.id, unitId: reservations.unitId })
    .from(reservations)
    .where(
      and(
        eq(reservations.organizationId, organizationId),
        eq(reservations.isActive, true),
        sql`${reservations.expiryDate} < ${today}`,
      ),
    );

  if (lapsed.length === 0) return 0;

  const [availableStatus] = await db
    .select({ id: unitStatuses.id })
    .from(unitStatuses)
    .where(and(eq(unitStatuses.organizationId, organizationId), eq(unitStatuses.key, 'available')))
    .limit(1);

  for (const reservation of lapsed) {
    await db.transaction(async (tx) => {
      await tx
        .update(reservations)
        .set({ status: 'expired', isActive: false, expiredAt: new Date() })
        .where(eq(reservations.id, reservation.id));

      if (policy.releaseUnitOnReservationExpiry && availableStatus) {
        await tx.update(units).set({ statusId: availableStatus.id }).where(eq(units.id, reservation.unitId));
      }

      await computeUnitAvailability(tx, reservation.unitId, organizationId);
    });
  }

  return lapsed.length;
}
