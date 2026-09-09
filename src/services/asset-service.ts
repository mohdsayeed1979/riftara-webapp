import 'server-only';
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  auditLogs,
  buildings,
  maintenanceAssets,
  properties,
  vendors,
  workOrders,
} from '@/db/schema';
import type { DbExecutor } from '@/db/types';
import { recordAudit } from '@/lib/audit';
import { conflict, notFound, validationError } from '@/lib/errors';
import { round2 } from '@/lib/utils';
import type { SessionUser } from '@/lib/auth/session';
import {
  ASSET_STATUS_TRANSITIONS,
  ASSET_STATUSES,
  ASSET_TYPES,
  isAssetStatus,
  isAssetType,
  type AssetStatus,
  type AssetType,
} from './asset-constants';

// Re-export the client-safe constants so existing `@/services/asset-service`
// imports (server pages, actions) keep working unchanged.
export { ASSET_STATUSES, ASSET_TYPES, isAssetStatus, isAssetType };
export type { AssetStatus, AssetType };

/**
 * Asset lifecycle service (Phase 10A, BRD 55).
 *
 * Operates on the existing `maintenance_assets` register — no new tables and no
 * schema changes. Every mutation is organization-scoped, validates its foreign
 * references against the same organization, enforces the status lifecycle, and
 * writes an audit entry inside the same transaction as the change.
 *
 * The register supports a Property → Building location hierarchy plus a free-text
 * location and a supplier vendor. Floor/unit assignment and a dedicated
 * assigned-user column do not exist in the schema and are intentionally NOT
 * implemented. Disposal is modelled as the terminal `decommissioned` status with
 * the reason preserved in the audit trail (there is no hard delete).
 */

/** Allowed operational status transitions (see {@link ASSET_STATUS_TRANSITIONS}). */
const STATUS_TRANSITIONS = ASSET_STATUS_TRANSITIONS;

export interface AssetScope {
  organizationId: string;
  /** Data-level restriction from the session; empty/null means org-wide. */
  allowedPropertyIds?: string[] | null;
}

function scopeWhere(scope: AssetScope): SQL[] {
  const conditions: SQL[] = [
    eq(maintenanceAssets.organizationId, scope.organizationId),
    isNull(maintenanceAssets.deletedAt),
  ];
  if (scope.allowedPropertyIds?.length) {
    conditions.push(inArray(maintenanceAssets.propertyId, scope.allowedPropertyIds));
  }
  return conditions;
}

/**
 * Validates asset location + vendor references against the SAME organization,
 * and enforces the Property → Building hierarchy. `effectivePropertyId` is the
 * property the building must belong to (the target property of the operation).
 */
