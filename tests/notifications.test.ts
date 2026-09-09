import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { bootstrapTestDb } from './setup-db';
import type { Database } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth/session')>();
  return { ...mod, getSession: vi.fn() };
});

const FOREIGN_ORG = '00000000-0000-4000-8000-000000000000';
const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

let db: Database;
let cleanup: () => void;
let admin: SessionUser;
let getSessionMock: ReturnType<typeof vi.fn>;

async function notifFor(type: string, entityId: string): Promise<number> {
  const { notifications } = await import('@/db/schema');
  const rows = await db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.organizationId, admin.organizationId), eq(notifications.notificationType, type), eq(notifications.entityId, entityId)));
  return rows.length;
}

beforeAll(async () => {
  const ctx = await bootstrapTestDb();
  db = ctx.db; cleanup = ctx.cleanup;
  const { users } = await import('@/db/schema');
  const { loadSessionUser, getSession } = await import('@/lib/auth/session');
  getSessionMock = getSession as unknown as ReturnType<typeof vi.fn>;
  const [u] = await db.select().from(users).where(eq(users.email, 'sayeed.almousa@riftara.sa')).limit(1);
  admin = (await loadSessionUser(u.id))!;
}, 180_000);

afterAll(() => cleanup?.());

describe('Contract expiry notifications', () => {
  it('notifies contracts inside the window, ignores those outside, and is idempotent', async () => {
    const { generateContractExpiryNotifications } = await import('@/services/notification-service');
    const { contracts } = await import('@/db/schema');
    const active = await db.select({ id: contracts.id, status: contracts.status }).from(contracts).where(and(eq(contracts.organizationId, admin.organizationId), isNull(contracts.deletedAt))).limit(3);
    const inWindow = active[0].id, outWindow = active[1].id;
    await db.update(contracts).set({ status: 'active', endDate: isoIn(10) }).where(eq(contracts.id, inWindow));
    await db.update(contracts).set({ status: 'active', endDate: isoIn(9999) }).where(eq(contracts.id, outWindow));

    await generateContractExpiryNotifications(admin.organizationId);
    expect(await notifFor('contract_expiry', inWindow)).toBe(1);
    expect(await notifFor('contract_expiry', outWindow)).toBe(0);
    await generateContractExpiryNotifications(admin.organizationId); // idempotent
    expect(await notifFor('contract_expiry', inWindow)).toBe(1);
  });

  it('ignores non signed/active contracts and other organizations', async () => {
    const { generateContractExpiryNotifications } = await import('@/services/notification-service');
    const { contracts, notifications } = await import('@/db/schema');
    // Use a distinct contract and clear any prior notification for it.
    const rows = await db.select({ id: contracts.id }).from(contracts).where(and(eq(contracts.organizationId, admin.organizationId), isNull(contracts.deletedAt))).offset(2).limit(1);
    const draft = rows[0];
    await db.delete(notifications).where(and(eq(notifications.notificationType, 'contract_expiry'), eq(notifications.entityId, draft.id)));
    await db.update(contracts).set({ status: 'draft', endDate: isoIn(10) }).where(eq(contracts.id, draft.id));
    await generateContractExpiryNotifications(admin.organizationId);
    expect(await notifFor('contract_expiry', draft.id)).toBe(0);
    expect(await generateContractExpiryNotifications(FOREIGN_ORG)).toBe(0);
  });
});

describe('Reservation expiry (notification + BR-011 job)', () => {
  it('notifies reservations expiring soon', async () => {
    const { generateReservationExpiryNotifications } = await import('@/services/notification-service');
    const { reservations } = await import('@/db/schema');
    const [r] = await db.select({ id: reservations.id }).from(reservations).where(and(eq(reservations.organizationId, admin.organizationId), eq(reservations.isActive, true))).limit(1);
    await db.update(reservations).set({ status: 'active', isActive: true, expiryDate: isoIn(2) }).where(eq(reservations.id, r.id));
    await generateReservationExpiryNotifications(admin.organizationId);
    expect(await notifFor('reservation_expiry', r.id)).toBe(1);
  });

  it('expires lapsed reservations, releases the unit, audits and notifies (idempotent)', async () => {
    const { runReservationExpiry } = await import('@/services/notification-service');
    const { reservations, auditLogs } = await import('@/db/schema');
    const [r] = await db.select({ id: reservations.id, unitId: reservations.unitId }).from(reservations).where(and(eq(reservations.organizationId, admin.organizationId), eq(reservations.isActive, true))).limit(1);
    await db.update(reservations).set({ status: 'active', isActive: true, expiryDate: isoIn(-1) }).where(eq(reservations.id, r.id));

    const first = await runReservationExpiry({ id: admin.id, organizationId: admin.organizationId, fullName: admin.fullName });
    expect(first.expired).toBeGreaterThan(0);
    const [row] = await db.select({ status: reservations.status, isActive: reservations.isActive }).from(reservations).where(eq(reservations.id, r.id));
    expect(row.status).toBe('expired');
    expect(row.isActive).toBe(false);
    expect(await notifFor('reservation_expired', r.id)).toBe(1);
    const audit = await db.select({ reason: auditLogs.reason }).from(auditLogs).where(and(eq(auditLogs.entityType, 'reservation'), eq(auditLogs.entityId, r.id)));
    expect(audit.some((a) => a.reason === 'reservation_expired')).toBe(true);

    // Idempotent: nothing left to expire on a second run.
    const second = await runReservationExpiry({ id: admin.id, organizationId: admin.organizationId, fullName: admin.fullName });
    expect(second.expired).toBe(0);
  });
});

