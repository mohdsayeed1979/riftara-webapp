import 'server-only';
import { and, desc, eq, isNull, lte } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { notifications, organizations, reportScheduleRuns, reportSchedules } from '@/db/schema';
import { recordAudit } from '@/lib/audit';
import { forbidden, notFound, validationError } from '@/lib/errors';
import { loadSessionUser, type SessionUser } from '@/lib/auth/session';
import { scopeFromSession } from '@/services/metrics-service';
import { generateReport } from '@/services/report-service';
import {
  isReportFrequency,
  isReportPeriod,
  isReportType,
  type ReportFrequency,
  type ReportPeriod,
  type ReportTypeKey,
} from '@/lib/reports/catalog';

/**
 * Scheduled reporting engine (BRD 117). Schedules store WHAT to generate (report
 * type + frozen config) and WHEN (frequency in a timezone). Execution reuses the
 * existing report-service and runs with the CREATING user's live permissions and
 * data scope, so a schedule can never surface data the creator could not
 * generate manually. In-app delivery only; email/SMS/WhatsApp are future.
 */

const PERIOD_LABELS: Record<ReportPeriod, string> = {
  '3m': 'Last 3 months',
  '6m': 'Last 6 months',
  '12m': 'Last 12 months',
  ytd: 'Year to date',
};

export interface ScheduleActor {
  organizationId: string;
  id: string | null;
  fullName: string;
}

/* --------------------------- Timezone next-run ---------------------------- */

function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value])) as Record<string, string>;
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - date.getTime();
}

/** Instant (UTC) for a wall-clock time in a timezone. */
function wallToUtc(y: number, mo: number, d: number, hour: number, timeZone: string): Date {
  const guess = Date.UTC(y, mo, d, hour, 0, 0);
  const offset = tzOffsetMs(new Date(guess), timeZone);
  return new Date(guess - offset);
}

function localYmd(date: Date, timeZone: string): { y: number; mo: number; d: number } {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value])) as Record<string, string>;
  return { y: Number(p.year), mo: Number(p.month) - 1, d: Number(p.day) };
}

export interface ScheduleTiming {
  frequency: ReportFrequency;
  hour: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  timezone: string;
}

/** Next run instant strictly after `from`, honouring the timezone + frequency. */
export function computeNextRun(from: Date, timing: ScheduleTiming): Date {
  const base = localYmd(from, timing.timezone);
  for (let i = 0; i <= 400; i += 1) {
    const civil = new Date(Date.UTC(base.y, base.mo, base.d + i));
    const y = civil.getUTCFullYear();
    const mo = civil.getUTCMonth();
    const day = civil.getUTCDate();
    if (timing.frequency === 'weekly' && civil.getUTCDay() !== (timing.dayOfWeek ?? 1)) continue;
    if (timing.frequency === 'monthly' && day !== Math.min(Math.max(timing.dayOfMonth ?? 1, 1), 28)) continue;
    const runAt = wallToUtc(y, mo, day, timing.hour, timing.timezone);
    if (runAt.getTime() > from.getTime()) return runAt;
  }
  return new Date(from.getTime() + 86_400_000);
}

/* -------------------------------- Config ---------------------------------- */

export interface ScheduleConfig {
  period: ReportPeriod;
  propertyId?: string | null;
  commentary?: string | null;
}

function normalizeTiming(input: Partial<ScheduleTiming> & { frequency: ReportFrequency }): ScheduleTiming {
  const hour = Math.min(23, Math.max(0, Math.floor(input.hour ?? 3)));
  return {
    frequency: input.frequency,
    hour,
    dayOfWeek: input.frequency === 'weekly' ? Math.min(6, Math.max(0, Math.floor(input.dayOfWeek ?? 1))) : null,
    dayOfMonth: input.frequency === 'monthly' ? Math.min(28, Math.max(1, Math.floor(input.dayOfMonth ?? 1))) : null,
    timezone: input.timezone || 'Asia/Riyadh',
  };
}

function validateConfig(config: ScheduleConfig): ScheduleConfig {
  if (!isReportPeriod(config.period)) throw validationError('Invalid reporting period.');
  return { period: config.period, propertyId: config.propertyId ?? null, commentary: config.commentary?.slice(0, 4000) ?? null };
}

/* -------------------------------- CRUD ------------------------------------ */

export interface CreateScheduleInput {
  name: string;
  reportType: ReportTypeKey;
  frequency: ReportFrequency;
  hour?: number;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  timezone?: string;
  config: ScheduleConfig;
}

