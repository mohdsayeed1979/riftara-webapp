import { round2 } from '@/lib/utils';

/**
 * Contract financial engine: payment schedules, VAT, escalation and payment
 * allocation. Kept pure so it can be unit-tested and reused by the API,
 * server actions and the proposal generator.
 */

export type PaymentFrequency = 'monthly' | 'quarterly' | 'semi_annual' | 'annual' | 'custom';

export const INSTALLMENTS_PER_YEAR: Record<Exclude<PaymentFrequency, 'custom'>, number> = {
  monthly: 12,
  quarterly: 4,
  semi_annual: 2,
  annual: 1,
};

export interface ScheduleInput {
  startDate: Date;
  endDate: Date;
  annualRent: number;
  serviceCharges: number;
  paymentFrequency: PaymentFrequency;
  vatRateBps: number;
  /** Annual rent escalation, applied every `escalationFrequencyMonths`. */
  escalationPercent?: number;
  escalationFrequencyMonths?: number;
  /** Days of free rent at the start of the term. */
  gracePeriodDays?: number;
  /** Days before the due date on which the invoice is issued. */
  invoiceLeadDays?: number;
}

export interface ScheduleInstallment {
  installmentNumber: number;
  periodStart: Date;
  periodEnd: Date;
  invoiceDate: Date;
  dueDate: Date;
  rentAmount: number;
  serviceChargeAmount: number;
  vatAmount: number;
  totalAmount: number;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const daysInMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, daysInMonth));
  return result;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Generates the full payment schedule for a contract (BRD 40).
 * The final instalment is pro-rated when the term does not divide evenly.
 */
export function generatePaymentSchedule(input: ScheduleInput): ScheduleInstallment[] {
  const {
    startDate,
    endDate,
    annualRent,
    serviceCharges,
    paymentFrequency,
    vatRateBps,
    escalationPercent = 0,
    escalationFrequencyMonths = 12,
    gracePeriodDays = 0,
    invoiceLeadDays = 30,
  } = input;

  if (endDate <= startDate) return [];

  const perYear =
    paymentFrequency === 'custom' ? 1 : INSTALLMENTS_PER_YEAR[paymentFrequency];
  const monthsPerInstallment = 12 / perYear;
  const vatRate = vatRateBps / 10_000;

  const installments: ScheduleInstallment[] = [];
  let periodStart = new Date(startDate);
  let installmentNumber = 0;

  while (periodStart < endDate) {
    installmentNumber += 1;
    const naturalEnd = addDays(addMonths(periodStart, monthsPerInstallment), -1);
    const periodEnd = naturalEnd > endDate ? new Date(endDate) : naturalEnd;

    // Escalation applies from each anniversary of the start date.
    const monthsElapsed =
      (periodStart.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
      (periodStart.getUTCMonth() - startDate.getUTCMonth());
    const escalationSteps =
      escalationPercent > 0 ? Math.floor(monthsElapsed / escalationFrequencyMonths) : 0;
    const escalationFactor = (1 + escalationPercent / 100) ** escalationSteps;

    // Pro-rate a short final period.
    const fullPeriodDays = Math.round(
      (addDays(addMonths(periodStart, monthsPerInstallment), -1).getTime() - periodStart.getTime()) /
        86_400_000 +
        1,
    );
    const actualDays = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86_400_000) + 1;
    const proRataFactor = fullPeriodDays > 0 ? Math.min(1, actualDays / fullPeriodDays) : 1;

    let rentAmount = round2((annualRent / perYear) * escalationFactor * proRataFactor);
    const serviceChargeAmount = round2((serviceCharges / perYear) * proRataFactor);

    // Grace period reduces the first instalment's rent, never the service charge.
    if (installmentNumber === 1 && gracePeriodDays > 0) {
      const graceFactor = Math.max(0, 1 - gracePeriodDays / Math.max(1, actualDays));
      rentAmount = round2(rentAmount * graceFactor);
    }

    const vatAmount = round2((rentAmount + serviceChargeAmount) * vatRate);
    const totalAmount = round2(rentAmount + serviceChargeAmount + vatAmount);

    const dueDate = new Date(periodStart);
    installments.push({
      installmentNumber,
      periodStart: new Date(periodStart),
      periodEnd,
      invoiceDate: addDays(dueDate, -invoiceLeadDays),
      dueDate,
      rentAmount,
      serviceChargeAmount,
      vatAmount,
      totalAmount,
    });

    periodStart = addMonths(periodStart, monthsPerInstallment);
  }

  return installments;
}

export function contractTotalValue(installments: ScheduleInstallment[]): number {
  return round2(installments.reduce((sum, i) => sum + i.totalAmount, 0));
}

export function vatAmount(base: number, vatRateBps: number): number {
  return round2(base * (vatRateBps / 10_000));
}

/** Duration in whole months between two dates. */
export function durationMonths(startDate: Date, endDate: Date): number {
  const months =
    (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
    (endDate.getUTCMonth() - startDate.getUTCMonth());
  return endDate.getUTCDate() >= startDate.getUTCDate() ? months + 1 : months;
}

/* -------------------------------------------------------------------------- */
/* Payment allocation (BRD 49)                                                 */
/* -------------------------------------------------------------------------- */

export interface AllocatableInvoice {
  invoiceId: string;
  dueDate: Date;
  balance: number;
}

export interface AllocationLine {
  invoiceId: string;
  amount: number;
}

export interface AllocationResult {
  lines: AllocationLine[];
  allocated: number;
  unallocated: number;
}

/**
 * Allocates a payment across open invoices, oldest due date first.
 * A partial payment settles as much of the oldest invoice as it can; any
 * remainder stays unallocated and is reported for manual matching.
 */
export function allocatePayment(
  paymentAmount: number,
  openInvoices: AllocatableInvoice[],
): AllocationResult {
  const ordered = [...openInvoices]
    .filter((invoice) => invoice.balance > 0)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

  const lines: AllocationLine[] = [];
  let remaining = round2(paymentAmount);

  for (const invoice of ordered) {
    if (remaining <= 0) break;
    const amount = round2(Math.min(remaining, invoice.balance));
    if (amount <= 0) continue;
    lines.push({ invoiceId: invoice.invoiceId, amount });
    remaining = round2(remaining - amount);
  }

  return {
    lines,
    allocated: round2(paymentAmount - remaining),
    unallocated: remaining,
  };
}

/** Derives the invoice status from its amounts and the current date. */
export function deriveInvoiceStatus(input: {
  totalAmount: number;
  paidAmount: number;
  dueDate: Date;
  invoiceDate: Date;
  cancelled?: boolean;
  waived?: boolean;
  now?: Date;
}): 'upcoming' | 'due' | 'paid' | 'partially_paid' | 'overdue' | 'cancelled' | 'waived' {
  const now = input.now ?? new Date();
  if (input.cancelled) return 'cancelled';
  if (input.waived) return 'waived';

  const balance = round2(input.totalAmount - input.paidAmount);
  if (balance <= 0.01) return 'paid';

  const isPastDue = now > input.dueDate;
  if (input.paidAmount > 0) return isPastDue ? 'overdue' : 'partially_paid';
  if (isPastDue) return 'overdue';
  return now >= input.invoiceDate ? 'due' : 'upcoming';
}

export function daysOverdue(dueDate: Date, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - dueDate.getTime()) / 86_400_000));
}
