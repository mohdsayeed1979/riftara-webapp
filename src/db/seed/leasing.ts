import { normalizeEmail, normalizeMobile } from '@/lib/utils';
import type { Database } from '../types';
import {
  collectionActions,
  contracts,
  contractVersions,
  customerIdentifiers,
  customers,
  handovers,
  invoices,
  paymentAllocations,
  payments,
  paymentSchedules,
  renewals,
  tenantLedgerEntries,
  tenants,
  units,
  vacancyPeriods,
} from '../schema';
import { COMPANY_TENANTS, FAMILY_NAMES, FIRST_NAMES_FEMALE, FIRST_NAMES_MALE } from './names';
import type { PortfolioResult, SeededUnit } from './portfolio';
import type { ReferenceData } from './reference';
import {
  addDays,
  addMonths,
  anchorMonth,
  insertInBatches,
  iso,
  round2,
  roundRent,
  sequence,
  type Rng,
} from './util';

export interface SeededCustomer {
  id: string;
  code: string;
  name: string;
  isCorporate: boolean;
  mobile: string;
  email: string;
}

export interface SeededContract {
  id: string;
  contractNumber: string;
  unitId: string;
  propertyId: string;
  tenantId: string;
  tenantName: string;
  annualRent: number;
  startDate: Date;
  endDate: Date;
  isActive: boolean;
}

export interface LeasingResult {
  customers: SeededCustomer[];
  tenantIdByCustomerId: Map<string, string>;
  contracts: SeededContract[];
}

type PaymentFrequency = 'monthly' | 'quarterly' | 'semi_annual' | 'annual';
const PAYMENT_FREQUENCIES = ['monthly', 'quarterly', 'semi_annual', 'annual'] as const satisfies readonly PaymentFrequency[];
void PAYMENT_FREQUENCIES;
const INSTALLMENTS_PER_YEAR: Record<(typeof PAYMENT_FREQUENCIES)[number], number> = {
  monthly: 12,
  quarterly: 4,
  semi_annual: 2,
  annual: 1,
};

function personName(rng: Rng): string {
  const female = rng.bool(0.4);
  const first = female ? rng.pick(FIRST_NAMES_FEMALE) : rng.pick(FIRST_NAMES_MALE);
  return `${first} ${rng.pick(FAMILY_NAMES)}`;
}

function mobileNumber(rng: Rng): string {
  return `+9665${rng.int(0, 9)}${String(rng.int(1000000, 9999999))}`;
}

function emailFor(name: string, index: number): string {
  const slug = name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '');
  return `${slug}.${index}@example.sa`;
}

/**
 * Creates the customer master, converts leased units into tenants and
 * contracts, then generates the full financial trail: payment schedules,
 * invoices, payments, allocations and the tenant ledger.
 *
 * Every number reconciles — invoice totals equal schedule totals, payment
 * allocations equal invoice paid amounts, and ledger balances equal the
 * running difference between debits and credits.
 */