async function orgTimezone(organizationId: string): Promise<string> {
  const db = await getDb();
  const [org] = await db.select({ tz: organizations.timezone }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  return org?.tz ?? 'Asia/Riyadh';
}

export async function createSchedule(actor: ScheduleActor, input: CreateScheduleInput): Promise<{ id: string; nextRunAt: Date }> {
  if (!isReportType(input.reportType)) throw validationError('Unknown report type.');
  if (!isReportFrequency(input.frequency)) throw validationError('Unknown frequency.');
  const config = validateConfig(input.config);
  const timezone = input.timezone || (await orgTimezone(actor.organizationId));
  const timing = normalizeTiming({ ...input, timezone });
  const nextRunAt = computeNextRun(new Date(), timing);

  const db = await getDb();
  const [created] = await db
    .insert(reportSchedules)
    .values({
      organizationId: actor.organizationId,
      name: input.name.trim().slice(0, 200),
      reportType: input.reportType,
      frequency: timing.frequency,
      hour: timing.hour,
      dayOfWeek: timing.dayOfWeek,
      dayOfMonth: timing.dayOfMonth,
      timezone: timing.timezone,
      isActive: true,
      config: config as unknown as Record<string, unknown>,
      nextRunAt,
      createdByUserId: actor.id,
      updatedByUserId: actor.id,
    })
    .returning({ id: reportSchedules.id });

  await recordAudit(db, {
    organizationId: actor.organizationId,
    action: 'create',
    entityType: 'report_schedule',
    entityId: created.id,
    entityLabel: input.name,
    newValue: { reportType: input.reportType, frequency: timing.frequency, nextRunAt },
    actor: actor.id ? { id: actor.id, fullName: actor.fullName } : null,
  });
  return { id: created.id, nextRunAt };
}

export async function listSchedules(organizationId: string) {
  const db = await getDb();
  return db
    .select()
    .from(reportSchedules)
    .where(and(eq(reportSchedules.organizationId, organizationId), isNull(reportSchedules.deletedAt)))
    .orderBy(desc(reportSchedules.createdAt));
}

async function loadOwned(db: Awaited<ReturnType<typeof getDb>>, organizationId: string, id: string) {
  const [row] = await db
    .select()
    .from(reportSchedules)
    .where(and(eq(reportSchedules.id, id), eq(reportSchedules.organizationId, organizationId), isNull(reportSchedules.deletedAt)))
    .limit(1);
  if (!row) throw notFound('Report schedule', id);
  return row;
}

export async function getSchedule(organizationId: string, id: string) {
  const db = await getDb();
  return loadOwned(db, organizationId, id);
}

export interface UpdateScheduleInput {
  name?: string;
  reportType?: ReportTypeKey;
  frequency?: ReportFrequency;
  hour?: number;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  timezone?: string;
  config?: ScheduleConfig;
  isActive?: boolean;
}

export async function updateSchedule(actor: ScheduleActor, id: string, input: UpdateScheduleInput): Promise<{ id: string }> {
  const db = await getDb();
  const existing = await loadOwned(db, actor.organizationId, id);

  if (input.reportType && !isReportType(input.reportType)) throw validationError('Unknown report type.');
  if (input.frequency && !isReportFrequency(input.frequency)) throw validationError('Unknown frequency.');

  const timing = normalizeTiming({
    frequency: input.frequency ?? (existing.frequency as ReportFrequency),
    hour: input.hour ?? existing.hour,
    dayOfWeek: input.dayOfWeek ?? existing.dayOfWeek,
    dayOfMonth: input.dayOfMonth ?? existing.dayOfMonth,
    timezone: input.timezone ?? existing.timezone,
  });
  const timingChanged = Boolean(input.frequency || input.hour !== undefined || input.dayOfWeek !== undefined || input.dayOfMonth !== undefined || input.timezone);

  const patch: Record<string, unknown> = { updatedAt: new Date(), updatedByUserId: actor.id };
  if (input.name !== undefined) patch.name = input.name.trim().slice(0, 200);
  if (input.reportType !== undefined) patch.reportType = input.reportType;
  if (input.config !== undefined) patch.config = validateConfig(input.config);
  if (input.isActive !== undefined) patch.isActive = input.isActive;
  // Recompute the next run when the timing changes OR the schedule is being
  // re-enabled — otherwise a schedule disabled for weeks would fire immediately
  // for a long-past occurrence on the next cron tick.
  const reEnabling = input.isActive === true && !existing.isActive;
  if (timingChanged || reEnabling) {
    patch.frequency = timing.frequency;
    patch.hour = timing.hour;
    patch.dayOfWeek = timing.dayOfWeek;
    patch.dayOfMonth = timing.dayOfMonth;
    patch.timezone = timing.timezone;
    patch.nextRunAt = computeNextRun(new Date(), timing);
  }

  await db.update(reportSchedules).set(patch).where(eq(reportSchedules.id, id));
  await recordAudit(db, {
    organizationId: actor.organizationId,
    action: 'update',
    entityType: 'report_schedule',
    entityId: id,
    entityLabel: existing.name,
    newValue: patch,
    actor: actor.id ? { id: actor.id, fullName: actor.fullName } : null,
  });
  return { id };
}

export async function setScheduleActive(actor: ScheduleActor, id: string, isActive: boolean): Promise<{ id: string; isActive: boolean }> {
  const db = await getDb();
  const existing = await loadOwned(db, actor.organizationId, id);
  const patch: Record<string, unknown> = { isActive, updatedAt: new Date(), updatedByUserId: actor.id };
  // Re-enabling recomputes the next run from now so it never fires immediately for a past slot.
  if (isActive && !existing.isActive) {
    patch.nextRunAt = computeNextRun(new Date(), { frequency: existing.frequency as ReportFrequency, hour: existing.hour, dayOfWeek: existing.dayOfWeek, dayOfMonth: existing.dayOfMonth, timezone: existing.timezone });
  }
  await db.update(reportSchedules).set(patch).where(eq(reportSchedules.id, id));
  await recordAudit(db, {
    organizationId: actor.organizationId,
    action: 'update',
    entityType: 'report_schedule',
    entityId: id,
    entityLabel: existing.name,
    reason: isActive ? 'schedule_enabled' : 'schedule_disabled',
    actor: actor.id ? { id: actor.id, fullName: actor.fullName } : null,
  });
  return { id, isActive };
}

/** Soft-deletes (deactivates) a schedule; execution history is preserved. */
export async function deleteSchedule(actor: ScheduleActor, id: string): Promise<{ id: string }> {
  const db = await getDb();
  const existing = await loadOwned(db, actor.organizationId, id);
  await db.update(reportSchedules).set({ deletedAt: new Date(), isActive: false, updatedAt: new Date(), updatedByUserId: actor.id }).where(eq(reportSchedules.id, id));
  await recordAudit(db, {
    organizationId: actor.organizationId,
    action: 'soft_delete',
    entityType: 'report_schedule',
    entityId: id,
    entityLabel: existing.name,
    actor: actor.id ? { id: actor.id, fullName: actor.fullName } : null,
  });
  return { id };
}

export async function listScheduleHistory(organizationId: string, scheduleId: string, limit = 25) {
  const db = await getDb();
  await loadOwned(db, organizationId, scheduleId); // authorize
  return db
    .select({ id: reportScheduleRuns.id, status: reportScheduleRuns.status, reportType: reportScheduleRuns.reportType, format: reportScheduleRuns.format, durationMs: reportScheduleRuns.durationMs, reportRunId: reportScheduleRuns.reportRunId, failureMessage: reportScheduleRuns.failureMessage, createdAt: reportScheduleRuns.createdAt })
    .from(reportScheduleRuns)
    .where(and(eq(reportScheduleRuns.organizationId, organizationId), eq(reportScheduleRuns.scheduleId, scheduleId)))
    .orderBy(desc(reportScheduleRuns.createdAt))
    .limit(limit);
}

/* ------------------------------ Execution --------------------------------- */

function periodStartFor(period: ReportPeriod, now: Date): Date {
  if (period === 'ytd') return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const months = Number(period.replace('m', ''));
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1));
}

