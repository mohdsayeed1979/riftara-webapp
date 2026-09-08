import 'server-only';
import { and, asc, count, desc, eq, ilike, isNull, or } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { buildings, contracts, customers, floors, leads, properties, reservations, units } from '@/db/schema';
import { recordAudit } from '@/lib/audit';
import { conflict, notFound, validationError } from '@/lib/errors';
import { computeUnitAvailability } from './availability-service';
import type { DbExecutor } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Reservation service (BRD 27). A reservation holds a unit for a customer until
 * a contract is drafted. BR-002 (one active reservation per unit) is enforced by
 * a partial unique index; this service adds a friendly pre-check. BR-011 expiry
 * lives in availability-service.expireLapsedReservations. The availability
 * engine (computeUnitAvailability) is authoritative — a new active reservation
 * makes the unit resolve to "reserved".
 */

export async function getReservationFormReferenceData(organizationId: string) {
  const db = await getDb();
  const [customerRows, leadRows, propertyRows, buildingRows, floorRows, unitRows] = await Promise.all([
    db.select({ id: customers.id, name: customers.fullNameEn, code: customers.code }).from(customers)
      .where(and(eq(customers.organizationId, organizationId), isNull(customers.deletedAt))).orderBy(asc(customers.fullNameEn)).limit(1000),
    db.select({ id: leads.id, code: leads.code, customerId: leads.customerId }).from(leads)
      .where(and(eq(leads.organizationId, organizationId), isNull(leads.deletedAt))).orderBy(desc(leads.createdAt)).limit(1000),
    db.select({ id: properties.id, name: properties.nameEn }).from(properties)
      .where(and(eq(properties.organizationId, organizationId), isNull(properties.deletedAt))).orderBy(asc(properties.nameEn)),
    db.select({ id: buildings.id, name: buildings.nameEn, propertyId: buildings.propertyId }).from(buildings)
      .where(and(eq(buildings.organizationId, organizationId), isNull(buildings.deletedAt))).orderBy(asc(buildings.code)),
    db.select({ id: floors.id, name: floors.nameEn, buildingId: floors.buildingId, level: floors.level }).from(floors)
      .where(and(eq(floors.organizationId, organizationId), isNull(floors.deletedAt))).orderBy(asc(floors.level)),
    db.select({ id: units.id, unitNumber: units.unitNumber, code: units.code, propertyId: units.propertyId, buildingId: units.buildingId, floorId: units.floorId, availabilityClass: units.computedAvailabilityClass }).from(units)
      .where(and(eq(units.organizationId, organizationId), isNull(units.deletedAt))).orderBy(asc(units.unitNumber)),
  ]);
  return { customers: customerRows, leads: leadRows, properties: propertyRows, buildings: buildingRows, floors: floorRows, units: unitRows };
}

async function nextReservationCode(executor: DbExecutor, organizationId: string): Promise<string> {
  const [{ total }] = await executor.select({ total: count() }).from(reservations).where(eq(reservations.organizationId, organizationId));
  return `RES-${String(Number(total) + 1).padStart(4, '0')}`;
}

export interface CreateReservationInput {
  customerId: string;
  leadId?: string | null;
  propertyId: string;
  unitId: string;
  reservationDate: string;
  expiryDate: string;
  reservationAmount?: number;
  paymentStatus?: string;
  terms?: string | null;
}

async function validateHierarchy(tx: DbExecutor, organizationId: string, input: { customerId: string; leadId?: string | null; propertyId: string; unitId: string }) {
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
    const [lead] = await tx.select({ id: leads.id }).from(leads)
      .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, organizationId), isNull(leads.deletedAt))).limit(1);
    if (!lead) throw validationError('The selected lead is not valid for this organization.');
  }
}

export async function createReservation(actor: SessionUser, input: CreateReservationInput): Promise<{ id: string }> {
  if (new Date(input.expiryDate) < new Date(input.reservationDate)) {
    throw validationError('The expiry date must be on or after the reservation date.');
  }
  const db = await getDb();
  const created = await db.transaction(async (tx) => {
    await validateHierarchy(tx, actor.organizationId, input);

    // Friendly BR-002 pre-check (the partial unique index is authoritative).
    const [activeExisting] = await tx.select({ code: reservations.code }).from(reservations)
      .where(and(eq(reservations.unitId, input.unitId), eq(reservations.isActive, true), isNull(reservations.deletedAt))).limit(1);
    if (activeExisting) {
      throw conflict('This unit already has an active reservation. Cancel or expire it before creating another.');
    }

    const code = await nextReservationCode(tx, actor.organizationId);
    const [row] = await tx
      .insert(reservations)
      .values({
        organizationId: actor.organizationId, // session org only — never client-supplied
        code,
        customerId: input.customerId,
        leadId: input.leadId ?? null,
        propertyId: input.propertyId,
        unitId: input.unitId,
        reservationDate: input.reservationDate,
        expiryDate: input.expiryDate,
        reservationAmount: input.reservationAmount ?? 0,
        paymentStatus: input.paymentStatus ?? 'unpaid',
        terms: input.terms ?? null,
        status: 'active',
        isActive: true,
        createdByUserId: actor.id,
      })
      .returning({ id: reservations.id });

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'create',
      entityType: 'reservation',
      entityId: row.id,
      entityLabel: code,
      newValue: { code, customerId: input.customerId, unitId: input.unitId, expiryDate: input.expiryDate },
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return row;
  });

  // Recompute availability after commit (engine reads policy on its own
  // connection, so it runs outside the transaction) — the unit becomes reserved.
  await computeUnitAvailability(db, input.unitId, actor.organizationId);
  return created;
}

