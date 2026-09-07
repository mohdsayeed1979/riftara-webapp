import 'server-only';
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { buildings, floors, properties, units } from '@/db/schema';
import { recordAudit } from '@/lib/audit';
import { conflict, notFound, validationError } from '@/lib/errors';
import type { DbExecutor } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Building + Floor master-data service (BRD 4-6). Buildings belong to a
 * Property; Floors belong to a Building. Every mutation is organization-scoped,
 * validates the parent chain, and writes an audit entry.
 */

async function assertPropertyInOrg(tx: DbExecutor, organizationId: string, propertyId: string) {
  const [property] = await tx
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId), isNull(properties.deletedAt)))
    .limit(1);
  if (!property) throw notFound('Property', propertyId);
}

/** Buildings + their floors for the property management panel. */
export async function listBuildingsWithFloors(organizationId: string, propertyId: string) {
  const db = await getDb();
  const buildingRows = await db
    .select({
      id: buildings.id,
      code: buildings.code,
      nameEn: buildings.nameEn,
      nameAr: buildings.nameAr,
      floorCount: buildings.floorCount,
      unitCount: buildings.unitCount,
      grossLeasableArea: buildings.grossLeasableArea,
      constructionYear: buildings.constructionYear,
      elevatorCount: buildings.elevatorCount,
      parkingCapacity: buildings.parkingCapacity,
      status: buildings.status,
    })
    .from(buildings)
    .where(and(eq(buildings.organizationId, organizationId), eq(buildings.propertyId, propertyId), isNull(buildings.deletedAt)))
    .orderBy(asc(buildings.code));

  const floorRows = buildingRows.length
    ? await db
        .select({
          id: floors.id,
          buildingId: floors.buildingId,
          level: floors.level,
          nameEn: floors.nameEn,
          nameAr: floors.nameAr,
          grossArea: floors.grossArea,
          unitCount: floors.unitCount,
        })
        .from(floors)
        .where(and(eq(floors.organizationId, organizationId), isNull(floors.deletedAt)))
        .orderBy(asc(floors.level))
    : [];

  return buildingRows.map((b) => ({
    ...b,
    floors: floorRows.filter((f) => f.buildingId === b.id),
  }));
}

export async function nextBuildingCode(organizationId: string, propertyId: string): Promise<string> {
  const db = await getDb();
  const [{ total }] = await db
    .select({ total: count() })
    .from(buildings)
    .where(and(eq(buildings.organizationId, organizationId), eq(buildings.propertyId, propertyId)));
  return `BLD-${String(Number(total) + 1).padStart(3, '0')}`;
}

export interface CreateBuildingInput {
  propertyId: string;
  code: string;
  nameEn: string;
  nameAr?: string | null;
  status?: string;
  floorCount?: number;
  unitCount?: number;
  grossLeasableArea?: number | null;
  constructionYear?: number | null;
  elevatorCount?: number | null;
  parkingCapacity?: number | null;
}

export async function createBuilding(actor: SessionUser, input: CreateBuildingInput): Promise<{ id: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    await assertPropertyInOrg(tx, actor.organizationId, input.propertyId);
    const [created] = await tx
      .insert(buildings)
      .values({
        organizationId: actor.organizationId,
        propertyId: input.propertyId,
        code: input.code,
        nameEn: input.nameEn,
        nameAr: input.nameAr ?? null,
        status: input.status ?? 'active',
        floorCount: input.floorCount ?? 0,
        unitCount: input.unitCount ?? 0,
        grossLeasableArea: input.grossLeasableArea ?? null,
        constructionYear: input.constructionYear ?? null,
        elevatorCount: input.elevatorCount ?? null,
        parkingCapacity: input.parkingCapacity ?? null,
      })
      .returning({ id: buildings.id });

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'create',
      entityType: 'building',
      entityId: created.id,
      entityLabel: input.nameEn,
      newValue: input,
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return created;
  });
}

export interface UpdateBuildingInput extends Partial<Omit<CreateBuildingInput, 'propertyId'>> {
  id: string;
}

export async function updateBuilding(actor: SessionUser, input: UpdateBuildingInput): Promise<{ id: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(buildings)
      .where(and(eq(buildings.id, input.id), eq(buildings.organizationId, actor.organizationId), isNull(buildings.deletedAt)))
      .limit(1);
    if (!existing) throw notFound('Building', input.id);

    await tx
      .update(buildings)
      .set({
        code: input.code ?? existing.code,
        nameEn: input.nameEn ?? existing.nameEn,
        nameAr: input.nameAr === undefined ? existing.nameAr : input.nameAr,
        status: input.status ?? existing.status,
        floorCount: input.floorCount ?? existing.floorCount,
        unitCount: input.unitCount ?? existing.unitCount,
        grossLeasableArea: input.grossLeasableArea === undefined ? existing.grossLeasableArea : input.grossLeasableArea,
        constructionYear: input.constructionYear === undefined ? existing.constructionYear : input.constructionYear,
        elevatorCount: input.elevatorCount === undefined ? existing.elevatorCount : input.elevatorCount,
        parkingCapacity: input.parkingCapacity === undefined ? existing.parkingCapacity : input.parkingCapacity,
        updatedAt: new Date(),
      })
      .where(eq(buildings.id, input.id));

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'building',
      entityId: input.id,
      entityLabel: input.nameEn ?? existing.nameEn,
      previousValue: { code: existing.code, nameEn: existing.nameEn, status: existing.status },
      newValue: input,
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: input.id };
  });
}