export async function seedLeasing(
  db: Database,
  reference: ReferenceData,
  portfolio: PortfolioResult,
  rng: Rng,
): Promise<LeasingResult> {
  const today = new Date();
  const currentMonth = anchorMonth(today);
  const orgId = reference.organizationId;

  const leasedUnits = portfolio.units.filter((u) => u.occupancyPlan === 'leased');
  const nonLeasedUnits = portfolio.units.filter((u) => u.occupancyPlan !== 'leased');

  // --- Customers -----------------------------------------------------------
  // One corporate customer per leased commercial unit group, plus individuals
  // for residential units and a pool of prospects for the CRM pipeline.
  const customerRows: Array<typeof customers.$inferInsert> = [];
  const identifierRows: Array<Omit<typeof customerIdentifiers.$inferInsert, 'customerId'> & { code: string }> = [];

  const corporateCount = Math.min(COMPANY_TENANTS.length, 50);
  for (let i = 0; i < corporateCount; i += 1) {
    const company = COMPANY_TENANTS[i];
    const code = sequence('CUS', i + 1);
    const mobile = mobileNumber(rng);
    const email = `contact@${company.name.toLowerCase().replace(/[^a-z]+/g, '')}.sa`;
    const cr = `10${rng.int(10000000, 99999999)}`;
    customerRows.push({
      organizationId: orgId,
      code,
      customerType: 'corporate',
      fullNameEn: company.name,
      companyName: company.name,
      mobile,
      email,
      businessActivity: company.industry,
      unifiedNumber: `7${rng.int(100000000, 999999999)}`,
      vatNumber: `3${rng.int(10000000000000, 99999999999999)}`,
      authorizedRepresentative: personName(rng),
      priority: rng.weighted([
        ['high', 3],
        ['medium', 5],
        ['low', 2],
      ]),
      ownerUserId: rng.pick([reference.userIds.ahmed_khalid, reference.userIds.maha_alzahrani]),
      marketingConsent: rng.bool(0.7),
      communicationConsent: true,
      isDemo: true,
    });
    identifierRows.push(
      { code, organizationId: orgId, identifierType: 'commercial_registration', identifierValue: cr, isPrimary: true, isDemo: true },
      { code, organizationId: orgId, identifierType: 'mobile', identifierValue: normalizeMobile(mobile), isPrimary: false, isDemo: true },
      { code, organizationId: orgId, identifierType: 'email', identifierValue: normalizeEmail(email), isPrimary: false, isDemo: true },
    );
  }

  const individualCount = 130;
  for (let i = 0; i < individualCount; i += 1) {
    const name = personName(rng);
    const code = sequence('CUS', corporateCount + i + 1);
    const mobile = mobileNumber(rng);
    const email = emailFor(name, i + 1);
    const nationalId = `1${rng.int(100000000, 999999999)}`;
    customerRows.push({
      organizationId: orgId,
      code,
      customerType: 'individual',
      fullNameEn: name,
      mobile,
      email,
      nationality: rng.weighted([
        ['Saudi', 7],
        ['Egyptian', 1],
        ['Indian', 1],
        ['Jordanian', 1],
      ]),
      employer: rng.pick(COMPANY_TENANTS).name,
      monthlyIncome: roundRent(rng.int(12000, 65000)),
      priority: rng.weighted([
        ['high', 2],
        ['medium', 6],
        ['low', 2],
      ]),
      ownerUserId: rng.pick([reference.userIds.ahmed_khalid, reference.userIds.maha_alzahrani]),
      marketingConsent: rng.bool(0.6),
      communicationConsent: true,
      isDemo: true,
    });
    identifierRows.push(
      { code, organizationId: orgId, identifierType: 'national_id', identifierValue: nationalId, isPrimary: true, isDemo: true },
      { code, organizationId: orgId, identifierType: 'mobile', identifierValue: normalizeMobile(mobile), isPrimary: false, isDemo: true },
      { code, organizationId: orgId, identifierType: 'email', identifierValue: normalizeEmail(email), isPrimary: false, isDemo: true },
    );
  }

  const insertedCustomers: Array<{ id: string; code: string; fullNameEn: string; customerType: string; mobile: string | null; email: string | null }> = [];
  await insertInBatches(customerRows, 150, async (batch) => {
    const rows = await db.insert(customers).values(batch).returning({
      id: customers.id,
      code: customers.code,
      fullNameEn: customers.fullNameEn,
      customerType: customers.customerType,
      mobile: customers.mobile,
      email: customers.email,
    });
    insertedCustomers.push(...rows);
  });

  const customerIdByCode = new Map(insertedCustomers.map((c) => [c.code, c.id]));
  await insertInBatches(identifierRows, 200, async (batch) =>
    db.insert(customerIdentifiers).values(
      batch.map(({ code, ...row }) => ({ ...row, customerId: customerIdByCode.get(code) as string })),
    ),
  );

  const seededCustomers: SeededCustomer[] = insertedCustomers.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.fullNameEn,
    isCorporate: c.customerType === 'corporate',
    mobile: c.mobile ?? '',
    email: c.email ?? '',
  }));

  // --- Tenants -------------------------------------------------------------
  // A tenant is a customer with at least one lease. Corporate customers take
  // the commercial units; individuals take the residential building.
  const commercialLeased = leasedUnits.filter((u) => u.usageType !== 'residential');
  const residentialLeased = leasedUnits.filter((u) => u.usageType === 'residential');

  const corporateCustomers = seededCustomers.filter((c) => c.isCorporate);
  const individualCustomers = seededCustomers.filter((c) => !c.isCorporate);

  /** Corporate tenants often occupy several units — that drives concentration KPIs. */
  const unitToCustomer = new Map<string, SeededCustomer>();
  commercialLeased.forEach((unit, index) => {
    const customer = corporateCustomers[index % corporateCustomers.length];
    unitToCustomer.set(unit.id, customer);
  });
  residentialLeased.forEach((unit, index) => {
    unitToCustomer.set(unit.id, individualCustomers[index % individualCustomers.length]);
  });

  const tenantCustomerIds = Array.from(new Set(Array.from(unitToCustomer.values()).map((c) => c.id)));
  const tenantRows = tenantCustomerIds.map((customerId, index) => {
    const customer = seededCustomers.find((c) => c.id === customerId) as SeededCustomer;
    const company = COMPANY_TENANTS.find((c) => c.name === customer.name);
    return {
      organizationId: orgId,
      code: sequence('TEN', index + 1),
      customerId,
      displayName: customer.name,
      industry: company?.industry ?? 'Individual',
      status: 'active',
      onboardedAt: iso(addMonths(currentMonth, -rng.int(3, 30))),
      accountManagerId: rng.pick([reference.userIds.sarah_mohammed, reference.userIds.faisal_alotaibi]),
      creditRating: rng.weighted([
        ['A', 5],
        ['B', 3],
        ['C', 2],
      ]),
      isDemo: true,
    };
  });

  const insertedTenants: Array<{ id: string; customerId: string }> = [];
  await insertInBatches(tenantRows, 150, async (batch) => {
    const rows = await db
      .insert(tenants)
      .values(batch)
      .returning({ id: tenants.id, customerId: tenants.customerId });
    insertedTenants.push(...rows);
  });
  const tenantIdByCustomerId = new Map(insertedTenants.map((t) => [t.customerId, t.id]));

  // --- Contracts -----------------------------------------------------------
  const contractRows: Array<typeof contracts.$inferInsert> = [];
  const contractPlans: Array<{
    contractNumber: string;
    unit: SeededUnit;
    tenantId: string;
    tenantName: string;
    annualRent: number;
    startDate: Date;
    endDate: Date;
    frequency: (typeof PAYMENT_FREQUENCIES)[number];
    deposit: number;
    serviceCharges: number;
    isExpiring: boolean;
  }> = [];

  leasedUnits.forEach((unit, index) => {
    const customer = unitToCustomer.get(unit.id) as SeededCustomer;
    const tenantId = tenantIdByCustomerId.get(customer.id) as string;

    const termYears = rng.weighted([
      [1, 2],
      [2, 3],
      [3, 4],
      [5, 3],
    ]);
    // Stagger start dates so the expiry profile and renewal pipeline look real.
    const monthsElapsed = rng.int(1, Math.min(termYears * 12 - 1, 30));
    const startDate = addMonths(currentMonth, -monthsElapsed);
    const endDate = addDays(addMonths(startDate, termYears * 12), -1);
    const discount = rng.weighted([
      [0, 6],
      [0.03, 2],
      [0.06, 1],
      [0.09, 1],
    ]);
    const annualRent = roundRent(unit.askingRent * (1 - discount));
    const frequency = rng.weighted<(typeof PAYMENT_FREQUENCIES)[number]>([
      ['quarterly', 5],
      ['annual', 2],
      ['semi_annual', 2],
      ['monthly', 1],
    ]);
    const monthsToExpiry =
      (endDate.getUTCFullYear() - today.getUTCFullYear()) * 12 + (endDate.getUTCMonth() - today.getUTCMonth());

    const contractNumber = sequence('LC-2025', index + 1);
    contractPlans.push({
      contractNumber,
      unit,
      tenantId,
      tenantName: customer.name,
      annualRent,
      startDate,
      endDate,
      frequency,
      deposit: roundRent(annualRent * 0.25),
      serviceCharges: unit.serviceCharges,
      isExpiring: monthsToExpiry <= 6,
    });

    contractRows.push({
      organizationId: orgId,
      contractNumber,
      version: 1,
      ejarReference: rng.bool(0.55) ? `EJ${rng.int(100000000, 999999999)}` : null,
      ejarStatus: rng.bool(0.55) ? 'registered' : 'not_submitted',
      ejarLastSyncAt: rng.bool(0.55) ? addDays(today, -rng.int(1, 60)) : null,
      tenantId,
      lessorName: 'RIFTARA Real Estate Company LLC',
      propertyId: unit.propertyId,
      buildingId: unit.buildingId,
      unitId: unit.id,
      startDate: iso(startDate),
      endDate: iso(endDate),
      durationMonths: termYears * 12,
      leasableArea: unit.leasableArea,
      annualRent,
      rentPerSqm: round2(annualRent / unit.leasableArea),
      paymentFrequency: frequency,
      depositAmount: roundRent(annualRent * 0.25),
      vatRateBps: 1500,
      serviceCharges: unit.serviceCharges,
      escalationPercent: rng.weighted([
        [0, 3],
        [3, 3],
        [5, 4],
      ]),
      escalationFrequencyMonths: 12,
      gracePeriodDays: rng.weighted([
        [0, 6],
        [30, 3],
        [60, 1],
      ]),
      fitOutPeriodDays: unit.usageType === 'residential' ? 0 : rng.weighted([[0, 5], [30, 3], [60, 2]]),
      status: 'active',
      isActive: true,
      signedAt: addDays(startDate, -rng.int(3, 20)),
      activatedAt: startDate,
      renewalStatus: monthsToExpiry <= 6 ? 'pending' : 'not_started',
      renewalProbability: rng.int(45, 95),
      createdByUserId: reference.userIds.sarah_mohammed,
      isDemo: true,
    });
  });

  const insertedContracts: Array<{ id: string; contractNumber: string }> = [];
  await insertInBatches(contractRows, 100, async (batch) => {
    const rows = await db
      .insert(contracts)
      .values(batch)
      .returning({ id: contracts.id, contractNumber: contracts.contractNumber });
    insertedContracts.push(...rows);
  });
  const contractIdByNumber = new Map(insertedContracts.map((c) => [c.contractNumber, c.id]));

  await insertInBatches(contractPlans, 100, async (batch) =>
    db.insert(contractVersions).values(
      batch.map((plan) => ({
        contractId: contractIdByNumber.get(plan.contractNumber) as string,
        version: 1,
        snapshot: {
          contractNumber: plan.contractNumber,
          annualRent: plan.annualRent,
          startDate: iso(plan.startDate),
          endDate: iso(plan.endDate),
          paymentFrequency: plan.frequency,
          depositAmount: plan.deposit,
        },
        changeReason: 'Initial contract issue.',
        createdByUserId: reference.userIds.sarah_mohammed,
      })),
    ),
  );

  // --- Unit status alignment ----------------------------------------------
  await Promise.all([
    updateUnitStatuses(db, leasedUnits, reference.unitStatusIds.leased, 'leased', currentMonth),
    updateUnitStatuses(
      db,
      nonLeasedUnits.filter((u) => u.occupancyPlan === 'available'),
      reference.unitStatusIds.available,
      'available',
      currentMonth,
    ),
    updateUnitStatuses(
      db,
      nonLeasedUnits.filter((u) => u.occupancyPlan === 'reserved'),
      reference.unitStatusIds.reserved,
      'reserved',
      currentMonth,
    ),
    updateUnitStatuses(
      db,
      nonLeasedUnits.filter((u) => u.occupancyPlan === 'maintenance'),
      reference.unitStatusIds.under_maintenance,
      'not_available',
      currentMonth,
    ),
  ]);

  // --- Payment schedules, invoices, payments, ledger -----------------------
  const scheduleRows: Array<typeof paymentSchedules.$inferInsert> = [];
  const invoicePlans: Array<{
    invoiceNumber: string;
    contractNumber: string;
    plan: (typeof contractPlans)[number];
    installmentNumber: number;
    periodStart: Date;
    periodEnd: Date;
    invoiceDate: Date;
    dueDate: Date;
    rentAmount: number;
    serviceChargeAmount: number;
    vatAmount: number;
    totalAmount: number;
  }> = [];

  let invoiceCounter = 0;
  for (const plan of contractPlans) {
    const perYear = INSTALLMENTS_PER_YEAR[plan.frequency];
    const monthsPerInstallment = 12 / perYear;
    const rentPerInstallment = round2(plan.annualRent / perYear);
    const servicePerInstallment = round2(plan.serviceCharges / perYear);

    let installmentNumber = 0;
    let periodStart = new Date(plan.startDate);

    while (periodStart <= plan.endDate) {
      installmentNumber += 1;
      const periodEnd = addDays(addMonths(periodStart, monthsPerInstallment), -1);
      const dueDate = new Date(periodStart);
      const invoiceDate = addDays(dueDate, -30);

      const vatAmount = round2((rentPerInstallment + servicePerInstallment) * 0.15);
      const totalAmount = round2(rentPerInstallment + servicePerInstallment + vatAmount);

      scheduleRows.push({
        organizationId: orgId,
        contractId: contractIdByNumber.get(plan.contractNumber) as string,
        installmentNumber,
        periodStart: iso(periodStart),
        periodEnd: iso(periodEnd > plan.endDate ? plan.endDate : periodEnd),
        invoiceDate: iso(invoiceDate),
        dueDate: iso(dueDate),
        rentAmount: rentPerInstallment,
        serviceChargeAmount: servicePerInstallment,
        vatAmount,
        totalAmount,
        isDemo: true,
      });

      // Only instalments whose invoice date has arrived become invoices.
      if (invoiceDate <= today) {
        invoiceCounter += 1;
        invoicePlans.push({
          invoiceNumber: sequence('INV', invoiceCounter, 6),
          contractNumber: plan.contractNumber,
          plan,
          installmentNumber,
          periodStart: new Date(periodStart),
          periodEnd: periodEnd > plan.endDate ? new Date(plan.endDate) : periodEnd,
          invoiceDate,
          dueDate,
          rentAmount: rentPerInstallment,
          serviceChargeAmount: servicePerInstallment,
          vatAmount,
          totalAmount,
        });
      }

      periodStart = addMonths(periodStart, monthsPerInstallment);
    }
  }

  await insertInBatches(scheduleRows, 300, async (batch) => db.insert(paymentSchedules).values(batch));

  // Decide the settlement of each invoice so the collection rate lands ~95%.
  const invoiceRows: Array<typeof invoices.$inferInsert> = [];
  const settlementByInvoice = new Map<string, { paid: number; status: string; paymentDate: Date | null }>();

  for (const invoice of invoicePlans) {
    const daysPastDue = Math.floor((today.getTime() - invoice.dueDate.getTime()) / 86_400_000);
    let paid = 0;
    let status: string;
    let paymentDate: Date | null = null;

    if (daysPastDue < 0) {
      status = 'upcoming';
    } else {
      // Older invoices are almost always settled; recent ones carry the arrears.
      const settlementRoll = rng.next();
      const fullyPaidProbability = daysPastDue > 120 ? 0.985 : daysPastDue > 45 ? 0.93 : 0.82;

      if (settlementRoll < fullyPaidProbability) {
        paid = invoice.totalAmount;
        status = 'paid';
        paymentDate = addDays(invoice.dueDate, rng.int(-5, 12));
        if (paymentDate > today) paymentDate = addDays(today, -1);
      } else if (settlementRoll < fullyPaidProbability + 0.07) {
        paid = round2(invoice.totalAmount * rng.float(0.3, 0.75));
        status = daysPastDue > 0 ? 'overdue' : 'partially_paid';
        paymentDate = addDays(invoice.dueDate, rng.int(-2, 20));
        if (paymentDate > today) paymentDate = addDays(today, -1);
      } else {
        paid = 0;
        status = daysPastDue > 0 ? 'overdue' : 'due';
      }
    }

    settlementByInvoice.set(invoice.invoiceNumber, { paid, status, paymentDate });

    invoiceRows.push({
      organizationId: orgId,
      invoiceNumber: invoice.invoiceNumber,
      contractId: contractIdByNumber.get(invoice.contractNumber) as string,
      tenantId: invoice.plan.tenantId,
      propertyId: invoice.plan.unit.propertyId,
      unitId: invoice.plan.unit.id,
      invoiceDate: iso(invoice.invoiceDate),
      dueDate: iso(invoice.dueDate),
      periodStart: iso(invoice.periodStart),
      periodEnd: iso(invoice.periodEnd),
      rentAmount: invoice.rentAmount,
      serviceChargeAmount: invoice.serviceChargeAmount,
      vatAmount: invoice.vatAmount,
      totalAmount: invoice.totalAmount,
      paidAmount: paid,
      balanceAmount: round2(invoice.totalAmount - paid),
      status: status as typeof invoices.$inferInsert.status,
      isDemo: true,
    });
  }

  const insertedInvoices: Array<{ id: string; invoiceNumber: string }> = [];
  await insertInBatches(invoiceRows, 300, async (batch) => {
    const rows = await db
      .insert(invoices)
      .values(batch)
      .returning({ id: invoices.id, invoiceNumber: invoices.invoiceNumber });
    insertedInvoices.push(...rows);
  });
  const invoiceIdByNumber = new Map(insertedInvoices.map((i) => [i.invoiceNumber, i.id]));

  // --- Payments and allocations -------------------------------------------
  const paymentRows: Array<typeof payments.$inferInsert> = [];
  const allocationPlans: Array<{ paymentNumber: string; invoiceNumber: string; amount: number }> = [];
  let paymentCounter = 0;

  for (const invoice of invoicePlans) {
    const settlement = settlementByInvoice.get(invoice.invoiceNumber);
    if (!settlement || settlement.paid <= 0 || !settlement.paymentDate) continue;

    paymentCounter += 1;
    const paymentNumber = sequence('PMT', paymentCounter, 6);
    paymentRows.push({
      organizationId: orgId,
      paymentNumber,
      tenantId: invoice.plan.tenantId,
      contractId: contractIdByNumber.get(invoice.contractNumber) as string,
      propertyId: invoice.plan.unit.propertyId,
      unitId: invoice.plan.unit.id,
      paymentDate: iso(settlement.paymentDate),
      amount: settlement.paid,
      unallocatedAmount: 0,
      method: rng.weighted([
        ['bank_transfer', 6],
        ['cheque', 2],
        ['sadad', 2],
        ['card', 1],
      ]),
      referenceNumber: `TRF${rng.int(100000000, 999999999)}`,
      bankName: rng.pick(['Al Rajhi Bank', 'Saudi National Bank', 'Riyad Bank', 'Banque Saudi Fransi']),
      status: 'reconciled',
      paymentType: 'rent',
      recordedByUserId: reference.userIds.omar_alqahtani,
      isDemo: true,
    });
    allocationPlans.push({
      paymentNumber,
      invoiceNumber: invoice.invoiceNumber,
      amount: settlement.paid,
    });
  }

  const insertedPayments: Array<{ id: string; paymentNumber: string }> = [];
  await insertInBatches(paymentRows, 300, async (batch) => {
    const rows = await db
      .insert(payments)
      .values(batch)
      .returning({ id: payments.id, paymentNumber: payments.paymentNumber });
    insertedPayments.push(...rows);
  });
  const paymentIdByNumber = new Map(insertedPayments.map((p) => [p.paymentNumber, p.id]));

  await insertInBatches(allocationPlans, 300, async (batch) =>
    db.insert(paymentAllocations).values(
      batch.map((entry) => ({
        paymentId: paymentIdByNumber.get(entry.paymentNumber) as string,
        invoiceId: invoiceIdByNumber.get(entry.invoiceNumber) as string,
        amount: entry.amount,
        allocationMethod: 'automatic' as const,
        allocatedByUserId: reference.userIds.omar_alqahtani,
        isDemo: true,
      })),
    ),
  );

  // --- Tenant ledger (running balance per tenant) --------------------------
  interface LedgerEvent {
    tenantId: string;
    contractId: string;
    date: Date;
    entryType: string;
    description: string;
    debit: number;
    credit: number;
    invoiceNumber?: string;
    paymentNumber?: string;
  }

  const ledgerEvents: LedgerEvent[] = [];
  for (const invoice of invoicePlans) {
    ledgerEvents.push({
      tenantId: invoice.plan.tenantId,
      contractId: contractIdByNumber.get(invoice.contractNumber) as string,
      date: invoice.invoiceDate,
      entryType: 'invoice',
      description: `Invoice ${invoice.invoiceNumber} — ${iso(invoice.periodStart)} to ${iso(invoice.periodEnd)}`,
      debit: invoice.totalAmount,
      credit: 0,
      invoiceNumber: invoice.invoiceNumber,
    });
    const settlement = settlementByInvoice.get(invoice.invoiceNumber);
    if (settlement && settlement.paid > 0 && settlement.paymentDate) {
      const allocation = allocationPlans.find((a) => a.invoiceNumber === invoice.invoiceNumber);
      ledgerEvents.push({
        tenantId: invoice.plan.tenantId,
        contractId: contractIdByNumber.get(invoice.contractNumber) as string,
        date: settlement.paymentDate,
        entryType: 'payment',
        description: `Payment received against invoice ${invoice.invoiceNumber}`,
        debit: 0,
        credit: settlement.paid,
        paymentNumber: allocation?.paymentNumber,
      });
    }
  }

  const ledgerByTenant = new Map<string, LedgerEvent[]>();
  for (const event of ledgerEvents) {
    const bucket = ledgerByTenant.get(event.tenantId);
    if (bucket) bucket.push(event);
    else ledgerByTenant.set(event.tenantId, [event]);
  }

  const ledgerRows: Array<typeof tenantLedgerEntries.$inferInsert> = [];
  for (const [tenantId, events] of ledgerByTenant) {
    const sorted = events.sort((a, b) => a.date.getTime() - b.date.getTime());
    let balance = 0;
    for (const event of sorted) {
      balance = round2(balance + event.debit - event.credit);
      ledgerRows.push({
        organizationId: orgId,
        tenantId,
        contractId: event.contractId,
        entryDate: iso(event.date),
        entryType: event.entryType,
        description: event.description,
        debitAmount: event.debit,
        creditAmount: event.credit,
        runningBalance: balance,
        invoiceId: event.invoiceNumber ? invoiceIdByNumber.get(event.invoiceNumber) : null,
        paymentId: event.paymentNumber ? paymentIdByNumber.get(event.paymentNumber) : null,
        createdByUserId: reference.userIds.omar_alqahtani,
        isDemo: true,
      });
    }
  }
  await insertInBatches(ledgerRows, 400, async (batch) => db.insert(tenantLedgerEntries).values(batch));

  // --- Collection actions on the worst arrears ----------------------------
  const overdueInvoices = invoicePlans
    .filter((invoice) => {
      const settlement = settlementByInvoice.get(invoice.invoiceNumber);
      return settlement?.status === 'overdue';
    })
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

  const actionRows: Array<typeof collectionActions.$inferInsert> = [];
  for (const invoice of overdueInvoices.slice(0, 90)) {
    const settlement = settlementByInvoice.get(invoice.invoiceNumber);
    const outstanding = round2(invoice.totalAmount - (settlement?.paid ?? 0));
    const daysOverdue = Math.max(1, Math.floor((today.getTime() - invoice.dueDate.getTime()) / 86_400_000));

    const ladder: Array<{ threshold: number; action: (typeof collectionActions.$inferInsert)['actionType'] }> = [
      { threshold: 1, action: 'reminder' },
      { threshold: 15, action: 'follow_up' },
      { threshold: 45, action: 'escalation' },
      { threshold: 75, action: 'formal_notice' },
      { threshold: 120, action: 'legal_review' },
    ];

    for (const step of ladder) {
      if (daysOverdue < step.threshold) break;
      actionRows.push({
        organizationId: orgId,
        tenantId: invoice.plan.tenantId,
        contractId: contractIdByNumber.get(invoice.contractNumber) as string,
        invoiceId: invoiceIdByNumber.get(invoice.invoiceNumber) as string,
        actionType: step.action,
        outstandingAmount: outstanding,
        daysOverdue: step.threshold,
        notes:
          step.action === 'reminder'
            ? 'Automated payment reminder sent by email and SMS.'
            : step.action === 'follow_up'
              ? 'Collections officer called the tenant finance contact.'
              : step.action === 'escalation'
                ? 'Escalated to the account manager and property manager.'
                : step.action === 'formal_notice'
                  ? 'Formal notice of arrears issued under the lease terms.'
                  : 'Referred to legal for review of enforcement options.',
        outcome: rng.pick(['Promise to pay', 'No response', 'Payment plan discussed', 'Awaiting approval']),
        nextActionDate: iso(addDays(today, rng.int(3, 21))),
        performedByUserId: reference.userIds.reem_alsubaie,
        isDemo: true,
      });
    }
  }
  await insertInBatches(actionRows, 300, async (batch) => db.insert(collectionActions).values(batch));

  // --- Renewals for contracts inside the notice window --------------------
  const renewalRows = contractPlans
    .filter((plan) => plan.isExpiring)
    .map((plan) => {
      const status = rng.weighted([
        ['pending', 4],
        ['in_discussion', 3],
        ['offer_sent', 2],
        ['renewed', 2],
        ['not_renewed', 1],
      ]);
      const proposed = roundRent(plan.annualRent * 1.05);
      return {
        organizationId: orgId,
        contractId: contractIdByNumber.get(plan.contractNumber) as string,
        noticeDueDate: iso(addDays(plan.endDate, -90)),
        status,
        currentRent: plan.annualRent,
        proposedRent: proposed,
        marketRent: roundRent(plan.unit.askingRent),
        agreedRent: status === 'renewed' ? proposed : null,
        probability: rng.int(40, 95),
        ownerUserId: reference.userIds.sarah_mohammed,
        notes:
          status === 'not_renewed'
            ? 'Tenant is consolidating into a single regional office.'
            : 'Renewal discussion in progress with the tenant.',
        decidedAt: status === 'renewed' || status === 'not_renewed' ? addDays(today, -rng.int(1, 30)) : null,
        isDemo: true,
      };
    });
  if (renewalRows.length > 0) {
    await insertInBatches(renewalRows, 200, async (batch) => db.insert(renewals).values(batch));
  }

  // --- Handovers for recently commenced contracts -------------------------
  const recentContracts = contractPlans.filter(
    (plan) => plan.startDate >= addMonths(currentMonth, -9),
  );
  const handoverRows = recentContracts.map((plan) => ({
    organizationId: orgId,
    contractId: contractIdByNumber.get(plan.contractNumber) as string,
    unitId: plan.unit.id,
    handoverType: 'handover',
    status: 'completed',
    contractSigned: true,
    paymentReceived: true,
    depositReceived: true,
    unitReady: true,
    keysHandedOver: rng.int(2, 4),
    accessCards: rng.int(2, 8),
    parkingCards: Math.max(1, Math.round(plan.unit.leasableArea / 120)),
    electricityMeterReading: String(rng.int(10000, 99999)),
    waterMeterReading: String(rng.int(1000, 9999)),
    unitCondition: 'Handed over in excellent condition',
    notes: 'Joint inspection completed; no snags recorded.',
    completedAt: addDays(plan.startDate, rng.int(0, 3)),
    completedByUserId: reference.userIds.faisal_alotaibi,
    isDemo: true,
  }));
  if (handoverRows.length > 0) {
    await insertInBatches(handoverRows, 200, async (batch) => db.insert(handovers).values(batch));
  }

  // --- Vacancy periods for units currently available ----------------------
  const vacancyRows = portfolio.units
    .filter((u) => u.occupancyPlan === 'available')
    .map((unit) => {
      const daysVacant = rng.weighted([
        [rng.int(10, 45), 5],
        [rng.int(46, 110), 3],
        [rng.int(111, 260), 2],
      ]);
      const start = addDays(today, -daysVacant);
      const monthlyLoss = round2(unit.askingRent / 12);
      return {
        organizationId: orgId,
        unitId: unit.id,
        propertyId: unit.propertyId,
        vacancyStartDate: iso(start),
        firstPublishDate: iso(addDays(start, rng.int(1, 10))),
        listingDate: iso(addDays(start, rng.int(1, 10))),
        daysVacant,
        estimatedMonthlyLoss: monthlyLoss,
        estimatedTotalLoss: round2((unit.askingRent / 365) * daysVacant),
        leasableArea: unit.leasableArea,
        isDemo: true,
      };
    });
  if (vacancyRows.length > 0) {
    await insertInBatches(vacancyRows, 300, async (batch) => db.insert(vacancyPeriods).values(batch));
  }

  const seededContracts: SeededContract[] = contractPlans.map((plan) => ({
    id: contractIdByNumber.get(plan.contractNumber) as string,
    contractNumber: plan.contractNumber,
    unitId: plan.unit.id,
    propertyId: plan.unit.propertyId,
    tenantId: plan.tenantId,
    tenantName: plan.tenantName,
    annualRent: plan.annualRent,
    startDate: plan.startDate,
    endDate: plan.endDate,
    isActive: true,
  }));

  return { customers: seededCustomers, tenantIdByCustomerId, contracts: seededContracts };
}

async function updateUnitStatuses(
  db: Database,
  targetUnits: SeededUnit[],
  statusId: string,
  availabilityClass: string,
  currentMonth: Date,
): Promise<void> {
  if (targetUnits.length === 0) return;
  const { inArray } = await import('drizzle-orm');
  const ids = targetUnits.map((u) => u.id);
  for (let i = 0; i < ids.length; i += 200) {
    await db
      .update(units)
      .set({
        statusId,
        computedAvailabilityClass: availabilityClass,
        computedAvailableFrom: availabilityClass === 'available' ? iso(currentMonth) : null,
        availabilityComputedAt: new Date(),
        publicationState: availabilityClass === 'available' ? 'published' : 'unpublished',
        firstPublishedAt: availabilityClass === 'available' ? addMonths(currentMonth, -2) : null,
        listedAt: availabilityClass === 'available' ? addMonths(currentMonth, -2) : null,
        vacancyStartDate: availabilityClass === 'available' ? iso(addMonths(currentMonth, -2)) : null,
      })
      .where(inArray(units.id, ids.slice(i, i + 200)));
  }
}