/**
 * Executes one schedule and records a history row (success or failure). Never
 * throws — failures are captured so a bad schedule cannot break the cron run.
 *
 * `runAs` is the identity the report is generated under. For scheduled (cron)
 * execution it is omitted and the schedule's CREATOR is loaded live, so the run
 * uses exactly the permissions and data scope the creator has right now. For a
 * manual "Run now" the caller passes their OWN session, so a user can never use
 * run-now to obtain data outside their own access (BRD 126, BR-016).
 */
async function executeSchedule(
  schedule: typeof reportSchedules.$inferSelect,
  runAs?: SessionUser,
): Promise<{ status: 'success' | 'failed'; reportRunId: string | null; message: string | null }> {
  const db = await getDb();
  const startedAt = Date.now();
  const config = (schedule.config ?? {}) as unknown as ScheduleConfig;
  let status: 'success' | 'failed' = 'failed';
  let reportRunId: string | null = null;
  let message: string | null = null;

  try {
    let identity: SessionUser | null = runAs ?? null;
    if (!identity) {
      if (!schedule.createdByUserId) throw new Error('Schedule has no owner to run as.');
      identity = await loadSessionUser(schedule.createdByUserId);
    }
    if (!identity) throw new Error('Schedule owner is inactive; the schedule cannot run.');
    if (identity.organizationId !== schedule.organizationId) throw new Error('Owner/organization mismatch.');
    if (!identity.permissions.includes('reports:create') && !identity.permissions.includes('reports:export')) {
      throw new Error('Schedule owner no longer has permission to generate reports.');
    }
    const period = isReportPeriod(config.period) ? config.period : '12m';
    const now = new Date();
    const scope = scopeFromSession(identity, {
      propertyId: config.propertyId ?? null,
      periodStart: periodStartFor(period, now),
      periodEnd: now,
    });
    const result = await generateReport(identity, {
      reportType: schedule.reportType as ReportTypeKey,
      scope,
      scopeLabel: config.propertyId ? 'Property' : 'Portfolio',
      periodLabel: PERIOD_LABELS[period],
      commentary: config.commentary ?? undefined,
    });
    reportRunId = result.reportRunId;
    status = 'success';
  } catch (error) {
    status = 'failed';
    message = error instanceof Error ? error.message : 'Report generation failed.';
  }

  await db.insert(reportScheduleRuns).values({
    organizationId: schedule.organizationId,
    scheduleId: schedule.id,
    reportType: schedule.reportType,
    status,
    format: schedule.format,
    durationMs: Date.now() - startedAt,
    reportRunId,
    failureMessage: message,
  });

  if (status === 'failed') {
    // Surface failures in the existing notification center (reports:view holders).
    await db.insert(notifications).values({
      organizationId: schedule.organizationId,
      requiredPermission: 'reports:view',
      notificationType: 'report_failed',
      severity: 'error',
      title: `Scheduled report failed: ${schedule.name}`,
      body: message,
      linkHref: '/reports?tab=schedules',
      entityType: 'report_schedule',
      entityId: schedule.id,
    }).catch(() => undefined);
  }

  return { status, reportRunId, message };
}

