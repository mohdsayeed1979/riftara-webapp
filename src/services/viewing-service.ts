import 'server-only';
import { and, asc, count, desc, eq, ilike, isNull, or } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { buildings, customers, floors, leads, properties, units, users, viewingFeedback, viewings } from '@/db/schema';
import { recordAudit } from '@/lib/audit';
import { notFound, validationError } from '@/lib/errors';
import type { DbExecutor } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Viewing service (BRD 30). A viewing schedules a customer visit to a unit and,
 * on completion, records structured feedback (viewing_feedback, one row per
 * viewing). Every mutation is organization-scoped and audited. Statuses use the
 * existing `viewing_status` enum — scheduled | confirmed | completed | cancelled
 * | no_show | rescheduled.
 */

const OPEN_STATUSES = ['scheduled', 'confirmed', 'rescheduled'];

export async function getViewingFormReferenceData(organizationId: string) {
  const db = await getDb();
  const [customerRows, leadRows, propertyRows, buildingRows, floorRows, unitRows, agentRows] = await Promise.all([
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
    db.select({ id: units.id, unitNumber: units.unitNumber, code: units.code, propertyId: units.propertyId, buildingId: units.buildingId, floorId: units.floorId }).from(units)
      .where(and(eq(units.organizationId, organizationId), isNull(units.deletedAt))).orderBy(asc(units.unitNumber)),
    db.select({ id: users.id, name: users.fullName }).from(users)
      .where(and(eq(users.organizationId, organizationId), eq(users.isActive, true), isNull(users.deletedAt))).orderBy(asc(users.fullName)),
  ]);
  return { customers: customerRows, leads: leadRows, properties: propertyRows, buildings: buildingRows, floors: floorRows, units: unitRows, agents: agentRows };
}

async function nextViewingCode(executor: DbExecutor, organizationId: string): Promise<string> {
  const [{ total }] = await executor.select({ total: count() }).from(viewings).where(eq(viewings.organizationId, organizationId));
  return `VW-${String(Number(total) + 1).padStart(4, '0')}`;
}

export interface ViewingWriteInput {
  leadId?: string | null;
  customerId: string;
  propertyId: string;
  unitId?: string | null;
  assignedUserId?: string | null;
  meetingPoint?: string | null;
  scheduledDate: string;
  scheduledTime: string;
  notes?: string | null;
}

export interface ViewingFeedbackInput {
  interestLevel?: number | null;
  priceSuitability?: number | null;
  areaSuitability?: number | null;
  locationSuitability?: number | null;
  unitSuitability?: number | null;
  likelihoodToLease?: number | null;
  customerComments?: string | null;
  agentComments?: string | null;
  nextAction?: string | null;
}

async function validateRefs(tx: DbExecutor, organizationId: string, input: ViewingWriteInput) {
  const [customer] = await tx.select({ id: customers.id }).from(customers)
    .where(and(eq(customers.id, input.customerId), eq(customers.organizationId, organizationId), isNull(customers.deletedAt))).limit(1);
  if (!customer) throw notFound('Customer', input.customerId);

  const [property] = await tx.select({ id: properties.id }).from(properties)
    .where(and(eq(properties.id, input.propertyId), eq(properties.organizationId, organizationId), isNull(properties.deletedAt))).limit(1);
  if (!property) throw notFound('Property', input.propertyId);

  if (input.unitId) {
    const [unit] = await tx.select({ id: units.id, propertyId: units.propertyId }).from(units)
      .where(and(eq(units.id, input.unitId), eq(units.organizationId, organizationId), isNull(units.deletedAt))).limit(1);
    if (!unit) throw notFound('Unit', input.unitId);
    if (unit.propertyId !== input.propertyId) throw validationError('The selected unit does not belong to the selected property.');
  }
  if (input.leadId) {
    const [lead] = await tx.select({ id: leads.id, customerId: leads.customerId }).from(leads)
      .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, organizationId), isNull(leads.deletedAt))).limit(1);
    if (!lead) throw validationError('The selected lead is not valid for this organization.');
    if (lead.customerId !== input.customerId) throw validationError('The selected lead belongs to a different customer.');
  }
  if (input.assignedUserId) {
    const [agent] = await tx.select({ id: users.id }).from(users)
      .where(and(eq(users.id, input.assignedUserId), eq(users.organizationId, organizationId), isNull(users.deletedAt))).limit(1);
    if (!agent) throw validationError('The assigned agent is not valid for this organization.');
  }
}

