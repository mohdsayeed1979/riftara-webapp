import 'server-only';
import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  contracts,
  documents,
  leads,
  maintenanceAssets,
  notifications,
  organizations,
  preventiveMaintenanceSchedules,
  reservations,
} from '@/db/schema';
import { recordAudit } from '@/lib/audit';
import { getPolicy } from '@/lib/settings';
import { expireLapsedReservations } from '@/services/availability-service';
import { generateOverdueNotifications } from '@/services/collection-service';
import { generateSlaBreachNotifications } from '@/services/maintenance-service';

/**
 * Runtime notification & automation generators (Phase 9).
 *
 * Every generator is organization-scoped and idempotent. Idempotency reuses the
 * Phase 5/6 pattern: a notification is created only when no matching
 * `(organizationId, notificationType, entityType, entityId)` notification exists
 * within a per-type recency window. The recency window lets recurring events
 * (preventive maintenance, lead follow-up) re-notify on a later occurrence while
 * one-time events (contract/reservation) are never duplicated. No new table or
 * schema is introduced — the existing `notifications` table is reused.
 */

type Actor = { id: string | null; organizationId: string; fullName: string };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function isoInDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}
function since(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

/** Inserts a notification unless a matching one exists within `recencyDays`. */
async function ensureNotification(
  db: Awaited<ReturnType<typeof getDb>>,
  input: {
    organizationId: string;
    notificationType: string;
    entityType: string;
    entityId: string;
    recencyDays: number;
    userId?: string | null;
    requiredPermission?: string | null;
    severity?: string;
    title: string;
    body?: string;
    linkHref?: string;
  },
): Promise<boolean> {
  const [existing] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.organizationId, input.organizationId),
        eq(notifications.notificationType, input.notificationType),
        eq(notifications.entityType, input.entityType),
        eq(notifications.entityId, input.entityId),
        gte(notifications.createdAt, since(input.recencyDays)),
      ),
    )
    .limit(1);
  if (existing) return false;

  await db.insert(notifications).values({
    organizationId: input.organizationId,
    userId: input.userId ?? null,
    requiredPermission: input.requiredPermission ?? null,
    notificationType: input.notificationType,
    severity: input.severity ?? 'info',
    title: input.title,
    body: input.body ?? null,
    linkHref: input.linkHref ?? null,
    entityType: input.entityType,
    entityId: input.entityId,
  });
  return true;
}

/* -------------------------------------------------------------------------- */

/** Contracts approaching expiry within the configured window (BRD 89). */
export async function generateContractExpiryNotifications(organizationId: string): Promise<number> {
  const db = await getDb();
  const policy = await getPolicy(organizationId);
  const rows = await db
    .select({ id: contracts.id, number: contracts.contractNumber, endDate: contracts.endDate })
    .from(contracts)
    .where(
      and(
        eq(contracts.organizationId, organizationId),
        inArray(contracts.status, ['signed', 'active']),
        isNull(contracts.deletedAt),
        gte(contracts.endDate, todayIso()),
        lte(contracts.endDate, isoInDays(policy.contractExpiryWindowDays)),
      ),
    )
    .limit(500);
  let created = 0;
  for (const c of rows) {
    const ok = await ensureNotification(db, {
      organizationId, notificationType: 'contract_expiry', entityType: 'contract', entityId: c.id, recencyDays: 30,
      requiredPermission: 'contracts:view', severity: 'warning',
      title: `Contract ${c.number} expires soon`, body: `Ends on ${c.endDate}.`, linkHref: `/contracts/${c.id}`,
    });
    if (ok) created += 1;
  }
  return created;
}

/** Active reservations expiring within the next few days (BR-011 context). */
export async function generateReservationExpiryNotifications(organizationId: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ id: reservations.id, code: reservations.code, expiryDate: reservations.expiryDate })
    .from(reservations)
    .where(
      and(
        eq(reservations.organizationId, organizationId),
        eq(reservations.status, 'active'),
        eq(reservations.isActive, true),
        gte(reservations.expiryDate, todayIso()),
        lte(reservations.expiryDate, isoInDays(3)),
      ),
    )
    .limit(500);
  let created = 0;
  for (const r of rows) {
    const ok = await ensureNotification(db, {
      organizationId, notificationType: 'reservation_expiry', entityType: 'reservation', entityId: r.id, recencyDays: 3,
      requiredPermission: 'reservations:view', severity: 'warning',
      title: `Reservation ${r.code} expiring`, body: `Expires on ${r.expiryDate}.`, linkHref: `/leasing/reservations/${r.id}`,
    });
    if (ok) created += 1;
  }
  return created;
}