/**
 * Manual "Run now" for a single schedule. The report is generated under the
 * CALLER's own live session (not the creator's), so run-now can never surface
 * data the caller could not generate manually. Does not change the next
 * scheduled occurrence.
 */
export async function runScheduleNow(caller: SessionUser, id: string): Promise<{ status: 'success' | 'failed'; reportRunId: string | null }> {
  const db = await getDb();
  const schedule = await loadOwned(db, caller.organizationId, id);
  if (!caller.permissions.includes('reports:create') && !caller.permissions.includes('reports:export')) {
    throw forbidden('You do not have permission to generate reports.');
  }
  const outcome = await executeSchedule(schedule, caller);
  await db.update(reportSchedules).set({ lastRunAt: new Date(), lastStatus: outcome.status }).where(eq(reportSchedules.id, id));
  await recordAudit(db, {
    organizationId: caller.organizationId,
    action: 'export',
    entityType: 'report_schedule',
    entityId: id,
    entityLabel: schedule.name,
    reason: 'schedule_run_now',
    newValue: { status: outcome.status, reportRunId: outcome.reportRunId },
    actor: { id: caller.id, fullName: caller.fullName },
  });
  return { status: outcome.status, reportRunId: outcome.reportRunId };
}

/**
 * Runs every due schedule across all organizations (scheduler entry). Idempotent
 * per occurrence: the occurrence is CLAIMED by advancing next_run_at before
 * execution, so a slow or crashed run never double-generates the same slot.
 */
export async function runDueReportSchedules(now: Date = new Date()): Promise<{ processed: number; succeeded: number; failed: number }> {
  const db = await getDb();
  const due = await db
    .select()
    .from(reportSchedules)
    .where(and(eq(reportSchedules.isActive, true), isNull(reportSchedules.deletedAt), lte(reportSchedules.nextRunAt, now)))
    .limit(500);

  let succeeded = 0;
  let failed = 0;
  for (const schedule of due) {
    // Claim the occurrence: advance next_run_at first (idempotency guard).
    const timing: ScheduleTiming = { frequency: schedule.frequency as ReportFrequency, hour: schedule.hour, dayOfWeek: schedule.dayOfWeek, dayOfMonth: schedule.dayOfMonth, timezone: schedule.timezone };
    const nextRunAt = computeNextRun(now, timing);
    await db.update(reportSchedules).set({ nextRunAt, lastRunAt: now }).where(eq(reportSchedules.id, schedule.id));

    const outcome = await executeSchedule(schedule);
    await db.update(reportSchedules).set({ lastStatus: outcome.status }).where(eq(reportSchedules.id, schedule.id));
    if (outcome.status === 'success') succeeded += 1;
    else failed += 1;
  }
  return { processed: due.length, succeeded, failed };
}
