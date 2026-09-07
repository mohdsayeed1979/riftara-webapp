import { z } from 'zod';
import { requireApiPermission } from '@/lib/api/guard';
import { apiError } from '@/lib/api/response';
import { loadSessionUser } from '@/lib/auth/session';
import { AppError, validationError } from '@/lib/errors';
import { scopeFromSession } from '@/services/metrics-service';
import { generateReport, type ReportType } from '@/services/report-service';

export const dynamic = 'force-dynamic';

const schema = z.object({
  reportType: z.enum([
    'portfolio_summary',
    'financial_performance',
    'occupancy',
    'collections',
    'maintenance',
    'leasing',
    'property_ranking',
  ]),
  period: z.enum(['3m', '6m', '12m', 'ytd']).default('12m'),
  propertyId: z.string().uuid().optional(),
  commentary: z.string().max(4000).optional(),
});

const PERIOD_LABELS: Record<string, string> = {
  '3m': 'Last 3 months',
  '6m': 'Last 6 months',
  '12m': 'Last 12 months',
  ytd: 'Year to date',
};

/** POST /api/v1/reports/generate — generates and streams an executive PDF. */
export async function POST(request: Request) {
  try {
    const principal = await requireApiPermission('reports:view');
    if (!principal.userId) throw new AppError('FORBIDDEN', 'A user session is required.');
    const actor = await loadSessionUser(principal.userId);
    if (!actor) throw new AppError('UNAUTHENTICATED', 'Session could not be resolved.');
    if (!actor.permissions.includes('reports:create') && !actor.permissions.includes('reports:export')) {
      throw new AppError('FORBIDDEN', 'You do not have permission to generate reports.');
    }

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) throw validationError('Invalid report request.', parsed.error.issues);

    const now = new Date();
    let periodStart: Date;
    if (parsed.data.period === 'ytd') {
      periodStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    } else {
      const months = Number(parsed.data.period.replace('m', ''));
      periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1));
    }

    const scope = scopeFromSession(actor, {
      propertyId: parsed.data.propertyId ?? null,
      periodStart,
      periodEnd: now,
    });

    const scopeLabel = parsed.data.propertyId ? 'Selected property' : 'Entire portfolio';
    const { reference, pdf } = await generateReport(actor, {
      reportType: parsed.data.reportType as ReportType,
      scope,
      scopeLabel,
      periodLabel: PERIOD_LABELS[parsed.data.period],
      commentary: parsed.data.commentary,
    });

    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="riftara-${reference}.pdf"`,
        'X-Report-Filename': `riftara-${reference}.pdf`,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
