import type { Metadata } from 'next';
import { FileText } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/page';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ReportGenerator } from '@/features/reports/report-generator';
import { requirePermission } from '@/lib/auth/guard';
import { formatDate, formatDateTime } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { listReportRuns } from '@/services/report-service';
import { getPropertyFilterOptions } from '@/services/property-service';

export const metadata: Metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const user = await requirePermission('reports:view');
  const locale = await getRequestLocale();

  const [runs, options] = await Promise.all([
    listReportRuns(user.organizationId),
    getPropertyFilterOptions(user.organizationId, user.scopedCityIds.length ? user.scopedCityIds : null),
  ]);

  const canCreate = user.permissions.includes('reports:create') || user.permissions.includes('reports:export');

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Reports"
        subtitle="Create management-ready reports with real-time data across your portfolio."
      />

      {canCreate ? <ReportGenerator properties={options.cities.length ? options : options} propertyOptions={options.types} allProperties={await propertiesForSelect(user.organizationId, user.scopedPropertyIds)} /> : null}

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
    </div>
  );
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
