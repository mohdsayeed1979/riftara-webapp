import type { Metadata } from 'next';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/page';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ReportGenerator } from '@/features/reports/report-generator';
import { ScheduleManager, type ScheduleView } from '@/features/reports/schedule-manager';
import { requirePermission } from '@/lib/auth/guard';
import { cn } from '@/lib/utils';
import { formatDate, formatDateTime } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { getMessages } from '@/i18n';
import { listReportRuns } from '@/services/report-service';
import { listSchedules } from '@/services/report-schedule-service';

export const metadata: Metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

type Tab = 'generate' | 'schedules';

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePermission('reports:view');
  const locale = await getRequestLocale();
  const t = getMessages(locale).reports;
  const tab: Tab = (await searchParams).tab === 'schedules' ? 'schedules' : 'generate';

  const [runs, allProperties, scheduleRows, timezone] = await Promise.all([
    listReportRuns(user.organizationId),
    propertiesForSelect(user.organizationId, user.scopedPropertyIds),
    listSchedules(user.organizationId),
    orgTimezone(user.organizationId),
  ]);

  const canCreate = user.permissions.includes('reports:create') || user.permissions.includes('reports:export');
  const canManageSchedules = user.permissions.includes('reports:create');

  const schedules: ScheduleView[] = scheduleRows.map((s) => ({
    id: s.id,
    name: s.name,
    reportType: s.reportType,
    frequency: s.frequency,
    hour: s.hour,
    dayOfWeek: s.dayOfWeek,
    dayOfMonth: s.dayOfMonth,
    timezone: s.timezone,
    isActive: s.isActive,
    nextRunAt: s.nextRunAt.toISOString(),
    lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
    lastStatus: s.lastStatus,
    config: (s.config ?? {}) as ScheduleView['config'],
  }));

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'generate', label: t.tabGenerate },
    { key: 'schedules', label: t.tabSchedules },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t.title} subtitle={t.subtitle} />

      <div className="flex gap-1 border-b border-[var(--color-border-subtle)]">
        {tabs.map((item) => (
          <Link
            key={item.key}
            href={item.key === 'generate' ? '/reports' : `/reports?tab=${item.key}`}
            className={cn(
              'border-b-2 px-4 py-2 text-[13.5px] font-medium transition-colors',
              tab === item.key
                ? 'border-[var(--color-brand-gold)] text-[var(--color-text-primary)]'
                : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
            )}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {tab === 'schedules' ? (
        <ScheduleManager
          schedules={schedules}
          properties={allProperties}
          defaultTimezone={timezone}
          canManage={canManageSchedules}
          locale={locale}
        />
      ) : (
        <>
          {canCreate ? <ReportGenerator allProperties={allProperties} /> : null}

          <Card>
        <CardHeader title="Generated Reports" description="Each report retains a snapshot of the data at generation time." />
        {runs.length === 0 ? (
          <EmptyState icon={<FileText />} title="No reports generated yet" description="Generate your first executive report above." />
        ) : (
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH>Reference</TH>
                  <TH>Report</TH>
                  <TH>Period</TH>
                  <TH alignment="end">Generated</TH>
                  <TH alignment="center">Download</TH>
                </TR>
              </THead>
              <TBody>
                {runs.map((run) => (
                  <TR key={run.id}>
                    <TD className="font-medium">{run.reference}</TD>
                    <TD>{run.title}</TD>
                    <TD className="whitespace-nowrap text-[var(--color-text-secondary)]">
                      {formatDate(run.periodStart, { locale, style: 'short' })} – {formatDate(run.periodEnd, { locale, style: 'short' })}
                    </TD>
                    <TD alignment="end" className="whitespace-nowrap text-[var(--color-text-secondary)]">
                      {formatDateTime(run.createdAt, { locale })}
                    </TD>
                    <TD alignment="center">
                      <a
                        href={`/api/v1/reports/${run.id}/download`}
                        className="text-[12px] font-medium text-[var(--color-info)] hover:underline"
                      >
                        PDF
                      </a>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        )}
          </Card>
        </>
      )}
    </div>
  );
}

async function orgTimezone(organizationId: string): Promise<string> {
  const { getDb } = await import('@/db/client');
  const { organizations } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');
  const db = await getDb();
  const [org] = await db.select({ tz: organizations.timezone }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  return org?.tz ?? 'Asia/Riyadh';
}

async function propertiesForSelect(organizationId: string, scopedPropertyIds: string[]) {
  const { getDb } = await import('@/db/client');
  const { properties } = await import('@/db/schema');
  const { and, eq, inArray, isNull } = await import('drizzle-orm');
  const db = await getDb();
  const rows = await db
    .select({ id: properties.id, name: properties.nameEn })
    .from(properties)
    .where(
      and(
        eq(properties.organizationId, organizationId),
        isNull(properties.deletedAt),
        scopedPropertyIds.length ? inArray(properties.id, scopedPropertyIds) : undefined,
      ),
    )
    .orderBy(properties.nameEn);
  return rows;
}