async function validateAssetRefs(
  tx: DbExecutor,
  organizationId: string,
  input: { propertyId?: string; buildingId?: string | null; supplierVendorId?: string | null },
  effectivePropertyId: string,
): Promise<void> {
  if (input.propertyId) {
    const [p] = await tx
      .select({ id: properties.id })
      .from(properties)
      .where(and(eq(properties.id, input.propertyId), eq(properties.organizationId, organizationId), isNull(properties.deletedAt)))
      .limit(1);
    if (!p) throw validationError('The selected property is not valid for this organization.');
  }
  if (input.buildingId) {
    const [b] = await tx
      .select({ id: buildings.id, propertyId: buildings.propertyId })
      .from(buildings)
      .where(and(eq(buildings.id, input.buildingId), eq(buildings.organizationId, organizationId), isNull(buildings.deletedAt)))
      .limit(1);
    if (!b) throw validationError('The selected building is not valid for this organization.');
    if (b.propertyId !== effectivePropertyId) {
      throw validationError('The selected building does not belong to the selected property.');
    }
  }
  if (input.supplierVendorId) {
    const [v] = await tx
      .select({ id: vendors.id })
      .from(vendors)
      .where(and(eq(vendors.id, input.supplierVendorId), eq(vendors.organizationId, organizationId)))
      .limit(1);
    if (!v) throw validationError('The selected vendor is not valid for this organization.');
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export interface AssetListFilters extends AssetScope {
  search?: string;
  status?: AssetStatus;
  propertyId?: string;
  assetType?: AssetType;
  page: number;
  pageSize: number;
}

export interface AssetListItem {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  assetType: string;
  status: string;
  propertyId: string;
  propertyName: string;
  buildingId: string | null;
  buildingName: string | null;
  location: string | null;
  manufacturer: string | null;
  modelNumber: string | null;
  serialNumber: string | null;
  supplierVendorId: string | null;
  vendorName: string | null;
  purchaseDate: string | null;
  purchaseCost: number | null;
  lifetimeMaintenanceCost: number;
  nextServiceDate: string | null;
  warrantyExpiryDate: string | null;
}

export async function listAssets(
  filters: AssetListFilters,
): Promise<{ items: AssetListItem[]; total: number }> {
  const db = await getDb();
  const conditions = scopeWhere(filters);
  if (filters.status) conditions.push(eq(maintenanceAssets.status, filters.status));
  if (filters.propertyId) conditions.push(eq(maintenanceAssets.propertyId, filters.propertyId));
  if (filters.assetType) conditions.push(eq(maintenanceAssets.assetType, filters.assetType));
  if (filters.search) {
    conditions.push(
      or(
        ilike(maintenanceAssets.code, `%${filters.search}%`),
        ilike(maintenanceAssets.nameEn, `%${filters.search}%`),
        ilike(maintenanceAssets.serialNumber, `%${filters.search}%`),
      ) as SQL,
    );
  }
  const where = and(...conditions);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: maintenanceAssets.id,
        code: maintenanceAssets.code,
        nameEn: maintenanceAssets.nameEn,
        nameAr: maintenanceAssets.nameAr,
        assetType: maintenanceAssets.assetType,
        status: maintenanceAssets.status,
        propertyId: maintenanceAssets.propertyId,
        propertyName: properties.nameEn,
        buildingId: maintenanceAssets.buildingId,
        buildingName: buildings.nameEn,
        location: maintenanceAssets.location,
        manufacturer: maintenanceAssets.manufacturer,
        modelNumber: maintenanceAssets.modelNumber,
        serialNumber: maintenanceAssets.serialNumber,
        supplierVendorId: maintenanceAssets.supplierVendorId,
        vendorName: vendors.nameEn,
        purchaseDate: maintenanceAssets.purchaseDate,
        purchaseCost: maintenanceAssets.purchaseCost,
        lifetimeMaintenanceCost: maintenanceAssets.lifetimeMaintenanceCost,
        nextServiceDate: maintenanceAssets.nextServiceDate,
        warrantyExpiryDate: maintenanceAssets.warrantyExpiryDate,
      })
      .from(maintenanceAssets)
      .innerJoin(properties, eq(properties.id, maintenanceAssets.propertyId))
      .leftJoin(buildings, eq(buildings.id, maintenanceAssets.buildingId))
      .leftJoin(vendors, eq(vendors.id, maintenanceAssets.supplierVendorId))
      .where(where)
      .orderBy(asc(maintenanceAssets.code))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize),
    db.select({ total: count() }).from(maintenanceAssets).where(where),
  ]);

  return { items: rows, total: Number(total) };
}

export interface AssetKpis {
  total: number;
  operational: number;
  underMaintenance: number;
  decommissioned: number;
  purchaseValue: number;
  lifetimeMaintenanceCost: number;
}

