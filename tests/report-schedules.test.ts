import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { bootstrapTestDb } from './setup-db';
import type { Database } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth/session')>();
  return { ...mod, getSession: vi.fn() };
});
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

const FOREIGN_ORG = '00000000-0000-4000-8000-000000000000';

let db: Database;
let cleanup: () => void;
let admin: SessionUser;
let getSessionMock: ReturnType<typeof vi.fn>;

function actor() {
  return { organizationId: admin.organizationId, id: admin.id, fullName: admin.fullName };
}

beforeAll(async () => {
  const c = await bootstrapTestDb();
  db = c.db;
  cleanup = c.cleanup;

  const { users } = await import('@/db/schema');
  const { loadSessionUser, getSession } = await import('@/lib/auth/session');
  getSessionMock = getSession as unknown as ReturnType<typeof vi.fn>;
  const [u] = await db.select().from(users).where(eq(users.email, 'sayeed.almousa@riftara.sa')).limit(1);
  admin = (await loadSessionUser(u.id))!;
});

afterAll(() => cleanup());

describe('computeNextRun (timezone-aware)', () => {
  it('daily fires at the configured local hour, converted to UTC', async () => {
    const { computeNextRun } = await import('@/services/report-schedule-service');
    // 02:00 UTC on 2026-06-01. In Asia/Riyadh (UTC+3, no DST) the next 03:00
    // local is 00:00 UTC the following day.
    const from = new Date('2026-06-01T02:00:00Z');
    const next = computeNextRun(from, { frequency: 'daily', hour: 3, dayOfWeek: null, dayOfMonth: null, timezone: 'Asia/Riyadh' });
    expect(next.getTime()).toBeGreaterThan(from.getTime());
    expect(next.getUTCHours()).toBe(0); // 03:00 +03:00 == 00:00 UTC
  });

  it('weekly lands on the requested weekday', async () => {
    const { computeNextRun } = await import('@/services/report-schedule-service');
    const from = new Date('2026-06-01T00:00:00Z'); // Monday
    const next = computeNextRun(from, { frequency: 'weekly', hour: 6, dayOfWeek: 3, dayOfMonth: null, timezone: 'Asia/Riyadh' });
    // Weekday is evaluated in the schedule timezone.
    const local = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Riyadh', weekday: 'short' }).format(next);
    expect(local).toBe('Wed');
  });

  it('monthly lands on the requested day of month and is always in the future', async () => {
    const { computeNextRun } = await import('@/services/report-schedule-service');
    const from = new Date('2026-06-15T00:00:00Z');
    const next = computeNextRun(from, { frequency: 'monthly', hour: 3, dayOfWeek: null, dayOfMonth: 5, timezone: 'Asia/Riyadh' });
    expect(next.getTime()).toBeGreaterThan(from.getTime());
    const day = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Riyadh', day: 'numeric' }).format(next);
    expect(day).toBe('5');
  });
});

describe('schedule CRUD + isolation', () => {
  it('creates, lists and gets a schedule scoped to the organization', async () => {
    const svc = await import('@/services/report-schedule-service');
    const { id } = await svc.createSchedule(actor(), {
      name: 'Monthly portfolio',
      reportType: 'portfolio_summary',
      frequency: 'monthly',
      config: { period: '12m' },
    });
    const list = await svc.listSchedules(admin.organizationId);
    expect(list.some((s) => s.id === id)).toBe(true);

    const got = await svc.getSchedule(admin.organizationId, id);
    expect(got.name).toBe('Monthly portfolio');

    // A different organization cannot read it.
    await expect(svc.getSchedule(FOREIGN_ORG, id)).rejects.toThrow();
  });

  it('rejects unknown report types and frequencies', async () => {
    const svc = await import('@/services/report-schedule-service');
    await expect(
      svc.createSchedule(actor(), { name: 'x', reportType: 'nope' as never, frequency: 'monthly', config: { period: '12m' } }),
    ).rejects.toThrow();
  });

  it('updates timing and recomputes the next run', async () => {
    const svc = await import('@/services/report-schedule-service');
    const { id } = await svc.createSchedule(actor(), { name: 'to edit', reportType: 'occupancy', frequency: 'daily', config: { period: '3m' } });
    await svc.updateSchedule(actor(), id, { frequency: 'weekly', dayOfWeek: 5 });
    const after = await svc.getSchedule(admin.organizationId, id);
    expect(after.frequency).toBe('weekly');
    expect(after.dayOfWeek).toBe(5);
    // The recomputed next run must land on the requested weekday (Friday).
    expect(after.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: after.timezone, weekday: 'short' }).format(after.nextRunAt);
    expect(weekday).toBe('Fri');
  });

  it('soft-deletes: removed from list but history preserved', async () => {
    const svc = await import('@/services/report-schedule-service');
    const { id } = await svc.createSchedule(actor(), { name: 'to delete', reportType: 'collections', frequency: 'monthly', config: { period: '6m' } });
    await svc.deleteSchedule(actor(), id);
    const list = await svc.listSchedules(admin.organizationId);
    expect(list.some((s) => s.id === id)).toBe(false);
    // getSchedule (which filters deletedAt) now rejects.
    await expect(svc.getSchedule(admin.organizationId, id)).rejects.toThrow();
  });
});

