import { describe, expect, it } from 'vitest';
import {
  ageReceivables,
  averageDaysOutstanding,
  budgetVariance,
  collectionRate,
  netOperatingIncome,
  noiMargin,
  occupancyRate,
  vacancyLoss,
  wale,
} from '@/lib/calculations/metrics';
import {
  allocatePayment,
  deriveInvoiceStatus,
  generatePaymentSchedule,
} from '@/lib/calculations/finance';
import { evaluatePricing } from '@/lib/calculations/pricing';
import { resolveAvailability, matchAlternativeUnits } from '@/lib/calculations/availability';

/**
 * Pure business-logic tests. These cover the calculation engine that every
 * dashboard, report and workflow relies on (BRD 72).
 */

describe('KPI calculations', () => {
  it('computes occupancy and vacancy as complements', () => {
    expect(occupancyRate({ totalUnits: 102, occupiedUnits: 99 })).toBeCloseTo(97.06, 1);
    expect(occupancyRate({ totalUnits: 0, occupiedUnits: 0 })).toBe(0);
  });

  it('computes collection rate', () => {
    expect(collectionRate({ billed: 180_000_000, collected: 168_500_000 })).toBeCloseTo(93.61, 1);
    expect(collectionRate({ billed: 0, collected: 0 })).toBe(0);
  });

  it('computes NOI = gross rental income - vacancy loss - opex', () => {
    const noi = netOperatingIncome({ grossRentalIncome: 100, vacancyLoss: 10, operatingExpenses: 20 });
    expect(noi).toBe(70);
    expect(noiMargin({ grossRentalIncome: 100, vacancyLoss: 10, operatingExpenses: 20 })).toBe(70);
  });

  it('computes vacancy loss pro-rated by days', () => {
    expect(vacancyLoss(365_000, 30)).toBeCloseTo(30_000, 0);
  });

  it('computes WALE weighted by annual rent', () => {
    const result = wale([
      { annualRent: 100, yearsToExpiry: 1 },
      { annualRent: 300, yearsToExpiry: 5 },
    ]);
    // (100*1 + 300*5) / 400 = 4.0
    expect(result).toBe(4);
  });

  it('ages receivables into configured buckets', () => {
    const buckets = [
      { key: 'current', label: 'Current', minDays: -99999, maxDays: 0 },
      { key: '1_30', label: '1-30', minDays: 1, maxDays: 30 },
      { key: '31_60', label: '31-60', minDays: 31, maxDays: 60 },
    ];
    const rows = [
      { balance: 1000, daysOverdue: 0 },
      { balance: 500, daysOverdue: 15 },
      { balance: 250, daysOverdue: 45 },
    ];
    const aged = ageReceivables(rows, buckets);
    expect(aged[0].amount).toBe(1000);
    expect(aged[1].amount).toBe(500);
    expect(aged[2].amount).toBe(250);
    expect(averageDaysOutstanding(rows.filter((r) => r.daysOverdue > 0))).toBe(25);
  });

  it('flags favourable vs unfavourable budget variance by direction', () => {
    // Revenue above budget is favourable.
    expect(budgetVariance(110, 100, true).favourable).toBe(true);
    // OPEX above budget is unfavourable.
    expect(budgetVariance(110, 100, false).favourable).toBe(false);
  });
});

describe('Payment schedule generation (BRD 40)', () => {
  it('generates quarterly instalments that sum to the annual rent + VAT', () => {
    const schedule = generatePaymentSchedule({
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
      annualRent: 240_000,
      serviceCharges: 24_000,
      paymentFrequency: 'quarterly',
      vatRateBps: 1500,
    });

    expect(schedule).toHaveLength(4);
    const totalRent = schedule.reduce((sum, i) => sum + i.rentAmount, 0);
    expect(totalRent).toBeCloseTo(240_000, 0);
    // Each instalment: (60000 + 6000) * 1.15 = 75900
    expect(schedule[0].totalAmount).toBeCloseTo(75_900, 0);
  });

  it('generates monthly instalments', () => {
    const schedule = generatePaymentSchedule({
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
      annualRent: 120_000,
      serviceCharges: 0,
      paymentFrequency: 'monthly',
      vatRateBps: 1500,
    });
    expect(schedule).toHaveLength(12);
    expect(schedule[0].rentAmount).toBeCloseTo(10_000, 0);
  });

  it('applies annual escalation from the anniversary', () => {
    const schedule = generatePaymentSchedule({
      startDate: new Date('2025-01-01'),
      endDate: new Date('2026-12-31'),
      annualRent: 100_000,
      serviceCharges: 0,
      paymentFrequency: 'annual',
      vatRateBps: 0,
      escalationPercent: 5,
      escalationFrequencyMonths: 12,
    });
    expect(schedule).toHaveLength(2);
    expect(schedule[0].rentAmount).toBeCloseTo(100_000, 0);
    expect(schedule[1].rentAmount).toBeCloseTo(105_000, 0);
  });
});

describe('Payment allocation (BRD 49)', () => {
  it('allocates oldest-first and reports the unallocated remainder', () => {
    const result = allocatePayment(1500, [
      { invoiceId: 'a', dueDate: new Date('2025-01-01'), balance: 1000 },
      { invoiceId: 'b', dueDate: new Date('2025-02-01'), balance: 1000 },
    ]);
    expect(result.lines).toEqual([
      { invoiceId: 'a', amount: 1000 },
      { invoiceId: 'b', amount: 500 },
    ]);
    expect(result.allocated).toBe(1500);
    expect(result.unallocated).toBe(0);
  });

  it('leaves an overpayment unallocated', () => {
    const result = allocatePayment(1500, [
      { invoiceId: 'a', dueDate: new Date('2025-01-01'), balance: 1000 },
    ]);
    expect(result.allocated).toBe(1000);
    expect(result.unallocated).toBe(500);
  });
});