/** Preventive-maintenance schedules due within the next two weeks.
 *  The schema has no per-occurrence id, so idempotency uses a 20-day recency
 *  window keyed on the schedule (documented limitation — no migration added). */
export async function generatePreventiveMaintenanceNotifications(organizationId: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ id: preventiveMaintenanceSchedules.id, name: preventiveMaintenanceSchedules.nameEn, nextDueDate: preventiveMaintenanceSchedules.nextDueDate })
    .from(preventiveMaintenanceSchedules)
    .where(
      and(
        eq(preventiveMaintenanceSchedules.organizationId, organizationId),
        eq(preventiveMaintenanceSchedules.isActive, true),
        lte(preventiveMaintenanceSchedules.nextDueDate, isoInDays(14)),
      ),
    )
    .limit(500);
  let created = 0;
  for (const s of rows) {
    const ok = await ensureNotification(db, {
      organizationId, notificationType: 'maintenance_pm_due', entityType: 'pm_schedule', entityId: s.id, recencyDays: 20,
      requiredPermission: 'maintenance:view', severity: 'info',
      title: `Preventive maintenance due: ${s.name}`, body: `Scheduled for ${s.nextDueDate}.`, linkHref: '/maintenance',
    });
    if (ok) created += 1;
  }
  return created;
}

/** Leads needing follow-up (next follow-up passed) or uncontacted beyond the
 *  first-response SLA. Assigned to the lead owner where one exists. */
export async function generateLeadFollowUpNotifications(organizationId: string): Promise<number> {
  const db = await getDb();
  const policy = await getPolicy(organizationId);
  const slaCutoff = new Date(Date.now() - policy.leadFirstResponseSlaMinutes * 60_000);
  let created = 0;

  const followUps = await db
    .select({ id: leads.id, code: leads.code, assignedUserId: leads.assignedUserId })
    .from(leads)
    .where(and(eq(leads.organizationId, organizationId), isNull(leads.closedAt), isNull(leads.deletedAt), sql`${leads.nextFollowUpAt} is not null`, lte(leads.nextFollowUpAt, new Date())))
    .limit(500);
  for (const l of followUps) {
    const ok = await ensureNotification(db, {
      organizationId, notificationType: 'follow_up_due', entityType: 'lead', entityId: l.id, recencyDays: 2,
      userId: l.assignedUserId ?? null, requiredPermission: l.assignedUserId ? null : 'leasing:view', severity: 'info',
      title: `Lead ${l.code} follow-up due`, linkHref: `/leasing/leads/${l.id}`,
    });
    if (ok) created += 1;
  }

  const uncontacted = await db
    .select({ id: leads.id, code: leads.code, assignedUserId: leads.assignedUserId })
    .from(leads)
    .where(and(eq(leads.organizationId, organizationId), isNull(leads.closedAt), isNull(leads.deletedAt), isNull(leads.firstResponseAt), lte(leads.createdAt, slaCutoff)))
    .limit(500);
  for (const l of uncontacted) {
    const ok = await ensureNotification(db, {
      organizationId, notificationType: 'uncontacted_lead', entityType: 'lead', entityId: l.id, recencyDays: 2,
      userId: l.assignedUserId ?? null, requiredPermission: l.assignedUserId ? null : 'leasing:view', severity: 'warning',
      title: `Lead ${l.code} is uncontacted`, body: 'First-response SLA has elapsed.', linkHref: `/leasing/leads/${l.id}`,
    });
    if (ok) created += 1;
  }
  return created;
}

/** Active/signed contracts within the renewal-notice window that have not yet
 *  started renewal (BRD 88). Uses the configurable renewal-notice days. */
export async function generateRenewalNotifications(organizationId: string): Promise<number> {
  const db = await getDb();
  const policy = await getPolicy(organizationId);
  const maxNoticeDays = policy.renewalNoticeDays.length ? Math.max(...policy.renewalNoticeDays) : 90;
  const rows = await db
    .select({ id: contracts.id, number: contracts.contractNumber, endDate: contracts.endDate })
    .from(contracts)
    .where(
      and(
        eq(contracts.organizationId, organizationId),
        inArray(contracts.status, ['signed', 'active']),
        isNull(contracts.deletedAt),
        eq(contracts.renewalStatus, 'not_started'),
        gte(contracts.endDate, todayIso()),
        lte(contracts.endDate, isoInDays(maxNoticeDays)),
      ),
    )
    .limit(500);
  let created = 0;
  for (const c of rows) {
    const ok = await ensureNotification(db, {
      organizationId, notificationType: 'renewal_required', entityType: 'contract', entityId: c.id, recencyDays: 30,
      requiredPermission: 'contracts:view', severity: 'info',
      title: `Renewal review: ${c.number}`, body: `Contract ends on ${c.endDate}.`, linkHref: `/contracts/${c.id}`,
    });
    if (ok) created += 1;
  }
  return created;
}

