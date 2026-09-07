import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { Database } from '../types';
import {
  contracts,
  invoices,
  maintenanceCosts,
  notifications,
  operatingExpenses,
  performanceSnapshots,
  units,
  valuations,
  workOrders,
} from '../schema';
import type { PortfolioResult } from './portfolio';
import type { ReferenceData } from './reference';
import { addDays, addMonths, anchorMonth, endOfMonth, insertInBatches, iso, round2 } from './util';

interface MonthlyMetrics {
  occupancyRate: number;
  vacancyRate: number;
  occupiedUnits: number;
  totalUnits: number;
  billed: number;
  collected: number;
  outstanding: number;
  collectionRate: number;
  opex: number;
  maintenanceCost: number;
  noi: number;
  noiMargin: number;
  marketValue: number;
  annualRentalValue: number;
  workOrdersCreated: number;
  workOrdersCompleted: number;
}

/**
 * Historical KPI snapshots (BRD 141). Every value is COMPUTED from the seeded
 * transactional data rather than invented, so the trend charts reconcile with
 * the live figures on the same dashboards.
 */
export async function seedSnapshots(
  db: Database,
  reference: ReferenceData,
  portfolio: PortfolioResult,
): Promise<void> {
  const orgId = reference.organizationId;
  const currentMonth = anchorMonth(new Date());
  const MONTHS = 24;

  const scopes: Array<{ scopeType: 'portfolio' | 'property'; scopeId: string | null; propertyId: string | null }> = [
    { scopeType: 'portfolio', scopeId: null, propertyId: null },
    ...portfolio.properties.map((p) => ({
      scopeType: 'property' as const,
      scopeId: p.id,
      propertyId: p.id,
    })),
  ];

  const snapshotRows: Array<typeof performanceSnapshots.$inferInsert> = [];

  for (const scope of scopes) {
    const scopeUnits = scope.propertyId
      ? portfolio.units.filter((u) => u.propertyId === scope.propertyId)
      : portfolio.units;
    const totalUnits = scopeUnits.length;
    const annualRentalValue = round2(scopeUnits.reduce((sum, u) => sum + u.askingRent, 0));

    // Current and prior market value bound the interpolated value trend.
    const valuationFilter = scope.propertyId
      ? and(eq(valuations.organizationId, orgId), eq(valuations.propertyId, scope.propertyId))
      : eq(valuations.organizationId, orgId);

    const [currentValuation] = await db
      .select({ total: sql<number>`coalesce(sum(${valuations.marketValue}), 0)::float8` })
      .from(valuations)
      .where(and(valuationFilter, eq(valuations.isCurrent, true)));

    const [priorValuation] = await db
      .select({ total: sql<number>`coalesce(sum(${valuations.marketValue}), 0)::float8` })
      .from(valuations)
      .where(and(valuationFilter, eq(valuations.isCurrent, false)));

    const currentValue = Number(currentValuation?.total ?? 0);
    const priorValue = Number(priorValuation?.total ?? currentValue);

    for (let offset = MONTHS - 1; offset >= 0; offset -= 1) {
      const monthStart = addMonths(currentMonth, -offset);
      const monthEnd = endOfMonth(monthStart);
      const metrics = await computeMonth({
        db,
        orgId,
        propertyId: scope.propertyId,
        monthStart,
        monthEnd,
        totalUnits,
        annualRentalValue,
        currentValue,
        priorValue,
        monthsFromNow: offset,
        totalMonths: MONTHS,
      });

      snapshotRows.push({
        organizationId: orgId,
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        snapshotDate: iso(monthEnd),
        periodYear: monthStart.getUTCFullYear(),
        periodMonth: monthStart.getUTCMonth() + 1,
        metrics: metrics as unknown as Record<string, number>,
        isDemo: true,
      });
    }
  }

  await insertInBatches(snapshotRows, 200, async (batch) =>
    db.insert(performanceSnapshots).values(batch),
  );

  await seedNotifications(db, reference, portfolio);
}

