import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { reportRuns } from '@/db/schema';
import { requireApiPermission } from '@/lib/api/guard';
import { apiError } from '@/lib/api/response';
import { loadSessionUser } from '@/lib/auth/session';
import { AppError, notFound } from '@/lib/errors';
import { generateExecutiveReportPdf, type ExecutiveReportInput } from '@/lib/export/pdf';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/reports/:id/download — re-renders a stored report from its frozen
 * snapshot (BRD 118), so the download never reflects data that changed after
 * generation.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireApiPermission('reports:view');
    const { id } = await context.params;
    if (!principal.userId) throw new AppError('FORBIDDEN', 'A user session is required.');
    const actor = await loadSessionUser(principal.userId);
    if (!actor) throw new AppError('UNAUTHENTICATED', 'Session could not be resolved.');

    const db = await getDb();
    const [run] = await db
      .select()
      .from(reportRuns)
      .where(and(eq(reportRuns.id, id), eq(reportRuns.organizationId, principal.organizationId)))
      .limit(1);
    if (!run) throw notFound('Report', id);

    // Rebuild the PDF from the persisted snapshot rather than live data.
    const input = reportInputFromSnapshot(run);
    const pdf = await generateExecutiveReportPdf(input);

    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="riftara-${run.reference}.pdf"`,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

function reportInputFromSnapshot(run: typeof reportRuns.$inferSelect): ExecutiveReportInput {
  const snapshot = run.snapshot as Record<string, unknown>;
  const summary = (snapshot.summary ?? {}) as Record<string, number>;
  const collections = (snapshot.collections ?? {}) as Record<string, number>;

  const fmt = (value: number | undefined) => `SAR ${Number(value ?? 0).toLocaleString()}`;
  const pct = (value: number | undefined) => `${Number(value ?? 0)}%`;

  return {
    title: run.title,
    subtitle: run.scopeType === 'property' ? 'Selected property' : 'Entire portfolio',
    organizationName: 'RIFTARA',
    periodLabel: `${run.periodStart} to ${run.periodEnd}`,
    scopeLabel: run.scopeType === 'property' ? 'Selected property' : 'Entire portfolio',
    generatedBy: 'RIFTARA',
    kpis: [
      { label: 'Portfolio Value', value: fmt(summary.marketValue) },
      { label: 'Annual Rental Value', value: fmt(summary.annualRentalValue) },
      { label: 'Contracted Revenue', value: fmt(summary.contractedRevenue) },
      { label: 'Collected Revenue', value: fmt(summary.collectedRevenue), sub: `${pct(summary.collectionRate)} rate` },
      { label: 'Occupancy Rate', value: pct(summary.occupancyRate) },
      { label: 'Net Operating Income', value: fmt(summary.netOperatingIncome), sub: `${pct(summary.noiMargin)} margin` },
    ],
    sections: [
      {
        title: 'Financial Performance',
        facts: [
          { label: 'Portfolio Market Value', value: fmt(summary.marketValue) },
          { label: 'Annual Rental Value', value: fmt(summary.annualRentalValue) },
          { label: 'Operating Expenses', value: fmt(summary.operatingExpenses) },
          { label: 'Net Operating Income', value: fmt(summary.netOperatingIncome) },
        ],
      },
      {
        title: 'Collections',
        facts: [
          { label: 'Total Billed', value: fmt(collections.billed) },
          { label: 'Total Collected', value: fmt(collections.collected) },
          { label: 'Outstanding', value: fmt(collections.outstanding) },
          { label: 'Overdue', value: fmt(collections.overdue) },
        ],
      },
      run.executiveCommentary
        ? { title: 'Executive Commentary', body: run.executiveCommentary }
        : { title: 'Note', body: 'This report was rendered from the data snapshot captured at generation time.' },
    ],
    confidentiality: `Confidential — ${run.reference} — RIFTARA Enterprise Property Platform`,
  };
}