function viewingValues(input: ViewingWriteInput) {
  return {
    leadId: input.leadId ?? null,
    customerId: input.customerId,
    propertyId: input.propertyId,
    unitId: input.unitId ?? null,
    assignedUserId: input.assignedUserId ?? null,
    meetingPoint: input.meetingPoint ?? null,
    scheduledDate: input.scheduledDate,
    scheduledTime: input.scheduledTime,
    notes: input.notes ?? null,
  };
}

export async function createViewing(actor: SessionUser, input: ViewingWriteInput): Promise<{ id: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    await validateRefs(tx, actor.organizationId, input);
    const code = await nextViewingCode(tx, actor.organizationId);
    const [created] = await tx.insert(viewings).values({ organizationId: actor.organizationId, code, ...viewingValues(input) }).returning({ id: viewings.id });
    await recordAudit(tx, { organizationId: actor.organizationId, action: 'create', entityType: 'viewing', entityId: created.id, entityLabel: code, newValue: { code, customerId: input.customerId, unitId: input.unitId ?? null }, actor: { id: actor.id, fullName: actor.fullName } });
    return created;
  });
}

export async function updateViewing(actor: SessionUser, viewingId: string, input: ViewingWriteInput): Promise<{ id: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: viewings.id, code: viewings.code, status: viewings.status }).from(viewings)
      .where(and(eq(viewings.id, viewingId), eq(viewings.organizationId, actor.organizationId), isNull(viewings.deletedAt))).limit(1);
    if (!existing) throw notFound('Viewing', viewingId);
    if (!OPEN_STATUSES.includes(existing.status)) throw validationError(`A ${existing.status} viewing cannot be edited.`);
    await validateRefs(tx, actor.organizationId, input);
    await tx.update(viewings).set({ ...viewingValues(input), updatedAt: new Date() }).where(eq(viewings.id, viewingId));
    await recordAudit(tx, { organizationId: actor.organizationId, action: 'update', entityType: 'viewing', entityId: viewingId, entityLabel: existing.code, newValue: input, actor: { id: actor.id, fullName: actor.fullName } });
    return { id: viewingId };
  });
}

export async function cancelViewing(actor: SessionUser, viewingId: string, reason?: string): Promise<{ id: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: viewings.id, code: viewings.code, status: viewings.status }).from(viewings)
      .where(and(eq(viewings.id, viewingId), eq(viewings.organizationId, actor.organizationId), isNull(viewings.deletedAt))).limit(1);
    if (!existing) throw notFound('Viewing', viewingId);
    if (!OPEN_STATUSES.includes(existing.status)) throw validationError(`A ${existing.status} viewing cannot be cancelled.`);
    await tx.update(viewings).set({ status: 'cancelled', notes: reason ?? undefined, updatedAt: new Date() }).where(eq(viewings.id, viewingId));
    await recordAudit(tx, { organizationId: actor.organizationId, action: 'update', entityType: 'viewing', entityId: viewingId, entityLabel: existing.code, previousValue: { status: existing.status }, newValue: { status: 'cancelled', reason: reason ?? null }, actor: { id: actor.id, fullName: actor.fullName } });
    return { id: viewingId };
  });
}

export async function completeViewing(actor: SessionUser, viewingId: string, feedback?: ViewingFeedbackInput): Promise<{ id: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: viewings.id, code: viewings.code, status: viewings.status }).from(viewings)
      .where(and(eq(viewings.id, viewingId), eq(viewings.organizationId, actor.organizationId), isNull(viewings.deletedAt))).limit(1);
    if (!existing) throw notFound('Viewing', viewingId);
    if (!OPEN_STATUSES.includes(existing.status)) throw validationError(`A ${existing.status} viewing cannot be completed.`);

    await tx.update(viewings).set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() }).where(eq(viewings.id, viewingId));

    if (feedback) {
      const [existingFeedback] = await tx.select({ id: viewingFeedback.id }).from(viewingFeedback).where(eq(viewingFeedback.viewingId, viewingId)).limit(1);
      const values = {
        interestLevel: feedback.interestLevel ?? null,
        priceSuitability: feedback.priceSuitability ?? null,
        areaSuitability: feedback.areaSuitability ?? null,
        locationSuitability: feedback.locationSuitability ?? null,
        unitSuitability: feedback.unitSuitability ?? null,
        likelihoodToLease: feedback.likelihoodToLease ?? null,
        customerComments: feedback.customerComments ?? null,
        agentComments: feedback.agentComments ?? null,
        nextAction: feedback.nextAction ?? null,
        recordedByUserId: actor.id,
      };
      if (existingFeedback) await tx.update(viewingFeedback).set(values).where(eq(viewingFeedback.id, existingFeedback.id));
      else await tx.insert(viewingFeedback).values({ viewingId, ...values });
    }

    await recordAudit(tx, { organizationId: actor.organizationId, action: 'update', entityType: 'viewing', entityId: viewingId, entityLabel: existing.code, previousValue: { status: existing.status }, newValue: { status: 'completed', feedback: Boolean(feedback) }, actor: { id: actor.id, fullName: actor.fullName } });
    return { id: viewingId };
  });
}