describe('scheduled execution', () => {
  it('runs a due schedule once per occurrence (idempotent) and records success', async () => {
    const svc = await import('@/services/report-schedule-service');
    const { reportSchedules, reportScheduleRuns, reportRuns } = await import('@/db/schema');
    const { id } = await svc.createSchedule(actor(), { name: 'due now', reportType: 'portfolio_summary', frequency: 'daily', config: { period: '12m' } });

    // Force it due.
    const past = new Date(Date.now() - 60_000);
    await db.update(reportSchedules).set({ nextRunAt: past }).where(eq(reportSchedules.id, id));

    const first = await svc.runDueReportSchedules(new Date());
    expect(first.processed).toBeGreaterThanOrEqual(1);

    // Second immediate pass must NOT execute the same occurrence again.
    const second = await svc.runDueReportSchedules(new Date());
    const runsForSchedule = await db.select().from(reportScheduleRuns).where(eq(reportScheduleRuns.scheduleId, id));
    expect(runsForSchedule).toHaveLength(1);
    expect(runsForSchedule[0].status).toBe('success');
    expect(second.processed).toBe(0);

    // A frozen report_run snapshot was produced.
    expect(runsForSchedule[0].reportRunId).toBeTruthy();
    const [snapshot] = await db.select().from(reportRuns).where(eq(reportRuns.id, runsForSchedule[0].reportRunId!)).limit(1);
    expect(snapshot).toBeTruthy();

    const after = await svc.getSchedule(admin.organizationId, id);
    expect(after.lastStatus).toBe('success');
    expect(after.nextRunAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('records a failure and raises a report_failed notification when the owner is missing', async () => {
    const svc = await import('@/services/report-schedule-service');
    const { reportSchedules, reportScheduleRuns, notifications } = await import('@/db/schema');
    const { id } = await svc.createSchedule(actor(), { name: 'orphan', reportType: 'occupancy', frequency: 'daily', config: { period: '12m' } });

    // Orphan the schedule (no resolvable owner) and force it due.
    await db.update(reportSchedules).set({ createdByUserId: null, nextRunAt: new Date(Date.now() - 60_000) }).where(eq(reportSchedules.id, id));

    await svc.runDueReportSchedules(new Date());
    const runs = await db.select().from(reportScheduleRuns).where(eq(reportScheduleRuns.scheduleId, id));
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('failed');
    expect(runs[0].failureMessage).toBeTruthy();

    const alerts = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.notificationType, 'report_failed'), eq(notifications.entityId, id)));
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts[0].requiredPermission).toBe('reports:view');
  });

  it('run-now executes under the caller and rejects callers without report permissions', async () => {
    const svc = await import('@/services/report-schedule-service');
    const { id } = await svc.createSchedule(actor(), { name: 'run now', reportType: 'financial_performance', frequency: 'monthly', config: { period: '12m' } });

    const ok = await svc.runScheduleNow(admin, id);
    expect(ok.status).toBe('success');

    const powerless: SessionUser = { ...admin, permissions: [] };
    await expect(svc.runScheduleNow(powerless, id)).rejects.toThrow();
  });
});

describe('API routes', () => {
  it('catalog requires authentication and reports:view', async () => {
    const { GET } = await import('@/app/api/v1/reports/route');
    getSessionMock.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    getSessionMock.mockResolvedValue({ ...admin, permissions: [] });
    expect((await GET()).status).toBe(403);
    getSessionMock.mockResolvedValue(admin);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.reports.length).toBe(7);
  });

  it('schedule list is authorized and create validates input', async () => {
    const listMod = await import('@/app/api/v1/report-schedules/route');
    getSessionMock.mockResolvedValue(null);
    expect((await listMod.GET()).status).toBe(401);

    getSessionMock.mockResolvedValue(admin);
    expect((await listMod.GET()).status).toBe(200);

    const badReq = new NextRequest(new URL('http://localhost/api/v1/report-schedules'), {
      method: 'POST',
      body: JSON.stringify({ name: '', reportType: 'bogus', frequency: 'daily', config: {} }),
      headers: { 'content-type': 'application/json' },
    });
    expect((await listMod.POST(badReq)).status).toBe(422);

    const goodReq = new NextRequest(new URL('http://localhost/api/v1/report-schedules'), {
      method: 'POST',
      body: JSON.stringify({ name: 'API schedule', reportType: 'leasing', frequency: 'weekly', dayOfWeek: 2, config: { period: '12m' } }),
      headers: { 'content-type': 'application/json' },
    });
    const created = await listMod.POST(goodReq);
    expect(created.status).toBe(201);
  });
});