/** Expires lapsed reservations (reuses the authoritative BR-011 engine) and
 *  records an audit entry + notification for each reservation that transitioned. */
export async function runReservationExpiry(actor: Actor): Promise<{ expired: number; notified: number }> {
  const db = await getDb();
  // Capture the ids that are about to lapse so the transition can be audited
  // without modifying the authoritative engine.
  const lapsing = await db
    .select({ id: reservations.id, code: reservations.code })
    .from(reservations)
    .where(and(eq(reservations.organizationId, actor.organizationId), eq(reservations.isActive, true), sql`${reservations.expiryDate} < ${todayIso()}`))
    .limit(1000);

  const expired = await expireLapsedReservations(actor.organizationId); // BR-011: expire + release unit

  let notified = 0;
  for (const r of lapsing) {
    await recordAudit(db, {
      organizationId: actor.organizationId,
      action: 'update',
      entityType: 'reservation',
      entityId: r.id,
      entityLabel: r.code,
      newValue: { status: 'expired' },
      reason: 'reservation_expired',
      actor: actor.id ? { id: actor.id, fullName: actor.fullName } : undefined,
    });
    const ok = await ensureNotification(db, {
      organizationId: actor.organizationId, notificationType: 'reservation_expired', entityType: 'reservation', entityId: r.id, recencyDays: 7,
      requiredPermission: 'reservations:view', severity: 'warning',
      title: `Reservation ${r.code} expired`, body: 'The unit has been released per policy.', linkHref: `/leasing/reservations/${r.id}`,
    });
    if (ok) notified += 1;
  }
  return { expired, notified };
}

/* -------------------------------------------------------------------------- */
/* Phase 13 — document & warranty expiry                                       */
/* -------------------------------------------------------------------------- */

// Upcoming windows + a short look-back so freshly-expired items also alert once.
export const DOCUMENT_EXPIRY_WINDOW_DAYS = 60;
export const WARRANTY_EXPIRY_WINDOW_DAYS = 90;
const EXPIRED_LOOKBACK_DAYS = 30;

/** Safe parent-entity link for a document (never the storage key/path). */
function documentEntityHref(entityType: string, entityId: string): string {
  switch (entityType) {
    case 'property': return `/properties/${entityId}`;
    case 'unit': return `/units/${entityId}`;
    case 'contract': return `/contracts/${entityId}`;
    case 'asset': return `/assets/${entityId}`;
    case 'customer': return `/leasing/customers/${entityId}`;
    case 'tenant': return `/tenants/${entityId}`;
    default: return '/compliance?type=document';
  }
}

/**
 * Documents approaching (or freshly past) their expiry date. Only current,
 * non-deleted documents with an expiry are considered. Each notification is
 * targeted by the document's own requiredPermission (or documents:view), so a
 * confidential document only ever alerts users who may access it; the storage
 * key/path is never referenced.
 */
export async function generateDocumentExpiryNotifications(organizationId: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ id: documents.id, title: documents.title, entityType: documents.entityType, entityId: documents.entityId, expiryDate: documents.expiryDate, requiredPermission: documents.requiredPermission })
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, organizationId),
        isNull(documents.deletedAt),
        eq(documents.isCurrentVersion, true),
        isNotNull(documents.expiryDate),
        gte(documents.expiryDate, isoInDays(-EXPIRED_LOOKBACK_DAYS)),
        lte(documents.expiryDate, isoInDays(DOCUMENT_EXPIRY_WINDOW_DAYS)),
      ),
    )
    .limit(500);

  const today = todayIso();
  let created = 0;
  for (const d of rows) {
    const expired = (d.expiryDate ?? '') < today;
    const ok = await ensureNotification(db, {
      organizationId,
      notificationType: 'document_expiry',
      entityType: 'document',
      entityId: d.id,
      recencyDays: 30,
      requiredPermission: d.requiredPermission ?? 'documents:view',
      severity: expired ? 'error' : 'warning',
      title: expired ? `Document “${d.title}” has expired` : `Document “${d.title}” expires soon`,
      body: `Expiry date ${d.expiryDate}.`,
      linkHref: documentEntityHref(d.entityType, d.entityId),
    });
    if (ok) created += 1;
  }
  return created;
}