export async function getViewingForEdit(organizationId: string, viewingId: string) {
  const db = await getDb();
  const [viewing] = await db.select().from(viewings)
    .where(and(eq(viewings.id, viewingId), eq(viewings.organizationId, organizationId), isNull(viewings.deletedAt))).limit(1);
  return viewing ?? null;
}

export async function getViewingDetail(organizationId: string, viewingId: string) {
  const db = await getDb();
  const [viewing] = await db
    .select({
      id: viewings.id, code: viewings.code, status: viewings.status, customerConfirmed: viewings.customerConfirmed,
      leadId: viewings.leadId, customerId: viewings.customerId, customerName: customers.fullNameEn, mobile: customers.mobile,
      propertyId: viewings.propertyId, propertyName: properties.nameEn, unitId: viewings.unitId, unitNumber: units.unitNumber,
      assignedUserId: viewings.assignedUserId, agentName: users.fullName, meetingPoint: viewings.meetingPoint,
      scheduledDate: viewings.scheduledDate, scheduledTime: viewings.scheduledTime, completedAt: viewings.completedAt, notes: viewings.notes,
    })
    .from(viewings)
    .innerJoin(customers, eq(customers.id, viewings.customerId))
    .innerJoin(properties, eq(properties.id, viewings.propertyId))
    .leftJoin(units, eq(units.id, viewings.unitId))
    .leftJoin(users, eq(users.id, viewings.assignedUserId))
    .where(and(eq(viewings.id, viewingId), eq(viewings.organizationId, organizationId), isNull(viewings.deletedAt)))
    .limit(1);
  if (!viewing) return null;
  const [feedback] = await db.select().from(viewingFeedback).where(eq(viewingFeedback.viewingId, viewingId)).limit(1);
  return { viewing, feedback: feedback ?? null };
}

export interface ViewingListFilters {
  organizationId: string;
  status?: string;
  propertyId?: string;
  assignedUserId?: string;
  search?: string;
  page: number;
  pageSize: number;
}

export async function listViewings(filters: ViewingListFilters) {
  const db = await getDb();
  const where = and(
    eq(viewings.organizationId, filters.organizationId),
    isNull(viewings.deletedAt),
    filters.status ? eq(viewings.status, filters.status as typeof viewings.$inferSelect.status) : undefined,
    filters.propertyId ? eq(viewings.propertyId, filters.propertyId) : undefined,
    filters.assignedUserId ? eq(viewings.assignedUserId, filters.assignedUserId) : undefined,
    filters.search ? or(ilike(viewings.code, `%${filters.search}%`), ilike(customers.fullNameEn, `%${filters.search}%`)) : undefined,
  );
  const [rows, totalRow] = await Promise.all([
    db.select({
        id: viewings.id, code: viewings.code, customerName: customers.fullNameEn, propertyName: properties.nameEn,
        unitNumber: units.unitNumber, scheduledDate: viewings.scheduledDate, scheduledTime: viewings.scheduledTime,
        agentName: users.fullName, status: viewings.status,
      })
      .from(viewings)
      .innerJoin(customers, eq(customers.id, viewings.customerId))
      .innerJoin(properties, eq(properties.id, viewings.propertyId))
      .leftJoin(units, eq(units.id, viewings.unitId))
      .leftJoin(users, eq(users.id, viewings.assignedUserId))
      .where(where)
      .orderBy(desc(viewings.scheduledDate))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize),
    db.select({ total: count() }).from(viewings).innerJoin(customers, eq(customers.id, viewings.customerId)).where(where),
  ]);
  return { items: rows, total: Number(totalRow[0]?.total ?? 0) };
}