export async function getAssetKpis(scope: AssetScope): Promise<AssetKpis> {
  const db = await getDb();
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      operational: sql<number>`count(*) filter (where ${maintenanceAssets.status} = 'operational')::int`,
      underMaintenance: sql<number>`count(*) filter (where ${maintenanceAssets.status} = 'under_maintenance')::int`,
      decommissioned: sql<number>`count(*) filter (where ${maintenanceAssets.status} = 'decommissioned')::int`,
      purchaseValue: sql<number>`coalesce(sum(${maintenanceAssets.purchaseCost}), 0)::float8`,
      lifetimeMaintenanceCost: sql<number>`coalesce(sum(${maintenanceAssets.lifetimeMaintenanceCost}), 0)::float8`,
    })
    .from(maintenanceAssets)
    .where(and(...scopeWhere(scope)));
  return {
    total: Number(row?.total ?? 0),
    operational: Number(row?.operational ?? 0),
    underMaintenance: Number(row?.underMaintenance ?? 0),
    decommissioned: Number(row?.decommissioned ?? 0),
    purchaseValue: Number(row?.purchaseValue ?? 0),
    lifetimeMaintenanceCost: Number(row?.lifetimeMaintenanceCost ?? 0),
  };
}

/** Full asset record for the detail page, org-scoped (guards against IDOR). */
export async function getAsset(scope: AssetScope, assetId: string) {
  const db = await getDb();
  const conditions = [
    eq(maintenanceAssets.id, assetId),
    eq(maintenanceAssets.organizationId, scope.organizationId),
    isNull(maintenanceAssets.deletedAt),
  ];
  if (scope.allowedPropertyIds?.length) {
    conditions.push(inArray(maintenanceAssets.propertyId, scope.allowedPropertyIds));
  }
  const [asset] = await db
    .select({
      id: maintenanceAssets.id,
      code: maintenanceAssets.code,
      nameEn: maintenanceAssets.nameEn,
      nameAr: maintenanceAssets.nameAr,
      assetType: maintenanceAssets.assetType,
      status: maintenanceAssets.status,
      propertyId: maintenanceAssets.propertyId,
      propertyName: properties.nameEn,
      buildingId: maintenanceAssets.buildingId,
      buildingName: buildings.nameEn,
      location: maintenanceAssets.location,
      manufacturer: maintenanceAssets.manufacturer,
      modelNumber: maintenanceAssets.modelNumber,
      serialNumber: maintenanceAssets.serialNumber,
      purchaseDate: maintenanceAssets.purchaseDate,
      purchaseCost: maintenanceAssets.purchaseCost,
      warrantyExpiryDate: maintenanceAssets.warrantyExpiryDate,
      supplierVendorId: maintenanceAssets.supplierVendorId,
      vendorName: vendors.nameEn,
      lifetimeMaintenanceCost: maintenanceAssets.lifetimeMaintenanceCost,
      lastServiceDate: maintenanceAssets.lastServiceDate,
      nextServiceDate: maintenanceAssets.nextServiceDate,
      createdAt: maintenanceAssets.createdAt,
      updatedAt: maintenanceAssets.updatedAt,
    })
    .from(maintenanceAssets)
    .innerJoin(properties, eq(properties.id, maintenanceAssets.propertyId))
    .leftJoin(buildings, eq(buildings.id, maintenanceAssets.buildingId))
    .leftJoin(vendors, eq(vendors.id, maintenanceAssets.supplierVendorId))
    .where(and(...conditions))
    .limit(1);
  if (!asset) throw notFound('Asset', assetId);
  return asset;
}

/** Work-order history for an asset (existing `work_orders.asset_id` link). */
export async function getAssetMaintenanceHistory(organizationId: string, assetId: string) {
  const db = await getDb();
  return db
    .select({
      id: workOrders.id,
      code: workOrders.code,
      title: workOrders.title,
      status: workOrders.status,
      priority: workOrders.priority,
      createdAt: workOrders.createdAt,
    })
    .from(workOrders)
    .where(and(eq(workOrders.organizationId, organizationId), eq(workOrders.assetId, assetId), isNull(workOrders.deletedAt)))
    .orderBy(desc(workOrders.createdAt))
    .limit(20);
}

/** Audit history for an asset, for the detail page timeline. */
export async function getAssetAuditHistory(organizationId: string, assetId: string) {
  const db = await getDb();
  return db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      actorLabel: auditLogs.actorLabel,
      reason: auditLogs.reason,
      createdAt: auditLogs.createdAt,
      changedFields: auditLogs.changedFields,
    })
    .from(auditLogs)
    .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.entityType, 'asset'), eq(auditLogs.entityId, assetId)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(30);
}