/**
 * Assets whose warranty is approaching (or freshly past) expiry. Decommissioned
 * assets are excluded. Targeted to assets:view holders.
 */
export async function generateWarrantyExpiryNotifications(organizationId: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ id: maintenanceAssets.id, code: maintenanceAssets.code, name: maintenanceAssets.nameEn, warrantyExpiryDate: maintenanceAssets.warrantyExpiryDate })
    .from(maintenanceAssets)
    .where(
      and(
        eq(maintenanceAssets.organizationId, organizationId),
        isNull(maintenanceAssets.deletedAt),
        ne(maintenanceAssets.status, 'decommissioned'),
        isNotNull(maintenanceAssets.warrantyExpiryDate),
        gte(maintenanceAssets.warrantyExpiryDate, isoInDays(-EXPIRED_LOOKBACK_DAYS)),
        lte(maintenanceAssets.warrantyExpiryDate, isoInDays(WARRANTY_EXPIRY_WINDOW_DAYS)),
      ),
    )
    .limit(500);

  const today = todayIso();
  let created = 0;
  for (const a of rows) {
    const expired = (a.warrantyExpiryDate ?? '') < today;
    const ok = await ensureNotification(db, {
      organizationId,
      notificationType: 'warranty_expiry',
      entityType: 'asset',
      entityId: a.id,
      recencyDays: 30,
      requiredPermission: 'assets:view',
      severity: expired ? 'error' : 'warning',
      title: expired ? `Warranty expired: ${a.name}` : `Warranty expiring: ${a.name}`,
      body: `Asset ${a.code} · warranty ${a.warrantyExpiryDate}.`,
      linkHref: `/assets/${a.id}`,
    });
    if (ok) created += 1;
  }
  return created;
}

export interface AutomationSummary {
  organizationId: string;
  generated: {
    contractExpiry: number;
    reservationExpiry: number;
    preventiveMaintenance: number;
    leadFollowUp: number;
    renewal: number;
    overdueInvoices: number;
    slaBreach: number;
    documentExpiry: number;
    warrantyExpiry: number;
  };
  reservationsExpired: number;
  notificationsCreated: number;
}

/** Runs every notification generator plus the reservation-expiry job for one
 *  organization. Idempotent and safe to invoke repeatedly (scheduler entry). */
export async function generateAllNotifications(actor: Actor): Promise<AutomationSummary> {
  const org = actor.organizationId;
  const [contractExpiry, reservationExpiry, preventiveMaintenance, leadFollowUp, renewal] = [
    await generateContractExpiryNotifications(org),
    await generateReservationExpiryNotifications(org),
    await generatePreventiveMaintenanceNotifications(org),
    await generateLeadFollowUpNotifications(org),
    await generateRenewalNotifications(org),
  ];
  const overdue = await generateOverdueNotifications({ id: actor.id, organizationId: org, fullName: actor.fullName });
  const sla = await generateSlaBreachNotifications({ organizationId: org });
  const documentExpiry = await generateDocumentExpiryNotifications(org);
  const warrantyExpiry = await generateWarrantyExpiryNotifications(org);
  const expiry = await runReservationExpiry(actor);

  const generated = {
    contractExpiry,
    reservationExpiry,
    preventiveMaintenance,
    leadFollowUp,
    renewal,
    overdueInvoices: overdue.notificationsCreated,
    slaBreach: sla.notificationsCreated,
    documentExpiry,
    warrantyExpiry,
  };
  const notificationsCreated =
    contractExpiry + reservationExpiry + preventiveMaintenance + leadFollowUp + renewal + overdue.notificationsCreated + sla.notificationsCreated + documentExpiry + warrantyExpiry + expiry.notified;

  return { organizationId: org, generated, reservationsExpired: expiry.expired, notificationsCreated };
}

/** Runs the automation for every organization. Used by the scheduled cron job,
 *  which has no principal/organization context; each organization is processed
 *  with a system actor. */
export async function generateAllNotificationsForAllOrganizations(): Promise<{ organizations: number; notificationsCreated: number; reservationsExpired: number }> {
  const db = await getDb();
  const orgs = await db.select({ id: organizations.id }).from(organizations).where(isNull(organizations.deletedAt));
  let notificationsCreated = 0;
  let reservationsExpired = 0;
  for (const org of orgs) {
    const summary = await generateAllNotifications({ id: null, organizationId: org.id, fullName: 'Automation' });
    notificationsCreated += summary.notificationsCreated;
    reservationsExpired += summary.reservationsExpired;
  }
  return { organizations: orgs.length, notificationsCreated, reservationsExpired };
}
