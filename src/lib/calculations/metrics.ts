import { round2, safeDivide } from '@/lib/utils';

/**
 * Pure KPI formulas. Every dashboard, report and export calls these functions
 * rather than repeating arithmetic (BR-016). They take plain numbers so they
 * are trivially unit-testable and reusable on both server and client.
 *
 * Definitions and thresholds live in ./kpi-dictionary.ts.
 */

export interface OccupancyInput {
  totalUnits: number;
  occupiedUnits: number;
  totalLeasableArea?: number;
  occupiedLeasableArea?: number;
}

export function occupancyRate({ totalUnits, occupiedUnits }: OccupancyInput): number {
  return round2(safeDivide(occupiedUnits, totalUnits) * 100);
}

export function vacancyRate(input: OccupancyInput): number {
  return round2(100 - occupancyRate(input));
}

export function areaOccupancyRate(input: OccupancyInput): number {
  return round2(safeDivide(input.occupiedLeasableArea ?? 0, input.totalLeasableArea ?? 0) * 100);
}

/** Contracted rent as a share of the rent achievable at full occupancy. */
export function economicOccupancyRate(contractedAnnualRent: number, annualRentalValue: number): number {
  return round2(safeDivide(contractedAnnualRent, annualRentalValue) * 100);
}

export interface CollectionInput {
  billed: number;
  collected: number;
}

export function collectionRate({ billed, collected }: CollectionInput): number {
  return round2(safeDivide(collected, billed) * 100);
}

export function outstandingAmount({ billed, collected }: CollectionInput): number {
  return round2(Math.max(0, billed - collected));
}

export interface NoiInput {
  grossRentalIncome: number;
  vacancyLoss: number;
  operatingExpenses: number;
}

/** NOI = Gross Rental Income − Vacancy Loss − Operating Expenses (BRD 57). */
export function netOperatingIncome({
  grossRentalIncome,
  vacancyLoss,
  operatingExpenses,
}: NoiInput): number {
  return round2(grossRentalIncome - vacancyLoss - operatingExpenses);
}

export function noiMargin(input: NoiInput): number {
  const noi = netOperatingIncome(input);
  return round2(safeDivide(noi, input.grossRentalIncome) * 100);
}

export function grossYield(annualRentalValue: number, marketValue: number): number {
  return round2(safeDivide(annualRentalValue, marketValue) * 100);
}

export function netYield(annualisedNoi: number, marketValue: number): number {
  return round2(safeDivide(annualisedNoi, marketValue) * 100);
}

export function capRate(stabilisedNoi: number, marketValue: number): number {
  return round2(safeDivide(stabilisedNoi, marketValue) * 100);
}

export function perSquareMetre(total: number, leasableArea: number): number {
  return round2(safeDivide(total, leasableArea));
}

/**
 * Rent forgone while units stand vacant, pro-rated by days in the period
 * (BRD 78). `annualRentOfVacantUnits` is the asking rent of the vacant stock.
 */
export function vacancyLoss(annualRentOfVacantUnits: number, daysVacant: number): number {
  return round2((annualRentOfVacantUnits / 365) * daysVacant);
}

export function daysOnMarket(firstPublishDate: Date | null, leaseSignedDate: Date | null): number | null {
  if (!firstPublishDate || !leaseSignedDate) return null;
  return Math.max(0, Math.round((leaseSignedDate.getTime() - firstPublishDate.getTime()) / 86_400_000));
}

export function renewalRate(renewedContracts: number, contractsDue: number): number {
  return round2(safeDivide(renewedContracts, contractsDue) * 100);
}

export interface WaleEntry {
  annualRent: number;
  /** Years remaining until expiry; may be fractional. */
  yearsToExpiry: number;
}

/** Weighted Average Lease Expiry in years, weighted by annual rent (BRD 81). */
export function wale(entries: WaleEntry[]): number {
  const totalRent = entries.reduce((sum, e) => sum + e.annualRent, 0);
  if (totalRent === 0) return 0;
  const weighted = entries.reduce((sum, e) => sum + e.annualRent * Math.max(0, e.yearsToExpiry), 0);
  return round2(weighted / totalRent);
}

export function conversionRate(converted: number, total: number): number {
  return round2(safeDivide(converted, total) * 100);
}

export function costPerLead(spend: number, leads: number): number {
  return round2(safeDivide(spend, leads));
}

/** Return on ad spend expressed as a percentage (BRD 97). */
export function returnOnAdSpend(attributedContractValue: number, spend: number): number {
  return round2(safeDivide(attributedContractValue, spend) * 100);
}

export function marketingRoi(attributedContractValue: number, spend: number): number {
  if (spend === 0) return 0;
  return round2(((attributedContractValue - spend) / spend) * 100);
}

export function slaCompliance(withinSla: number, completed: number): number {
  return round2(safeDivide(withinSla, completed) * 100);
}

export interface VarianceResult {
  actual: number;
  budget: number;
  variance: number;
  variancePercent: number;
  favourable: boolean;
}

/**
 * Budget-versus-actual variance (BRD 72). For cost lines a lower actual is
 * favourable, so `higherIsBetter` flips the interpretation.
 */
export function budgetVariance(actual: number, budget: number, higherIsBetter = true): VarianceResult {
  const variance = round2(actual - budget);
  const variancePercent = round2(safeDivide(variance, budget) * 100);
  return {
    actual: round2(actual),
    budget: round2(budget),
    variance,
    variancePercent,
    favourable: higherIsBetter ? variance >= 0 : variance <= 0,
  };
}

/** Period-on-period change as a percentage (BRD 73). */
export function periodChange(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return round2(((current - previous) / Math.abs(previous)) * 100);
}

export interface AgingBucketDefinition {
  key: string;
  label: string;
  minDays: number;
  maxDays: number;
}

export interface AgingRow {
  balance: number;
  daysOverdue: number;
}

export interface AgingBucketResult extends AgingBucketDefinition {
  amount: number;
  count: number;
  share: number;
}

/** Receivables aging (BRD 46). */
export function ageReceivables(
  rows: AgingRow[],
  buckets: AgingBucketDefinition[],
): AgingBucketResult[] {
  const total = rows.reduce((sum, row) => sum + row.balance, 0);
  return buckets.map((bucket) => {
    const matching = rows.filter(
      (row) => row.daysOverdue >= bucket.minDays && row.daysOverdue <= bucket.maxDays,
    );
    const amount = round2(matching.reduce((sum, row) => sum + row.balance, 0));
    return {
      ...bucket,
      amount,
      count: matching.length,
      share: round2(safeDivide(amount, total) * 100),
    };
  });
}

/** Weighted average age of outstanding receivables. */
export function averageDaysOutstanding(rows: AgingRow[]): number {
  const totalBalance = rows.reduce((sum, row) => sum + row.balance, 0);
  if (totalBalance === 0) return 0;
  const weighted = rows.reduce((sum, row) => sum + row.balance * Math.max(0, row.daysOverdue), 0);
  return Math.round(weighted / totalBalance);
}

export interface ConcentrationEntry {
  key: string;
  label: string;
  revenue: number;
}

/** Tenant / industry concentration (BRD 82). */
export function concentration(entries: ConcentrationEntry[], topN = 10) {
  const total = entries.reduce((sum, e) => sum + e.revenue, 0);
  const ranked = [...entries]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, topN)
    .map((entry) => ({
      ...entry,
      revenue: round2(entry.revenue),
      share: round2(safeDivide(entry.revenue, total) * 100),
    }));
  return { total: round2(total), entries: ranked, topShare: ranked[0]?.share ?? 0 };
}
