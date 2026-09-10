/**
 * Report catalog (BRD 112-114). A client-safe registry over the existing
 * executive report types the report-service already renders — no new PDF
 * pipelines or duplicate report definitions. Each entry names the permission
 * required and a human label; scheduling and generation reuse these keys.
 */

export const REPORT_TYPES = [
  'portfolio_summary',
  'financial_performance',
  'occupancy',
  'collections',
  'maintenance',
  'leasing',
  'property_ranking',
] as const;
export type ReportTypeKey = (typeof REPORT_TYPES)[number];

export function isReportType(value: unknown): value is ReportTypeKey {
  return typeof value === 'string' && (REPORT_TYPES as readonly string[]).includes(value);
}

export interface ReportCatalogEntry {
  key: ReportTypeKey;
  label: string;
  description: string;
}

export const REPORT_CATALOG: ReportCatalogEntry[] = [
  { key: 'portfolio_summary', label: 'Executive Portfolio Report', description: 'Portfolio KPIs, value, occupancy, revenue, NOI, risks and management actions.' },
  { key: 'financial_performance', label: 'Financial Performance Report', description: 'Revenue, collections, outstanding, OPEX, NOI and margins.' },
  { key: 'occupancy', label: 'Occupancy Report', description: 'Occupancy, vacancy, leased and available units across the scope.' },
  { key: 'collections', label: 'Collections Report', description: 'Billed, collected, outstanding, overdue and aging analysis.' },
  { key: 'maintenance', label: 'Maintenance Report', description: 'Work orders, SLA, maintenance cost and preventive maintenance.' },
  { key: 'leasing', label: 'Leasing Activity Report', description: 'Leasing pipeline, conversions, contracts and renewals.' },
  { key: 'property_ranking', label: 'Property Ranking Report', description: 'Best and lowest performing properties by occupancy, collection and NOI.' },
];

export const REPORT_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
export type ReportFrequency = (typeof REPORT_FREQUENCIES)[number];
export function isReportFrequency(value: unknown): value is ReportFrequency {
  return typeof value === 'string' && (REPORT_FREQUENCIES as readonly string[]).includes(value);
}

export const REPORT_PERIODS = ['3m', '6m', '12m', 'ytd'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];
export function isReportPeriod(value: unknown): value is ReportPeriod {
  return typeof value === 'string' && (REPORT_PERIODS as readonly string[]).includes(value);
}
