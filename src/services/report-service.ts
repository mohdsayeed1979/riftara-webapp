import 'server-only';
import { count, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { organizations, reportRuns } from '@/db/schema';
import { recordAudit } from '@/lib/audit';
import { formatCompactCurrency, formatCurrency, formatPercent } from '@/lib/format';
import type { ExecutiveReportInput, PdfSection } from '@/lib/export/pdf';
import {
  getCollectionSummary,
  getExecutiveExceptions,
  getMaintenanceSummary,
  getPortfolioSummary,
  getPropertyPerformance,
  getTenantConcentration,
  type MetricScope,
} from './metrics-service';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Executive report generator (BRD 112-118).
 *
 * A generated report freezes a data snapshot (BRD 118) so a historical report
 * never changes when live data moves on.
 */

export type ReportType =
  | 'portfolio_summary'
  | 'financial_performance'
  | 'occupancy'
  | 'collections'
  | 'maintenance'
  | 'leasing'
  | 'property_ranking';

export interface GenerateReportInput {
  reportType: ReportType;
  scope: MetricScope;
  scopeLabel: string;
  periodLabel: string;
  commentary?: string;
}

interface ReportData {
  input: ExecutiveReportInput;
  snapshot: Record<string, unknown>;
}

/** Builds the report content from the shared metrics services (BR-016). */
async function buildReportData(
  organizationName: string,
  generatedBy: string,
  input: GenerateReportInput,
): Promise<ReportData> {
  const [summary, collections, maintenance, performance, concentration, exceptions] = await Promise.all([
    getPortfolioSummary(input.scope),
    getCollectionSummary(input.scope),
    getMaintenanceSummary(input.scope),
    getPropertyPerformance(input.scope),
    getTenantConcentration(input.scope, 5),
    getExecutiveExceptions(input.scope),
  ]);

  const money = (value: number) => formatCompactCurrency(value);
  const pct = (value: number) => formatPercent(value);

  const kpis = [
    { label: 'Portfolio Value', value: money(summary.marketValue) },
    { label: 'Annual Rental Value', value: money(summary.annualRentalValue) },
    { label: 'Contracted Revenue', value: money(summary.contractedRevenue) },
    { label: 'Collected Revenue', value: money(summary.collectedRevenue), sub: `${pct(summary.collectionRate)} rate` },
    { label: 'Occupancy Rate', value: pct(summary.occupancyRate), sub: `${summary.occupiedUnits}/${summary.totalUnits} units` },
    { label: 'Net Operating Income', value: money(summary.netOperatingIncome), sub: `${pct(summary.noiMargin)} margin` },
  ];

  const sections: PdfSection[] = [];

  sections.push({
    title: 'Executive Summary',
    body:
      `The portfolio comprises ${summary.propertyCount} properties and ${summary.totalUnits} units with a current market ` +
      `value of ${formatCurrency(summary.marketValue)}. Occupancy stands at ${pct(summary.occupancyRate)} and the ` +
      `collection rate at ${pct(summary.collectionRate)}. Net operating income for the period is ` +
      `${formatCurrency(summary.netOperatingIncome)} at a ${pct(summary.noiMargin)} margin.`,
  });

  sections.push({
    title: 'Financial Performance',
    facts: [
      { label: 'Portfolio Market Value', value: formatCurrency(summary.marketValue) },
      { label: 'Book Value', value: formatCurrency(summary.bookValue) },
      { label: 'Annual Rental Value', value: formatCurrency(summary.annualRentalValue) },
      { label: 'Contracted Revenue', value: formatCurrency(summary.contractedRevenue) },
      { label: 'Operating Expenses', value: formatCurrency(summary.operatingExpenses) },
      { label: 'Maintenance Cost', value: formatCurrency(summary.maintenanceCost) },
      { label: 'Net Operating Income', value: formatCurrency(summary.netOperatingIncome) },
      { label: 'Gross Yield', value: pct(summary.grossYield) },
    ],
  });

  sections.push({
    title: 'Occupancy & Vacancy',
    facts: [
      { label: 'Occupied Units', value: String(summary.occupiedUnits) },
      { label: 'Available Units', value: String(summary.availableUnits) },
      { label: 'Occupancy Rate', value: pct(summary.occupancyRate) },
      { label: 'Vacancy Rate', value: pct(summary.vacancyRate) },
      { label: 'Vacant Leasable Area', value: `${summary.vacantLeasableArea.toLocaleString()} m²` },
      { label: 'Vacancy Loss', value: formatCurrency(summary.vacancyLoss) },
      { label: 'Expiring Contracts', value: String(summary.expiringContracts) },
      { label: 'WALE', value: `${summary.wale} years` },
    ],
  });

  sections.push({
    title: 'Collections & Overdue Analysis',
    facts: [
      { label: 'Total Billed', value: formatCurrency(collections.billed) },
      { label: 'Total Collected', value: formatCurrency(collections.collected) },
      { label: 'Outstanding', value: formatCurrency(collections.outstanding) },
      { label: 'Overdue', value: formatCurrency(collections.overdue) },
      { label: 'Collection Rate', value: pct(collections.collectionRate) },
      { label: 'Avg Days Outstanding', value: `${collections.averageDaysOutstanding} days` },
    ],
    table: {
      headers: ['Aging Bucket', 'Amount', 'Invoices', 'Share'],
      rows: collections.aging.map((bucket) => [
        bucket.label,
        formatCurrency(bucket.amount),
        String(bucket.count),
        `${bucket.share}%`,
      ]),
    },
  });

  sections.push({
    title: 'Maintenance',
    facts: [
      { label: 'Total Work Orders', value: String(maintenance.total) },
      { label: 'Completed', value: String(maintenance.completed) },
      { label: 'Open', value: String(maintenance.open + maintenance.assigned + maintenance.inProgress) },
      { label: 'Avg Resolution', value: `${maintenance.averageResolutionDays} days` },
      { label: 'SLA Compliance', value: pct(maintenance.slaCompliance) },
      { label: 'Total Cost', value: formatCurrency(maintenance.totalCost) },
    ],
  });

  if (performance.length > 0) {
    sections.push({
      title: 'Property Performance Ranking',
      table: {
        headers: ['Property', 'Occupancy', 'Collection', 'NOI', 'Yield'],
        rows: [...performance]
          .sort((a, b) => b.netOperatingIncome - a.netOperatingIncome)
          .slice(0, 12)
          .map((property) => [
            property.name,
            pct(property.occupancyRate),
            pct(property.collectionRate),
            formatCurrency(property.netOperatingIncome),
            pct(property.grossYield),
          ]),
      },
    });
  }

  if (concentration.entries.length > 0) {
    sections.push({
      title: 'Tenant Concentration',
      table: {
        headers: ['Tenant', 'Annual Rent', 'Share'],
        rows: concentration.entries.map((entry) => [entry.label, formatCurrency(entry.revenue), `${entry.share}%`]),
      },
    });
  }

  sections.push({
    title: 'Key Risks',
    bullets:
      exceptions.length > 0
        ? exceptions.map((exception) => `${exception.title}: ${exception.detail} (${exception.value}).`)
        : ['No exceptions above configured thresholds for this period.'],
  });

  sections.push({
    title: 'Management Actions',
    bullets: buildManagementActions(summary, collections, exceptions.length),
  });

  if (input.commentary) {
    sections.push({ title: 'Executive Commentary', body: input.commentary });
  }

  const reportInput: ExecutiveReportInput = {
    title: reportTitle(input.reportType),
    subtitle: input.scopeLabel,
    organizationName,
    periodLabel: input.periodLabel,
    scopeLabel: input.scopeLabel,
    generatedBy,
    kpis,
    sections,
  };

  const snapshot = {
    summary,
    collections,
    maintenance,
    concentration,
    exceptions,
    performance: performance.slice(0, 20),
    generatedAt: new Date().toISOString(),
  };

  return { input: reportInput, snapshot };
}

function reportTitle(type: ReportType): string {
  const titles: Record<ReportType, string> = {
    portfolio_summary: 'Executive Portfolio Report',
    financial_performance: 'Financial Performance Report',
    occupancy: 'Occupancy Report',
    collections: 'Collections Report',
    maintenance: 'Maintenance Report',
    leasing: 'Leasing Activity Report',
    property_ranking: 'Property Ranking Report',
  };
  return titles[type];
}

function buildManagementActions(
  summary: Awaited<ReturnType<typeof getPortfolioSummary>>,
  collections: Awaited<ReturnType<typeof getCollectionSummary>>,
  exceptionCount: number,
): string[] {
  const actions: string[] = [];
  if (summary.vacancyRate > 10) {
    actions.push(`Accelerate leasing on ${summary.availableUnits} vacant units to reduce the ${summary.vacancyRate}% vacancy rate.`);
  }
  if (collections.overdue > 0) {
    actions.push(`Pursue ${formatCurrency(collections.overdue)} in overdue receivables through the collection escalation workflow.`);
  }
  if (summary.expiringContracts > 0) {
    actions.push(`Begin renewal discussions for ${summary.expiringContracts} contracts expiring within the alert window.`);
  }
  if (exceptionCount > 0) {
    actions.push('Review the flagged exceptions and assign owners for remediation.');
  }
  if (actions.length === 0) {
    actions.push('Portfolio performance is within target thresholds; maintain the current operating plan.');
  }
  return actions;
}

/** Generates a report, persists its snapshot, and returns the PDF buffer. */
export async function generateReport(
  actor: SessionUser,
  input: GenerateReportInput,
): Promise<{ reference: string; pdf: Buffer; reportRunId: string }> {
  const db = await getDb();
  const [org] = await db
    .select({ nameEn: organizations.nameEn })
    .from(organizations)
    .where(eq(organizations.id, actor.organizationId))
    .limit(1);

  const { input: reportInput, snapshot } = await buildReportData(
    org?.nameEn ?? 'RIFTARA',
    actor.fullName,
    input,
  );

  const { generateExecutiveReportPdf } = await import('@/lib/export/pdf');
  const pdf = await generateExecutiveReportPdf(reportInput);

  const [{ total }] = await db
    .select({ total: count() })
    .from(reportRuns)
    .where(eq(reportRuns.organizationId, actor.organizationId));
  const reference = `RPT-${String(Number(total) + 1).padStart(5, '0')}`;

  const [run] = await db
    .insert(reportRuns)
    .values({
      organizationId: actor.organizationId,
      reference,
      reportType: input.reportType,
      title: reportInput.title,
      scopeType: input.scope.propertyId ? 'property' : 'portfolio',
      scopeId: input.scope.propertyId ?? null,
      periodStart: (input.scope.periodStart ?? new Date()).toISOString().slice(0, 10),
      periodEnd: (input.scope.periodEnd ?? new Date()).toISOString().slice(0, 10),
      format: 'pdf',
      snapshot,
      executiveCommentary: input.commentary ?? null,
      generatedByUserId: actor.id,
    })
    .returning({ id: reportRuns.id });

  await recordAudit(db, {
    organizationId: actor.organizationId,
    action: 'export',
    entityType: 'report',
    entityId: run.id,
    entityLabel: reference,
    newValue: { reportType: input.reportType, format: 'pdf' },
    actor: { id: actor.id, fullName: actor.fullName },
  });

  return { reference, pdf, reportRunId: run.id };
}

export async function listReportRuns(organizationId: string, limit = 25) {
  const db = await getDb();
  return db
    .select({
      id: reportRuns.id,
      reference: reportRuns.reference,
      title: reportRuns.title,
      reportType: reportRuns.reportType,
      periodStart: reportRuns.periodStart,
      periodEnd: reportRuns.periodEnd,
      createdAt: reportRuns.createdAt,
    })
    .from(reportRuns)
    .where(eq(reportRuns.organizationId, organizationId))
    .orderBy(desc(reportRuns.createdAt))
    .limit(limit);
}