async function computeMonth(input: {
  db: Database;
  orgId: string;
  propertyId: string | null;
  monthStart: Date;
  monthEnd: Date;
  totalUnits: number;
  annualRentalValue: number;
  currentValue: number;
  priorValue: number;
  monthsFromNow: number;
  totalMonths: number;
}): Promise<MonthlyMetrics> {
  const {
    db,
    orgId,
    propertyId,
    monthStart,
    monthEnd,
    totalUnits,
    annualRentalValue,
    currentValue,
    priorValue,
    monthsFromNow,
    totalMonths,
  } = input;

  const monthStartIso = iso(monthStart);
  const monthEndIso = iso(monthEnd);

  // Occupancy: contracts that were live at any point during the month.
  const contractWhere = propertyId
    ? and(
        eq(contracts.organizationId, orgId),
        eq(contracts.propertyId, propertyId),
        lte(contracts.startDate, monthEndIso),
        gte(contracts.endDate, monthStartIso),
      )
    : and(
        eq(contracts.organizationId, orgId),
        lte(contracts.startDate, monthEndIso),
        gte(contracts.endDate, monthStartIso),
      );

  const [occupancyRow] = await db
    .select({
      occupied: sql<number>`count(distinct ${contracts.unitId})::int`,
      contractedRent: sql<number>`coalesce(sum(${contracts.annualRent}), 0)::float8`,
    })
    .from(contracts)
    .where(contractWhere);

  const occupiedUnits = Number(occupancyRow?.occupied ?? 0);
  const occupancyRate = totalUnits > 0 ? round2((occupiedUnits / totalUnits) * 100) : 0;

  // Collections: invoices dated within the month.
  const invoiceWhere = propertyId
    ? and(
        eq(invoices.organizationId, orgId),
        eq(invoices.propertyId, propertyId),
        gte(invoices.invoiceDate, monthStartIso),
        lte(invoices.invoiceDate, monthEndIso),
      )
    : and(
        eq(invoices.organizationId, orgId),
        gte(invoices.invoiceDate, monthStartIso),
        lte(invoices.invoiceDate, monthEndIso),
      );

  const [collectionRow] = await db
    .select({
      billed: sql<number>`coalesce(sum(${invoices.totalAmount}), 0)::float8`,
      collected: sql<number>`coalesce(sum(${invoices.paidAmount}), 0)::float8`,
      outstanding: sql<number>`coalesce(sum(${invoices.balanceAmount}), 0)::float8`,
    })
    .from(invoices)
    .where(invoiceWhere);

  const billed = round2(Number(collectionRow?.billed ?? 0));
  const collected = round2(Number(collectionRow?.collected ?? 0));
  const outstanding = round2(Number(collectionRow?.outstanding ?? 0));
  const collectionRate = billed > 0 ? round2((collected / billed) * 100) : 0;

  // OPEX for the period.
  const opexWhere = propertyId
    ? and(
        eq(operatingExpenses.organizationId, orgId),
        eq(operatingExpenses.propertyId, propertyId),
        eq(operatingExpenses.periodYear, monthStart.getUTCFullYear()),
        eq(operatingExpenses.periodMonth, monthStart.getUTCMonth() + 1),
      )
    : and(
        eq(operatingExpenses.organizationId, orgId),
        eq(operatingExpenses.periodYear, monthStart.getUTCFullYear()),
        eq(operatingExpenses.periodMonth, monthStart.getUTCMonth() + 1),
      );

  const [opexRow] = await db
    .select({ total: sql<number>`coalesce(sum(${operatingExpenses.amount}), 0)::float8` })
    .from(operatingExpenses)
    .where(opexWhere);
  const opex = round2(Number(opexRow?.total ?? 0));

  // Maintenance cost for the period.
  const maintenanceWhere = propertyId
    ? and(
        eq(maintenanceCosts.organizationId, orgId),
        eq(maintenanceCosts.propertyId, propertyId),
        gte(maintenanceCosts.incurredOn, monthStartIso),
        lte(maintenanceCosts.incurredOn, monthEndIso),
      )
    : and(
        eq(maintenanceCosts.organizationId, orgId),
        gte(maintenanceCosts.incurredOn, monthStartIso),
        lte(maintenanceCosts.incurredOn, monthEndIso),
      );

  const [maintenanceRow] = await db
    .select({ total: sql<number>`coalesce(sum(${maintenanceCosts.amount}), 0)::float8` })
    .from(maintenanceCosts)
    .where(maintenanceWhere);
  const maintenanceCost = round2(Number(maintenanceRow?.total ?? 0));

  // Work-order throughput.
  const workOrderWhere = propertyId
    ? and(
        eq(workOrders.organizationId, orgId),
        eq(workOrders.propertyId, propertyId),
        gte(workOrders.createdAt, monthStart),
        lte(workOrders.createdAt, addDays(monthEnd, 1)),
      )
    : and(
        eq(workOrders.organizationId, orgId),
        gte(workOrders.createdAt, monthStart),
        lte(workOrders.createdAt, addDays(monthEnd, 1)),
      );

  const [workOrderRow] = await db
    .select({
      created: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${workOrders.status} = 'completed')::int`,
    })
    .from(workOrders)
    .where(workOrderWhere);

  // NOI = gross rental income − vacancy loss − OPEX. Vacancy loss is the
  // rent forgone on units that were not under contract during the month.
  const vacantUnits = Math.max(0, totalUnits - occupiedUnits);
  const vacancyLoss =
    totalUnits > 0 ? round2((annualRentalValue / 12) * (vacantUnits / totalUnits)) : 0;
  const grossRentalIncome = billed;
  // NOI includes maintenance spend as operating cost (BRD 57, 156).
  const noi = round2(grossRentalIncome - vacancyLoss - opex - maintenanceCost);
  const noiMargin = grossRentalIncome > 0 ? round2((noi / grossRentalIncome) * 100) : 0;

  // Valuations are point-in-time; the monthly series interpolates linearly
  // between the prior and the current approved valuation.
  const progress = (totalMonths - 1 - monthsFromNow) / Math.max(1, totalMonths - 1);
  const marketValue = round2(priorValue + (currentValue - priorValue) * progress);

  return {
    occupancyRate,
    vacancyRate: round2(100 - occupancyRate),
    occupiedUnits,
    totalUnits,
    billed,
    collected,
    outstanding,
    collectionRate,
    opex,
    maintenanceCost,
    noi,
    noiMargin,
    marketValue,
    annualRentalValue,
    workOrdersCreated: Number(workOrderRow?.created ?? 0),
    workOrdersCompleted: Number(workOrderRow?.completed ?? 0),
  };
}

/** Seeds the notification centre from real overdue, expiring and SLA data. */
async function seedNotifications(
  db: Database,
  reference: ReferenceData,
  portfolio: PortfolioResult,
): Promise<void> {
  const orgId = reference.organizationId;
  const today = new Date();
  const rows: Array<typeof notifications.$inferInsert> = [];

  const overdue = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      balance: invoices.balanceAmount,
      dueDate: invoices.dueDate,
    })
    .from(invoices)
    .where(and(eq(invoices.organizationId, orgId), eq(invoices.status, 'overdue')))
    .limit(6);

  for (const invoice of overdue) {
    rows.push({
      organizationId: orgId,
      userId: reference.userIds.reem_alsubaie,
      notificationType: 'payment_overdue',
      severity: 'error',
      title: `Invoice ${invoice.invoiceNumber} is overdue`,
      body: `SAR ${Number(invoice.balance).toLocaleString()} outstanding since ${invoice.dueDate}.`,
      linkHref: `/collections/invoices/${invoice.id}`,
      entityType: 'invoice',
      entityId: invoice.id,
      createdAt: addDays(today, -Math.floor(Math.random() * 5)),
      isDemo: true,
    });
  }

  const expiring = await db
    .select({
      id: contracts.id,
      contractNumber: contracts.contractNumber,
      endDate: contracts.endDate,
    })
    .from(contracts)
    .where(
      and(
        eq(contracts.organizationId, orgId),
        eq(contracts.isActive, true),
        lte(contracts.endDate, iso(addDays(today, 90))),
      ),
    )
    .limit(5);

  for (const contract of expiring) {
    rows.push({
      organizationId: orgId,
      userId: reference.userIds.sarah_mohammed,
      notificationType: 'contract_expiry',
      severity: 'warning',
      title: `Contract ${contract.contractNumber} expires on ${contract.endDate}`,
      body: 'Start the renewal discussion to protect occupancy.',
      linkHref: `/contracts/${contract.id}`,
      entityType: 'contract',
      entityId: contract.id,
      createdAt: addDays(today, -Math.floor(Math.random() * 4)),
      isDemo: true,
    });
  }

  const slaBreaches = await db
    .select({ id: workOrders.id, code: workOrders.code, title: workOrders.title })
    .from(workOrders)
    .where(and(eq(workOrders.organizationId, orgId), eq(workOrders.resolutionSlaMet, false)))
    .limit(4);

  for (const workOrder of slaBreaches) {
    rows.push({
      organizationId: orgId,
      userId: reference.userIds.ali_kamal,
      notificationType: 'maintenance_sla_breach',
      severity: 'error',
      title: `SLA breached on ${workOrder.code}`,
      body: workOrder.title,
      linkHref: `/maintenance/${workOrder.id}`,
      entityType: 'work_order',
      entityId: workOrder.id,
      createdAt: addDays(today, -Math.floor(Math.random() * 6)),
      isDemo: true,
    });
  }

  const longVacant = await db
    .select({ id: units.id, code: units.code })
    .from(units)
    .where(and(eq(units.organizationId, orgId), eq(units.computedAvailabilityClass, 'available')))
    .limit(4);

  for (const unit of longVacant) {
    rows.push({
      organizationId: orgId,
      requiredPermission: 'units:view',
      notificationType: 'vacant_unit',
      severity: 'warning',
      title: `Unit ${unit.code} is available to lease`,
      body: 'Published to the website and included in the active availability list.',
      linkHref: `/units/${unit.id}`,
      entityType: 'unit',
      entityId: unit.id,
      createdAt: addDays(today, -Math.floor(Math.random() * 8)),
      isDemo: true,
    });
  }

  rows.push({
    organizationId: orgId,
    requiredPermission: 'pricing:approve',
    notificationType: 'approval_required',
    severity: 'warning',
    title: 'Pricing exception requests are awaiting your decision',
    body: 'Review the pending discount requests in the approvals queue.',
    linkHref: '/leasing/approvals',
    entityType: 'pricing_approval',
    createdAt: addDays(today, -1),
    isDemo: true,
  });

  rows.push({
    organizationId: orgId,
    requiredPermission: 'dashboard:view',
    notificationType: 'new_lead',
    severity: 'info',
    title: `${portfolio.properties.length} properties reporting into the executive dashboard`,
    body: 'Portfolio snapshots have been refreshed for the current period.',
    linkHref: '/dashboard',
    entityType: 'dashboard',
    createdAt: addDays(today, -2),
    isDemo: true,
  });

  if (rows.length > 0) {
    await insertInBatches(rows, 100, async (batch) => db.insert(notifications).values(batch));
  }
}