export async function cancelReservation(actor: SessionUser, reservationId: string, reason?: string): Promise<{ id: string }> {
  const db = await getDb();
  const unitId = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(reservations)
      .where(and(eq(reservations.id, reservationId), eq(reservations.organizationId, actor.organizationId), isNull(reservations.deletedAt))).limit(1);
    if (!existing) throw notFound('Reservation', reservationId);
    if (existing.status === 'cancelled' || existing.status === 'expired' || existing.status === 'converted') {
      throw validationError(`This reservation is already ${existing.status} and cannot be cancelled.`);
    }

    await tx
      .update(reservations)
      .set({ status: 'cancelled', isActive: false, cancelledAt: new Date(), cancellationReason: reason ?? null, updatedAt: new Date() })
      .where(eq(reservations.id, reservationId));

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'reservation',
      entityId: reservationId,
      entityLabel: existing.code,
      previousValue: { status: existing.status },
      newValue: { status: 'cancelled', reason: reason ?? null },
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return existing.unitId;
  });

  // Releasing the reservation frees the unit — recompute availability.
  await computeUnitAvailability(db, unitId, actor.organizationId);
  return { id: reservationId };
}

export interface ReservationListFilters {
  organizationId: string;
  status?: string;
  propertyId?: string;
  search?: string;
  page: number;
  pageSize: number;
}

export async function listReservations(filters: ReservationListFilters) {
  const db = await getDb();
  const where = and(
    eq(reservations.organizationId, filters.organizationId),
    isNull(reservations.deletedAt),
    filters.status ? eq(reservations.status, filters.status as typeof reservations.$inferSelect.status) : undefined,
    filters.propertyId ? eq(reservations.propertyId, filters.propertyId) : undefined,
    filters.search
      ? or(ilike(reservations.code, `%${filters.search}%`), ilike(customers.fullNameEn, `%${filters.search}%`), ilike(units.unitNumber, `%${filters.search}%`))
      : undefined,
  );

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: reservations.id,
        code: reservations.code,
        customerName: customers.fullNameEn,
        propertyName: properties.nameEn,
        unitNumber: units.unitNumber,
        reservationDate: reservations.reservationDate,
        expiryDate: reservations.expiryDate,
        reservationAmount: reservations.reservationAmount,
        paymentStatus: reservations.paymentStatus,
        status: reservations.status,
      })
      .from(reservations)
      .innerJoin(customers, eq(customers.id, reservations.customerId))
      .innerJoin(properties, eq(properties.id, reservations.propertyId))
      .innerJoin(units, eq(units.id, reservations.unitId))
      .where(where)
      .orderBy(desc(reservations.reservationDate))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize),
    db.select({ total: count() }).from(reservations).innerJoin(customers, eq(customers.id, reservations.customerId)).innerJoin(units, eq(units.id, reservations.unitId)).where(where),
  ]);
  return { items: rows, total: Number(totalRow[0]?.total ?? 0) };
}

export async function getReservationDetail(organizationId: string, reservationId: string) {
  const db = await getDb();
  const [reservation] = await db
    .select({
      id: reservations.id,
      code: reservations.code,
      status: reservations.status,
      isActive: reservations.isActive,
      customerId: reservations.customerId,
      customerName: customers.fullNameEn,
      mobile: customers.mobile,
      email: customers.email,
      leadId: reservations.leadId,
      propertyId: reservations.propertyId,
      propertyName: properties.nameEn,
      unitId: reservations.unitId,
      unitNumber: units.unitNumber,
      unitCode: units.code,
      reservationDate: reservations.reservationDate,
      expiryDate: reservations.expiryDate,
      reservationAmount: reservations.reservationAmount,
      paymentStatus: reservations.paymentStatus,
      terms: reservations.terms,
      cancelledAt: reservations.cancelledAt,
      cancellationReason: reservations.cancellationReason,
      expiredAt: reservations.expiredAt,
    })
    .from(reservations)
    .innerJoin(customers, eq(customers.id, reservations.customerId))
    .innerJoin(properties, eq(properties.id, reservations.propertyId))
    .innerJoin(units, eq(units.id, reservations.unitId))
    .where(and(eq(reservations.id, reservationId), eq(reservations.organizationId, organizationId), isNull(reservations.deletedAt)))
    .limit(1);
  if (!reservation) return null;

  const [linkedContract] = await db
    .select({ id: contracts.id, contractNumber: contracts.contractNumber, status: contracts.status })
    .from(contracts)
    .where(and(eq(contracts.reservationId, reservationId), isNull(contracts.deletedAt)))
    .orderBy(desc(contracts.createdAt))
    .limit(1);

  return { reservation, contract: linkedContract ?? null };
}