/** Soft-archives a building. Blocked while it still has active units. */
export async function archiveBuilding(actor: SessionUser, buildingId: string): Promise<{ id: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: buildings.id, nameEn: buildings.nameEn })
      .from(buildings)
      .where(and(eq(buildings.id, buildingId), eq(buildings.organizationId, actor.organizationId), isNull(buildings.deletedAt)))
      .limit(1);
    if (!existing) throw notFound('Building', buildingId);

    const [{ total }] = await tx
      .select({ total: count() })
      .from(units)
      .where(and(eq(units.buildingId, buildingId), isNull(units.deletedAt)));
    if (Number(total) > 0) {
      throw conflict('This building still has units. Reassign or remove them before archiving the building.');
    }

    await tx.update(buildings).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(buildings.id, buildingId));
    await tx.update(floors).set({ deletedAt: new Date() }).where(eq(floors.buildingId, buildingId));

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'delete',
      entityType: 'building',
      entityId: buildingId,
      entityLabel: existing.nameEn,
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: buildingId };
  });
}

/* --------------------------------- Floors -------------------------------- */

async function assertBuildingInOrg(tx: DbExecutor, organizationId: string, buildingId: string) {
  const [building] = await tx
    .select({ id: buildings.id })
    .from(buildings)
    .where(and(eq(buildings.id, buildingId), eq(buildings.organizationId, organizationId), isNull(buildings.deletedAt)))
    .limit(1);
  if (!building) throw notFound('Building', buildingId);
}

export interface CreateFloorInput {
  buildingId: string;
  level: number;
  nameEn: string;
  nameAr?: string | null;
  grossArea?: number | null;
  unitCount?: number;
  floorPlanUrl?: string | null;
}

export async function createFloor(actor: SessionUser, input: CreateFloorInput): Promise<{ id: string }> {
  if (!Number.isInteger(input.level)) throw validationError('Floor level must be a whole number.');
  const db = await getDb();
  return db.transaction(async (tx) => {
    await assertBuildingInOrg(tx, actor.organizationId, input.buildingId);
    const [created] = await tx
      .insert(floors)
      .values({
        organizationId: actor.organizationId,
        buildingId: input.buildingId,
        level: input.level,
        nameEn: input.nameEn,
        nameAr: input.nameAr ?? null,
        grossArea: input.grossArea ?? null,
        unitCount: input.unitCount ?? 0,
        floorPlanUrl: input.floorPlanUrl ?? null,
      })
      .returning({ id: floors.id });

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'create',
      entityType: 'floor',
      entityId: created.id,
      entityLabel: input.nameEn,
      newValue: input,
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return created;
  });
}

export interface UpdateFloorInput {
  id: string;
  level?: number;
  nameEn?: string;
  nameAr?: string | null;
  grossArea?: number | null;
  unitCount?: number;
  floorPlanUrl?: string | null;
}

export async function updateFloor(actor: SessionUser, input: UpdateFloorInput): Promise<{ id: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(floors)
      .where(and(eq(floors.id, input.id), eq(floors.organizationId, actor.organizationId), isNull(floors.deletedAt)))
      .limit(1);
    if (!existing) throw notFound('Floor', input.id);

    await tx
      .update(floors)
      .set({
        level: input.level ?? existing.level,
        nameEn: input.nameEn ?? existing.nameEn,
        nameAr: input.nameAr === undefined ? existing.nameAr : input.nameAr,
        grossArea: input.grossArea === undefined ? existing.grossArea : input.grossArea,
        unitCount: input.unitCount ?? existing.unitCount,
        floorPlanUrl: input.floorPlanUrl === undefined ? existing.floorPlanUrl : input.floorPlanUrl,
        updatedAt: new Date(),
      })
      .where(eq(floors.id, input.id));

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'floor',
      entityId: input.id,
      entityLabel: input.nameEn ?? existing.nameEn,
      previousValue: { level: existing.level, nameEn: existing.nameEn },
      newValue: input,
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: input.id };
  });
}

export async function archiveFloor(actor: SessionUser, floorId: string): Promise<{ id: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: floors.id, nameEn: floors.nameEn })
      .from(floors)
      .where(and(eq(floors.id, floorId), eq(floors.organizationId, actor.organizationId), isNull(floors.deletedAt)))
      .limit(1);
    if (!existing) throw notFound('Floor', floorId);

    const [{ total }] = await tx
      .select({ total: count() })
      .from(units)
      .where(and(eq(units.floorId, floorId), isNull(units.deletedAt)));
    if (Number(total) > 0) {
      throw conflict('This floor still has units. Reassign or remove them before archiving the floor.');
    }

    await tx.update(floors).set({ deletedAt: new Date() }).where(eq(floors.id, floorId));
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'delete',
      entityType: 'floor',
      entityId: floorId,
      entityLabel: existing.nameEn,
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: floorId };
  });
}