describe('PM, follow-up and renewal generators', () => {
  it('notifies preventive maintenance due within the window', async () => {
    const { generatePreventiveMaintenanceNotifications } = await import('@/services/notification-service');
    const { preventiveMaintenanceSchedules } = await import('@/db/schema');
    const [s] = await db.select({ id: preventiveMaintenanceSchedules.id }).from(preventiveMaintenanceSchedules).where(eq(preventiveMaintenanceSchedules.organizationId, admin.organizationId)).limit(1);
    await db.update(preventiveMaintenanceSchedules).set({ isActive: true, nextDueDate: isoIn(5) }).where(eq(preventiveMaintenanceSchedules.id, s.id));
    await generatePreventiveMaintenanceNotifications(admin.organizationId);
    expect(await notifFor('maintenance_pm_due', s.id)).toBe(1);
  });

  it('notifies leads whose follow-up is due', async () => {
    const { generateLeadFollowUpNotifications } = await import('@/services/notification-service');
    const { leads } = await import('@/db/schema');
    const [l] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.organizationId, admin.organizationId), isNull(leads.closedAt), isNull(leads.deletedAt))).limit(1);
    await db.update(leads).set({ nextFollowUpAt: new Date(Date.now() - 3_600_000) }).where(eq(leads.id, l.id));
    await generateLeadFollowUpNotifications(admin.organizationId);
    expect(await notifFor('follow_up_due', l.id)).toBe(1);
  });

  it('notifies renewals for contracts not yet started', async () => {
    const { generateRenewalNotifications } = await import('@/services/notification-service');
    const { contracts } = await import('@/db/schema');
    const [c] = await db.select({ id: contracts.id }).from(contracts).where(and(eq(contracts.organizationId, admin.organizationId), isNull(contracts.deletedAt))).limit(1);
    await db.update(contracts).set({ status: 'active', renewalStatus: 'not_started', endDate: isoIn(60) }).where(eq(contracts.id, c.id));
    await generateRenewalNotifications(admin.organizationId);
    expect(await notifFor('renewal_required', c.id)).toBe(1);
  });
});

describe('Aggregate runner, RBAC & cron', () => {
  it('runs all generators and returns a summary', async () => {
    const { generateAllNotifications } = await import('@/services/notification-service');
    const summary = await generateAllNotifications({ id: admin.id, organizationId: admin.organizationId, fullName: admin.fullName });
    expect(summary.organizationId).toBe(admin.organizationId);
    expect(summary.notificationsCreated).toBeGreaterThanOrEqual(0);
    expect(typeof summary.generated.contractExpiry).toBe('number');
  });

  it('denies the admin run action without settings:manage (RBAC)', async () => {
    const { runNotificationsAction } = await import('@/app/(app)/notifications/actions');
    getSessionMock.mockResolvedValue({ ...admin, permissions: [] });
    const denied = await runNotificationsAction();
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN');
  });

  it('the cron endpoint rejects missing/invalid credentials and accepts the secret', async () => {
    const { GET } = await import('@/app/api/cron/notifications/route');
    process.env.CRON_SECRET = 'cron-test-secret';
    const noAuth = await GET(new Request('http://localhost/api/cron/notifications') as never);
    expect(noAuth.status).toBe(401);
    const wrong = await GET(new Request('http://localhost/api/cron/notifications', { headers: { authorization: 'Bearer nope' } }) as never);
    expect(wrong.status).toBe(401);
    const ok = await GET(new Request('http://localhost/api/cron/notifications', { headers: { authorization: 'Bearer cron-test-secret' } }) as never);
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.data.organizations).toBeGreaterThan(0);
  });
});