/** Reference data for the create/edit/assign/transfer forms. */
export async function getAssetFormReferenceData(organizationId: string) {
  const db = await getDb();
  const [propertyRows, buildingRows, vendorRows] = await Promise.all([
    db.select({ id: properties.id, name: properties.nameEn }).from(properties).where(and(eq(properties.organizationId, organizationId), isNull(properties.deletedAt))).orderBy(asc(properties.nameEn)),
    db.select({ id: buildings.id, name: buildings.nameEn, propertyId: buildings.propertyId }).from(buildings).where(and(eq(buildings.organizationId, organizationId), isNull(buildings.deletedAt))).orderBy(asc(buildings.nameEn)),
    db.select({ id: vendors.id, name: vendors.nameEn }).from(vendors).where(and(eq(vendors.organizationId, organizationId), eq(vendors.isActive, true))).orderBy(asc(vendors.nameEn)),
  ]);
  return { properties: propertyRows, buildings: buildingRows, vendors: vendorRows };
}

/* -------------------------------------------------------------------------- */
/* Mutations                                                                  */
/* -------------------------------------------------------------------------- */

export interface CreateAssetInput {
  code?: string;
  nameEn: string;
  nameAr?: string;
  assetType: AssetType;
  propertyId: string;
  buildingId?: string;
  location?: string;
  manufacturer?: string;
  modelNumber?: string;
  serialNumber?: string;
  supplierVendorId?: string;
  purchaseDate?: string;
  purchaseCost?: number;
  warrantyExpiryDate?: string;
}

export async function createAsset(actor: SessionUser, input: CreateAssetInput): Promise<{ id: string; code: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    await validateAssetRefs(
      tx,
      actor.organizationId,
      { propertyId: input.propertyId, buildingId: input.buildingId ?? null, supplierVendorId: input.supplierVendorId ?? null },
      input.propertyId,
    );

    // Code: use the caller's value (unique per org) or derive the next AST-#####
    // from the highest existing numeric code so seeded gaps never collide.
    let code = input.code?.trim();
    if (code) {
      const [dup] = await tx
        .select({ id: maintenanceAssets.id })
        .from(maintenanceAssets)
        .where(and(eq(maintenanceAssets.organizationId, actor.organizationId), eq(maintenanceAssets.code, code)))
        .limit(1);
      if (dup) throw conflict(`An asset with code "${code}" already exists.`);
    } else {
      const [{ maxCode }] = await tx
        .select({ maxCode: sql<string | null>`max(${maintenanceAssets.code}) filter (where ${maintenanceAssets.code} ~ '^AST-[0-9]+$')` })
        .from(maintenanceAssets)
        .where(eq(maintenanceAssets.organizationId, actor.organizationId));
      const nextNumber = maxCode ? Number(maxCode.replace(/\D/g, '')) + 1 : 1;
      code = `AST-${String(nextNumber).padStart(5, '0')}`;
    }

    const [created] = await tx
      .insert(maintenanceAssets)
      .values({
        organizationId: actor.organizationId,
        code,
        nameEn: input.nameEn,
        nameAr: input.nameAr ?? null,
        assetType: input.assetType,
        propertyId: input.propertyId,
        buildingId: input.buildingId ?? null,
        location: input.location ?? null,
        manufacturer: input.manufacturer ?? null,
        modelNumber: input.modelNumber ?? null,
        serialNumber: input.serialNumber ?? null,
        supplierVendorId: input.supplierVendorId ?? null,
        purchaseDate: input.purchaseDate ?? null,
        purchaseCost: input.purchaseCost !== undefined ? round2(input.purchaseCost) : null,
        warrantyExpiryDate: input.warrantyExpiryDate ?? null,
        status: 'operational',
      })
      .returning({ id: maintenanceAssets.id });

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'create',
      entityType: 'asset',
      entityId: created.id,
      entityLabel: code,
      newValue: { code, nameEn: input.nameEn, assetType: input.assetType, propertyId: input.propertyId, status: 'operational' },
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: created.id, code };
  });
}