describe('Invoice status derivation', () => {
  it('marks a fully paid invoice as paid', () => {
    expect(
      deriveInvoiceStatus({ totalAmount: 100, paidAmount: 100, dueDate: new Date('2025-01-01'), invoiceDate: new Date('2024-12-01') }),
    ).toBe('paid');
  });

  it('marks a past-due unpaid invoice as overdue', () => {
    expect(
      deriveInvoiceStatus({ totalAmount: 100, paidAmount: 0, dueDate: new Date('2020-01-01'), invoiceDate: new Date('2019-12-01') }),
    ).toBe('overdue');
  });

  it('marks a partial payment before due as partially_paid', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    expect(
      deriveInvoiceStatus({ totalAmount: 100, paidAmount: 40, dueDate: future, invoiceDate: new Date('2020-01-01') }),
    ).toBe('partially_paid');
  });
});

describe('Pricing approval engine (BR-004)', () => {
  const tiers = [
    { maxDiscountPercent: 5, roleKey: 'leasing_manager', label: 'Leasing Manager' },
    { maxDiscountPercent: 10, roleKey: 'asset_manager', label: 'Leasing Director' },
    { maxDiscountPercent: 100, roleKey: 'executive', label: 'Executive Approval' },
  ];

  it('requires no approval when there is no discount', () => {
    const result = evaluatePricing({ askingRent: 100_000, requestedRent: 100_000, contractTermMonths: 12 }, tiers, 80);
    expect(result.requiresApproval).toBe(false);
  });

  it('routes a 4% discount to the leasing manager', () => {
    const result = evaluatePricing({ askingRent: 100_000, requestedRent: 96_000, contractTermMonths: 12 }, tiers, 80);
    expect(result.discountPercent).toBe(4);
    expect(result.requiredRoleKey).toBe('leasing_manager');
  });

  it('routes an 8% discount to the director tier', () => {
    const result = evaluatePricing({ askingRent: 100_000, requestedRent: 92_000, contractTermMonths: 12 }, tiers, 80);
    expect(result.requiredRoleKey).toBe('asset_manager');
  });

  it('escalates a below-floor request to executive', () => {
    const result = evaluatePricing({ askingRent: 100_000, requestedRent: 75_000, contractTermMonths: 12 }, tiers, 80);
    expect(result.belowFloor).toBe(true);
    expect(result.requiredRoleKey).toBe('executive');
  });
});

describe('Availability engine (BRD 14)', () => {
  const settings = { turnaroundDays: 21, availableSoonWindowDays: 90 };
  const baseStatus = { key: 'available', availabilityClass: 'available' as const, blocksLeasing: false, publishable: true };

  it('marks an unencumbered available unit as available and publishable', () => {
    const result = resolveAvailability(
      {
        status: baseStatus,
        activeContract: null,
        activeReservation: null,
        blockingMaintenance: null,
        administrativeBlockUntil: null,
        declaredAvailabilityDate: null,
      },
      settings,
    );
    expect(result.availabilityClass).toBe('available');
    expect(result.publishable).toBe(true);
  });

  it('marks a unit with an active contract as leased and not publishable', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 2);
    const result = resolveAvailability(
      {
        status: { ...baseStatus, key: 'leased', availabilityClass: 'leased', publishable: false },
        activeContract: { endDate: future, noticeDate: null, expectedVacateDate: null, terminated: false },
        activeReservation: null,
        blockingMaintenance: null,
        administrativeBlockUntil: null,
        declaredAvailabilityDate: null,
      },
      settings,
    );
    expect(result.availabilityClass).toBe('leased');
    expect(result.publishable).toBe(false);
  });

  it('releases a unit whose reservation has expired (BR-011)', () => {
    const past = new Date();
    past.setMonth(past.getMonth() - 1);
    const result = resolveAvailability(
      {
        status: { ...baseStatus, key: 'reserved', availabilityClass: 'reserved', publishable: false },
        activeContract: null,
        activeReservation: { expiryDate: past },
        blockingMaintenance: null,
        administrativeBlockUntil: null,
        declaredAvailabilityDate: null,
      },
      settings,
    );
    expect(result.availabilityClass).toBe('available');
    expect(result.publishable).toBe(true);
  });

  it('takes a unit under blocking maintenance out of service', () => {
    const result = resolveAvailability(
      {
        status: { ...baseStatus, key: 'under_maintenance', availabilityClass: 'not_available', publishable: false, blocksLeasing: true },
        activeContract: null,
        activeReservation: null,
        blockingMaintenance: { expectedCompletionDate: null },
        administrativeBlockUntil: null,
        declaredAvailabilityDate: null,
      },
      settings,
    );
    expect(result.availabilityClass).toBe('not_available');
    expect(result.publishable).toBe(false);
  });
});

describe('Alternative unit matching (BRD 30)', () => {
  it('ranks units by requirement fit', () => {
    const matches = matchAlternativeUnits(
      { propertyId: 'p1', unitTypeId: 't1', requiredArea: 200, budgetMax: 400_000 },
      [
        { unitId: 'exact', propertyId: 'p1', districtId: 'd1', cityId: 'c1', unitTypeId: 't1', usageType: 'office', leasableArea: 200, askingRent: 380_000, availableFrom: null },
        { unitId: 'far', propertyId: 'p9', districtId: 'd9', cityId: 'c9', unitTypeId: 't9', usageType: 'retail', leasableArea: 600, askingRent: 900_000, availableFrom: null },
      ],
    );
    expect(matches[0].unitId).toBe('exact');
    expect(matches[0].score).toBeGreaterThan(matches[1].score);
  });
});
