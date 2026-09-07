import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  properties,
  unitPricing,
  units,
  unitStatuses,
  websiteListings,
} from '@/db/schema';
import type { DbExecutor } from '@/db/types';
import { recordAudit } from '@/lib/audit';
import { businessRuleViolation, notFound } from '@/lib/errors';
import { getPolicy } from '@/lib/settings';
import { slugify } from '@/lib/utils';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Website publishing service (BRD 88-89).
 *
 * BR-001: a unit may only be published when its status is publishable.
 * BR-009: any unit status change refreshes the website listing projection so
 *         the corporate website and connected channels stay in sync.
 */

interface UnitPublishData {
  unitId: string;
  organizationId: string;
  propertyId: string;
  unitNumber: string;
  code: string;
  usageType: string;
  leasableArea: number | null;
  descriptionEn: string | null;
  availabilityClass: string;
  computedAvailableFrom: string | null;
  publishable: boolean;
  publishPrice: boolean;
  publishUnitNumber: boolean;
  contactForPrice: boolean;
  askingRent: number | null;
  serviceCharges: number | null;
  propertyName: string;
  propertyPublished: boolean;
}

async function loadUnitPublishData(
  executor: DbExecutor,
  unitId: string,
): Promise<UnitPublishData | null> {
  const [row] = await executor
    .select({
      unitId: units.id,
      organizationId: units.organizationId,
      propertyId: units.propertyId,
      unitNumber: units.unitNumber,
      code: units.code,
      usageType: units.usageType,
      leasableArea: units.leasableArea,
      descriptionEn: units.descriptionEn,
      availabilityClass: units.computedAvailabilityClass,
      computedAvailableFrom: units.computedAvailableFrom,
      publishable: unitStatuses.publishable,
      publishPrice: units.publishPrice,
      publishUnitNumber: units.publishUnitNumber,
      contactForPrice: units.contactForPrice,
      askingRent: unitPricing.askingRent,
      serviceCharges: unitPricing.serviceCharges,
      propertyName: properties.nameEn,
      propertyPublished: properties.publicationState,
    })
    .from(units)
    .innerJoin(unitStatuses, eq(unitStatuses.id, units.statusId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .leftJoin(unitPricing, eq(unitPricing.unitId, units.id))
    .where(and(eq(units.id, unitId), isNull(units.deletedAt)))
    .limit(1);

  if (!row) return null;
  return {
    ...row,
    leasableArea: row.leasableArea !== null ? Number(row.leasableArea) : null,
    askingRent: row.askingRent !== null ? Number(row.askingRent) : null,
    serviceCharges: row.serviceCharges !== null ? Number(row.serviceCharges) : null,
    propertyPublished: row.propertyPublished !== 'unpublished',
  };
}

/** Publishes a unit to the website (BR-001 enforced). */
export async function publishUnit(
  actor: SessionUser,
  unitId: string,
  options: { featured?: boolean } = {},
): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const data = await loadUnitPublishData(tx, unitId);
    if (!data) throw notFound('Unit', unitId);

    if (!data.publishable) {
      throw businessRuleViolation(
        'BR-001',
        'This unit cannot be published because its current status is not eligible for publication.',
      );
    }

    const state = options.featured ? 'featured' : 'published';
    await tx
      .update(units)
      .set({ publicationState: state, firstPublishedAt: new Date(), listedAt: new Date() })
      .where(eq(units.id, unitId));

    await syncWebsiteListing(tx, unitId);

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'publish',
      entityType: 'unit',
      entityId: unitId,
      entityLabel: `Unit ${data.unitNumber}`,
      newValue: { publicationState: state },
      actor: { id: actor.id, fullName: actor.fullName },
    });
  });
}

export async function unpublishUnit(actor: SessionUser, unitId: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const data = await loadUnitPublishData(tx, unitId);
    if (!data) throw notFound('Unit', unitId);

    await tx.update(units).set({ publicationState: 'unpublished' }).where(eq(units.id, unitId));
    await syncWebsiteListing(tx, unitId);

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      action: 'unpublish',
      entityType: 'unit',
      entityId: unitId,
      entityLabel: `Unit ${data.unitNumber}`,
      newValue: { publicationState: 'unpublished' },
      actor: { id: actor.id, fullName: actor.fullName },
    });
  });
}

/**
 * Rewrites the denormalised website listing row for a unit. Called whenever
 * publication, status, availability or pricing changes (BR-009). Idempotent.
 */
export async function syncWebsiteListing(executor: DbExecutor, unitId: string): Promise<void> {
  const data = await loadUnitPublishData(executor, unitId);
  if (!data) return;

  const policy = await getPolicy(data.organizationId);
  const isPublished =
    data.propertyPublished &&
    (data.availabilityClass === 'available' || data.availabilityClass === 'reserved');

  // A published unit whose status became ineligible is withdrawn automatically.
  const [current] = await executor
    .select({ publicationState: units.publicationState })
    .from(units)
    .where(eq(units.id, unitId))
    .limit(1);
  const explicitlyPublished = current?.publicationState !== 'unpublished';
  const shouldPublish = explicitlyPublished && isPublished && data.publishable;

  const payload = {
    unitNumber: policy.publishExactUnitNumber && data.publishUnitNumber ? data.unitNumber : null,
    propertyName: data.propertyName,
    usageType: data.usageType,
    leasableArea: data.leasableArea,
    description: data.descriptionEn,
    availabilityClass: data.availabilityClass,
    availableFrom: data.computedAvailableFrom,
    price:
      data.contactForPrice || !data.publishPrice
        ? null
        : { askingRent: data.askingRent, serviceCharges: data.serviceCharges },
    contactForPrice: data.contactForPrice || !data.publishPrice,
    featured: current?.publicationState === 'featured',
  };

  const slug = slugify(`${data.propertyName}-${data.code}`);

  await executor
    .insert(websiteListings)
    .values({
      organizationId: data.organizationId,
      unitId,
      propertyId: data.propertyId,
      slug,
      payload,
      isPublished: shouldPublish,
      isFeatured: current?.publicationState === 'featured',
      availableFrom: data.computedAvailableFrom,
      publishedAt: shouldPublish ? new Date() : null,
      unpublishedAt: shouldPublish ? null : new Date(),
      lastSyncedAt: new Date(),
      isDemo: false,
    })
    .onConflictDoUpdate({
      target: websiteListings.unitId,
      set: {
        payload,
        slug,
        isPublished: shouldPublish,
        isFeatured: current?.publicationState === 'featured',
        availableFrom: data.computedAvailableFrom,
        publishedAt: shouldPublish ? new Date() : null,
        unpublishedAt: shouldPublish ? null : new Date(),
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      },
    });
}