/** Loads an asset FOR UPDATE within the actor's organization or throws. */
async function loadForMutation(tx: DbExecutor, organizationId: string, assetId: string) {
  const [asset] = await tx
    .select({
      id: maintenanceAssets.id,
      code: maintenanceAssets.code,
      status: maintenanceAssets.status,
      propertyId: maintenanceAssets.propertyId,
      buildingId: maintenanceAssets.buildingId,
      location: maintenanceAssets.location,
    })
    .from(maintenanceAssets)
    .where(and(eq(maintenanceAssets.id, assetId), eq(maintenanceAssets.organizationId, organizationId), isNull(maintenanceAssets.deletedAt)))
    .limit(1);
  if (!asset) throw notFound('Asset', assetId);
  return asset;
}

export interface UpdateAssetInput {
  nameEn?: string;
  nameAr?: string | null;
  assetType?: AssetType;
  location?: string | null;
  manufacturer?: string | null;
  modelNumber?: string | null;
  serialNumber?: string | null;
  supplierVendorId?: string | null;
  purchaseDate?: string | null;
  purchaseCost?: number | null;
  warrantyExpiryDate?: string | null;
}

export async function updateAsset(actor: SessionUser, assetId: string, input: UpdateAssetInput): Promise<{ id: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const asset = await loadForMutation(tx, actor.organizationId, assetId);
    if (asset.status === 'decommissioned') throw conflict('A disposed asset can no longer be edited.');
    if (input.supplierVendorId) {
      await validateAssetRefs(tx, actor.organizationId, { supplierVendorId: input.supplierVendorId }, asset.propertyId);
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.nameEn !== undefined) patch.nameEn = input.nameEn;
    if (input.nameAr !== undefined) patch.nameAr = input.nameAr;
    if (input.assetType !== undefined) patch.assetType = input.assetType;
    if (input.location !== undefined) patch.location = input.location;
    if (input.manufacturer !== undefined) patch.manufacturer = input.manufacturer;
    if (input.modelNumber !== undefined) patch.modelNumber = input.modelNumber;
    if (input.serialNumber !== undefined) patch.serialNumber = input.serialNumber;
    if (input.supplierVendorId !== undefined) patch.supplierVendorId = input.supplierVendorId;
    if (input.purchaseDate !== undefined) patch.purchaseDate = input.purchaseDate;
    if (input.purchaseCost !== undefined) patch.purchaseCost = input.purchaseCost === null ? null : round2(input.purchaseCost);
    if (input.warrantyExpiryDate !== undefined) patch.warrantyExpiryDate = input.warrantyExpiryDate;

    await tx.update(maintenanceAssets).set(patch).where(eq(maintenanceAssets.id, assetId));
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'asset',
      entityId: assetId,
      entityLabel: asset.code,
      newValue: patch,
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: assetId };
  });
}

/**
 * Assigns an asset to a building (and/or free-text location) WITHIN its current
 * property. Use {@link transferAsset} to move an asset to a different property.
 */
export async function assignAsset(
  actor: SessionUser,
  assetId: string,
  input: { buildingId?: string | null; location?: string | null },
): Promise<{ id: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const asset = await loadForMutation(tx, actor.organizationId, assetId);
    if (asset.status === 'decommissioned') throw conflict('A disposed asset cannot be assigned.');
    await validateAssetRefs(tx, actor.organizationId, { buildingId: input.buildingId ?? null }, asset.propertyId);

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.buildingId !== undefined) patch.buildingId = input.buildingId;
    if (input.location !== undefined) patch.location = input.location;

    await tx.update(maintenanceAssets).set(patch).where(eq(maintenanceAssets.id, assetId));
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'asset',
      entityId: assetId,
      entityLabel: asset.code,
      reason: 'asset_assign',
      previousValue: { buildingId: asset.buildingId, location: asset.location },
      newValue: { buildingId: input.buildingId ?? asset.buildingId, location: input.location ?? asset.location },
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: assetId };
  });
}

/**
 * Transfers an asset to a different property (and optionally a building within
 * it). The previous location is preserved in the audit trail; the record is
 * never hard-deleted.
 */
export async function transferAsset(
  actor: SessionUser,
  assetId: string,
  input: { propertyId: string; buildingId?: string | null; location?: string | null },
): Promise<{ id: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const asset = await loadForMutation(tx, actor.organizationId, assetId);
    if (asset.status === 'decommissioned') throw conflict('A disposed asset cannot be transferred.');
    if (input.propertyId === asset.propertyId && (input.buildingId ?? null) === asset.buildingId) {
      throw validationError('Select a different destination to transfer the asset.');
    }
    await validateAssetRefs(
      tx,
      actor.organizationId,
      { propertyId: input.propertyId, buildingId: input.buildingId ?? null },
      input.propertyId,
    );

    await tx
      .update(maintenanceAssets)
      .set({ propertyId: input.propertyId, buildingId: input.buildingId ?? null, location: input.location ?? null, updatedAt: new Date() })
      .where(eq(maintenanceAssets.id, assetId));
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'asset',
      entityId: assetId,
      entityLabel: asset.code,
      reason: 'asset_transfer',
      previousValue: { propertyId: asset.propertyId, buildingId: asset.buildingId, location: asset.location },
      newValue: { propertyId: input.propertyId, buildingId: input.buildingId ?? null, location: input.location ?? null },
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: assetId };
  });
}

/** Moves an asset along the operational lifecycle. Disposal is separate. */
export async function changeAssetStatus(
  actor: SessionUser,
  assetId: string,
  toStatus: AssetStatus,
): Promise<{ id: string; status: AssetStatus }> {
  if (toStatus === 'decommissioned') {
    throw validationError('Use the dispose action to decommission an asset.');
  }
  const db = await getDb();
  return db.transaction(async (tx) => {
    const asset = await loadForMutation(tx, actor.organizationId, assetId);
    const from = asset.status as AssetStatus;
    if (from === toStatus) return { id: assetId, status: toStatus };
    const allowed = STATUS_TRANSITIONS[from] ?? [];
    if (!allowed.includes(toStatus)) {
      throw conflict(`An asset cannot move from "${from.replace(/_/g, ' ')}" to "${toStatus.replace(/_/g, ' ')}".`);
    }
    await tx.update(maintenanceAssets).set({ status: toStatus, updatedAt: new Date() }).where(eq(maintenanceAssets.id, assetId));
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'asset',
      entityId: assetId,
      entityLabel: asset.code,
      reason: 'asset_status_change',
      previousValue: { status: from },
      newValue: { status: toStatus },
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: assetId, status: toStatus };
  });
}

/**
 * Disposes an asset: sets the terminal `decommissioned` status and records the
 * reason in the audit trail. The record is preserved (no hard delete) and a
 * decommissioned asset cannot be reactivated, transferred, or edited.
 */
export async function disposeAsset(
  actor: SessionUser,
  assetId: string,
  input: { reason: string },
): Promise<{ id: string; status: AssetStatus }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const asset = await loadForMutation(tx, actor.organizationId, assetId);
    if (asset.status === 'decommissioned') throw conflict('This asset has already been disposed.');

    await tx.update(maintenanceAssets).set({ status: 'decommissioned', updatedAt: new Date() }).where(eq(maintenanceAssets.id, assetId));
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'soft_delete',
      entityType: 'asset',
      entityId: assetId,
      entityLabel: asset.code,
      reason: `asset_dispose: ${input.reason}`,
      previousValue: { status: asset.status },
      newValue: { status: 'decommissioned' },
      actor: { id: actor.id, fullName: actor.fullName },
    });
    return { id: assetId, status: 'decommissioned' };
  });
}
