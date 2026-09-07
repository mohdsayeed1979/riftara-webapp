import type { Database } from '../types';
import {
  budgetLines,
  budgets,
  campaignMetrics,
  campaigns,
  maintenanceAssets,
  maintenanceCosts,
  marketingAttributions,
  operatingExpenses,
  preventiveMaintenanceSchedules,
  workOrders,
} from '../schema';
import { CAMPAIGN_NAMES, WORK_ORDER_TITLES } from './names';
import type { PortfolioResult } from './portfolio';
import type { ReferenceData } from './reference';
import {
  addDays,
  addMonths,
  anchorMonth,
  insertInBatches,
  iso,
  round2,
  sequence,
  type Rng,
} from './util';

const ASSET_TEMPLATES = [
  { type: 'elevator', name: 'Passenger Elevator', cost: 420000, interval: 3 },
  { type: 'chiller', name: 'Air-Cooled Chiller', cost: 780000, interval: 3 },
  { type: 'generator', name: 'Standby Generator', cost: 350000, interval: 6 },
  { type: 'pump', name: 'Fire Booster Pump', cost: 120000, interval: 6 },
  { type: 'fire_panel', name: 'Fire Alarm Panel', cost: 95000, interval: 12 },
  { type: 'access_control', name: 'Access Control System', cost: 180000, interval: 12 },
  { type: 'cctv', name: 'CCTV Network', cost: 210000, interval: 12 },
];

/** OPEX weighting by category as a share of total operating expenditure. */
const OPEX_MIX: Array<[string, number]> = [
  ['maintenance', 0.24],
  ['security', 0.14],
  ['cleaning', 0.11],
  ['utilities', 0.19],
  ['landscaping', 0.04],
  ['facility_management', 0.09],
  ['insurance', 0.05],
  ['property_management', 0.07],
  ['municipality', 0.04],
  ['common_area', 0.03],
];

export async function seedOperations(
  db: Database,
  reference: ReferenceData,
  portfolio: PortfolioResult,
  rng: Rng,
): Promise<void> {
  const today = new Date();
  const currentMonth = anchorMonth(today);
  const orgId = reference.organizationId;
  const HISTORY_MONTHS = 24;

  const vendorKeys = Object.keys(reference.vendorIds);
  const maintenanceCategoryKeys = Object.keys(reference.maintenanceCategoryIds);

  // --- Asset register ------------------------------------------------------
  const assetRows: Array<typeof maintenanceAssets.$inferInsert> = [];
  let assetCounter = 0;

  for (const property of portfolio.properties) {
    const propertyUnits = portfolio.units.filter((u) => u.propertyId === property.id);
    const buildingIds = Array.from(new Set(propertyUnits.map((u) => u.buildingId)));

    for (const buildingId of buildingIds) {
      for (const template of ASSET_TEMPLATES) {
        // Warehouses do not carry elevators or chillers.
        if (property.key === 'dammam_logistics' && ['elevator', 'chiller'].includes(template.type)) continue;
        const quantity = template.type === 'elevator' ? rng.int(1, 3) : 1;
        for (let n = 1; n <= quantity; n += 1) {
          assetCounter += 1;
          const purchaseDate = addMonths(currentMonth, -rng.int(12, 48));
          assetRows.push({
            organizationId: orgId,
            code: sequence('AST', assetCounter, 5),
            nameEn: `${template.name} ${n}`,
            assetType: template.type,
            propertyId: property.id,
            buildingId,
            location: rng.pick(['Basement plant room', 'Roof plant room', 'Ground floor lobby', 'Service corridor']),
            manufacturer: rng.pick(['Otis', 'Carrier', 'Schneider', 'Caterpillar', 'Grundfos', 'Honeywell']),
            modelNumber: `MDL-${rng.int(1000, 9999)}`,
            serialNumber: `SN${rng.int(100000, 999999)}`,
            purchaseDate: iso(purchaseDate),
            purchaseCost: template.cost,
            warrantyExpiryDate: iso(addMonths(purchaseDate, 36)),
            supplierVendorId: reference.vendorIds[rng.pick(vendorKeys)],
            status: rng.weighted([
              ['operational', 18],
              ['under_maintenance', 1],
            ]),
            lastServiceDate: iso(addMonths(currentMonth, -rng.int(1, template.interval))),
            nextServiceDate: iso(addMonths(currentMonth, rng.int(0, template.interval))),
            isDemo: true,
          });
        }
      }
    }
  }

  const insertedAssets: Array<{ id: string; code: string; propertyId: string; assetType: string; buildingId: string | null }> = [];
  await insertInBatches(assetRows, 200, async (batch) => {
    const rows = await db.insert(maintenanceAssets).values(batch).returning({
      id: maintenanceAssets.id,
      code: maintenanceAssets.code,
      propertyId: maintenanceAssets.propertyId,
      assetType: maintenanceAssets.assetType,
      buildingId: maintenanceAssets.buildingId,
    });
    insertedAssets.push(...rows);
  });

  // --- Preventive maintenance schedules ------------------------------------
  const PM_CATEGORY_BY_ASSET: Record<string, string> = {
    elevator: 'elevators',
    chiller: 'hvac',
    generator: 'generator',
    pump: 'pumps',
    fire_panel: 'fire_safety',
    access_control: 'cctv_access',
    cctv: 'cctv_access',
  };

  const pmRows = insertedAssets.map((asset) => {
    const template = ASSET_TEMPLATES.find((t) => t.type === asset.assetType);
    const intervalMonths = template?.interval ?? 6;
    const nextDue = addMonths(currentMonth, rng.int(-1, intervalMonths));
    const frequency =
      intervalMonths === 3 ? 'quarterly' : intervalMonths === 6 ? 'semi_annual' : 'annual';
    return {
      organizationId: orgId,
      nameEn: `${frequency === 'quarterly' ? 'Quarterly' : frequency === 'semi_annual' ? 'Semi-annual' : 'Annual'} service — ${asset.assetType.replace(/_/g, ' ')}`,
      propertyId: asset.propertyId,
      buildingId: asset.buildingId,
      assetId: asset.id,
      categoryId: reference.maintenanceCategoryIds[PM_CATEGORY_BY_ASSET[asset.assetType] ?? 'other'],
      frequency,
      intervalMonths,
      nextDueDate: iso(nextDue),
      lastCompletedDate: iso(addMonths(nextDue, -intervalMonths)),
      vendorId: reference.vendorIds[rng.pick(vendorKeys)],
      estimatedCost: round2((template?.cost ?? 100000) * 0.04),
      status: nextDue < today ? 'overdue' : nextDue <= addDays(today, 30) ? 'due' : 'scheduled',
      checklist: ['Visual inspection', 'Functional test', 'Lubrication', 'Safety verification', 'Report issued'],
      isDemo: true,
    };
  });
  await insertInBatches(pmRows, 200, async (batch) =>
    db.insert(preventiveMaintenanceSchedules).values(batch),
  );

  // --- Work orders ---------------------------------------------------------
  const workOrderRows: Array<typeof workOrders.$inferInsert> = [];
  const costPlans: Array<{ code: string; propertyId: string; unitId: string | null; amount: number; incurredOn: Date; vendorKey: string }> = [];
  let workOrderCounter = 0;

  const SLA_BY_PRIORITY: Record<string, { response: number; resolution: number }> = {
    critical: { response: 1, resolution: 8 },
    high: { response: 4, resolution: 24 },
    medium: { response: 12, resolution: 72 },
    low: { response: 24, resolution: 168 },
  };

  for (let monthOffset = HISTORY_MONTHS - 1; monthOffset >= 0; monthOffset -= 1) {
    const month = addMonths(currentMonth, -monthOffset);
    const isCurrentMonth = monthOffset === 0;
    const ordersThisMonth = isCurrentMonth ? rng.int(14, 22) : rng.int(20, 34);

    for (let i = 0; i < ordersThisMonth; i += 1) {
      workOrderCounter += 1;
      const unit = rng.pick(portfolio.units);
      const categoryKey = rng.pick(maintenanceCategoryKeys);
      const titles = WORK_ORDER_TITLES[categoryKey] ?? WORK_ORDER_TITLES.other;
      const priority = rng.weighted<'low' | 'medium' | 'high' | 'critical'>([
        ['low', 3],
        ['medium', 5],
        ['high', 3],
        ['critical', 1],
      ]);
      const sla = SLA_BY_PRIORITY[priority];
      const createdAt = addDays(month, rng.int(0, 27));
      if (createdAt > today) continue;

      const maintenanceType = rng.weighted<'preventive' | 'corrective' | 'emergency' | 'inspection' | 'renovation' | 'unit_turnaround'>([
        ['corrective', 10],
        ['preventive', 6],
        ['inspection', 3],
        ['emergency', 2],
        ['renovation', 1],
        ['unit_turnaround', 1],
      ]);

      // Older months are fully closed; the current month carries the open backlog.
      const status = isCurrentMonth
        ? rng.weighted<'open' | 'assigned' | 'in_progress' | 'pending' | 'completed'>([
            ['open', 5],
            ['assigned', 3],
            ['in_progress', 4],
            ['pending', 2],
            ['completed', 6],
          ])
        : rng.weighted<'completed' | 'cancelled'>([
            ['completed', 24],
            ['cancelled', 1],
          ]);

      const isCompleted = status === 'completed';
      const responseHours = rng.weighted([
        [rng.int(1, sla.response), 8],
        [rng.int(sla.response + 1, sla.response * 3), 2],
      ]);
      const resolutionHours = isCompleted
        ? rng.weighted([
            [rng.int(2, sla.resolution), 9],
            [rng.int(sla.resolution + 1, sla.resolution * 2), 1],
          ])
        : null;
      const completedAt = isCompleted && resolutionHours !== null
        ? new Date(createdAt.getTime() + resolutionHours * 3600 * 1000)
        : null;

      const vendorKey = rng.pick(vendorKeys);
      const actualCost = isCompleted
        ? round2(
            rng.float(
              maintenanceType === 'emergency' ? 3500 : 600,
              maintenanceType === 'renovation' ? 85000 : maintenanceType === 'emergency' ? 28000 : 14000,
              0,
            ),
          )
        : 0;

      const code = sequence('WO', workOrderCounter, 5);
      workOrderRows.push({
        organizationId: orgId,
        code,
        title: rng.pick(titles),
        description: `Reported at ${unit.code}. ${rng.pick([
          'Tenant raised the request through the service desk.',
          'Identified during the routine building inspection.',
          'Escalated by the on-site facility supervisor.',
        ])}`,
        maintenanceType,
        categoryId: reference.maintenanceCategoryIds[categoryKey],
        propertyId: unit.propertyId,
        buildingId: unit.buildingId,
        unitId: rng.bool(0.75) ? unit.id : null,
        assetId: rng.bool(0.3)
          ? insertedAssets.find((a) => a.propertyId === unit.propertyId)?.id ?? null
          : null,
        priority,
        status,
        vendorId: reference.vendorIds[vendorKey],
        assignedUserId: rng.pick([reference.userIds.ali_kamal, reference.userIds.yousef_aldosari]),
        responseSlaHours: sla.response,
        resolutionSlaHours: sla.resolution,
        respondedAt: new Date(createdAt.getTime() + responseHours * 3600 * 1000),
        actualResponseHours: responseHours,
        completedAt,
        actualResolutionHours: resolutionHours,
        responseSlaMet: responseHours <= sla.response,
        resolutionSlaMet: resolutionHours === null ? null : resolutionHours <= sla.resolution,
        estimatedCost: round2(actualCost * rng.float(0.85, 1.15)),
        actualCost,
        resolutionNotes: isCompleted ? 'Work completed and verified with the tenant representative.' : null,
        createdAt,
        isDemo: true,
      });

      if (isCompleted && actualCost > 0 && completedAt) {
        costPlans.push({
          code,
          propertyId: unit.propertyId,
          unitId: rng.bool(0.75) ? unit.id : null,
          amount: actualCost,
          incurredOn: completedAt,
          vendorKey,
        });
      }
    }
  }

  const insertedWorkOrders: Array<{ id: string; code: string }> = [];
  await insertInBatches(workOrderRows, 250, async (batch) => {
    const rows = await db
      .insert(workOrders)
      .values(batch)
      .returning({ id: workOrders.id, code: workOrders.code });
    insertedWorkOrders.push(...rows);
  });
  const workOrderIdByCode = new Map(insertedWorkOrders.map((w) => [w.code, w.id]));

  const costRows = costPlans.map((plan) => ({
    organizationId: orgId,
    workOrderId: workOrderIdByCode.get(plan.code) as string,
    propertyId: plan.propertyId,
    unitId: plan.unitId,
    vendorId: reference.vendorIds[plan.vendorKey],
    costType: 'vendor_invoice',
    description: `Vendor invoice for work order ${plan.code}`,
    amount: plan.amount,
    vatAmount: round2(plan.amount * 0.15),
    invoiceNumber: `VI-${rng.int(100000, 999999)}`,
    incurredOn: iso(plan.incurredOn),
    recordedByUserId: reference.userIds.ali_kamal,
    isDemo: true,
  }));
  await insertInBatches(costRows, 300, async (batch) => db.insert(maintenanceCosts).values(batch));

  // --- Operating expenses --------------------------------------------------
  // OPEX is sized as a share of each property's annual rental value so that
  // NOI margins land in a realistic 62-78% band.
  const opexRows: Array<typeof operatingExpenses.$inferInsert> = [];
  let opexCounter = 0;

  for (const property of portfolio.properties) {
    const propertyUnits = portfolio.units.filter((u) => u.propertyId === property.id);
    const annualRentalValue = propertyUnits.reduce((sum, u) => sum + u.askingRent, 0);
    const annualOpexTarget = annualRentalValue * rng.float(0.24, 0.33, 3);

    for (let monthOffset = HISTORY_MONTHS - 1; monthOffset >= 0; monthOffset -= 1) {
      const month = addMonths(currentMonth, -monthOffset);
      for (const [categoryKey, share] of OPEX_MIX) {
        opexCounter += 1;
        // Utilities peak in summer; the seasonal shape shows in the charts.
        const seasonal =
          categoryKey === 'utilities' ? 1 + 0.35 * Math.sin(((month.getUTCMonth() - 3) / 12) * 2 * Math.PI) : 1;
        const amount = round2((annualOpexTarget / 12) * share * seasonal * rng.float(0.9, 1.1, 3));
        opexRows.push({
          organizationId: orgId,
          reference: sequence('OPX', opexCounter, 6),
          propertyId: property.id,
          categoryId: reference.expenseCategoryIds[categoryKey],
          vendorId: reference.vendorIds[rng.pick(vendorKeys)],
          description: `${categoryKey.replace(/_/g, ' ')} — ${iso(month).slice(0, 7)}`,
          amount,
          vatAmount: round2(amount * 0.15),
          incurredOn: iso(addDays(month, rng.int(1, 26))),
          periodYear: month.getUTCFullYear(),
          periodMonth: month.getUTCMonth() + 1,
          invoiceNumber: `EXP-${rng.int(100000, 999999)}`,
          isRecoverable: ['maintenance', 'security', 'cleaning', 'utilities', 'landscaping', 'facility_management', 'common_area'].includes(categoryKey),
          recordedByUserId: reference.userIds.omar_alqahtani,
          isDemo: true,
        });
      }
    }
  }
  await insertInBatches(opexRows, 400, async (batch) => db.insert(operatingExpenses).values(batch));

  // --- Budgets -------------------------------------------------------------
  const fiscalYear = today.getUTCFullYear();
  for (const property of portfolio.properties) {
    const propertyUnits = portfolio.units.filter((u) => u.propertyId === property.id);
    const annualRentalValue = propertyUnits.reduce((sum, u) => sum + u.askingRent, 0);

    const [budget] = await db
      .insert(budgets)
      .values({
        organizationId: orgId,
        name: `${property.name} — ${fiscalYear} Operating Budget`,
        fiscalYear,
        propertyId: property.id,
        status: 'approved',
        notes: 'Approved by the Asset Management Committee.',
        isDemo: true,
      })
      .returning({ id: budgets.id });

    const lines: Array<typeof budgetLines.$inferInsert> = [];
    for (let month = 1; month <= 12; month += 1) {
      lines.push(
        {
          budgetId: budget.id,
          lineType: 'revenue',
          periodMonth: month,
          budgetAmount: round2((annualRentalValue * 0.94) / 12),
          isDemo: true,
        },
        {
          budgetId: budget.id,
          lineType: 'collection',
          periodMonth: month,
          budgetAmount: round2((annualRentalValue * 0.9) / 12),
          isDemo: true,
        },
        {
          budgetId: budget.id,
          lineType: 'opex',
          periodMonth: month,
          budgetAmount: round2((annualRentalValue * 0.27) / 12),
          isDemo: true,
        },
        {
          budgetId: budget.id,
          lineType: 'maintenance',
          periodMonth: month,
          budgetAmount: round2((annualRentalValue * 0.07) / 12),
          isDemo: true,
        },
        {
          budgetId: budget.id,
          lineType: 'noi',
          periodMonth: month,
          budgetAmount: round2((annualRentalValue * 0.67) / 12),
          isDemo: true,
        },
      );
    }
    await insertInBatches(lines, 200, async (batch) => db.insert(budgetLines).values(batch));
  }

  // --- Marketing campaigns and daily metrics -------------------------------
  const platformKeys = Object.keys(reference.marketingPlatformIds).filter((k) => k !== 'website');
  const campaignRows: Array<typeof campaigns.$inferInsert> = [];

  CAMPAIGN_NAMES.forEach((name, index) => {
    const property = portfolio.properties[index % portfolio.properties.length];
    const platformKey = platformKeys[index % platformKeys.length];
    const startDate = addMonths(currentMonth, -rng.int(3, 9));
    campaignRows.push({
      organizationId: orgId,
      platformId: reference.marketingPlatformIds[platformKey],
      externalCampaignId: `${platformKey.toUpperCase()}-${rng.int(100000, 999999)}`,
      name,
      objective: rng.pick(['Lead Generation', 'Traffic', 'Brand Awareness', 'Conversions']),
      status: rng.weighted([
        ['active', 7],
        ['paused', 2],
        ['completed', 3],
      ]),
      startDate: iso(startDate),
      endDate: null,
      budget: round2(rng.int(60, 320) * 1000),
      propertyId: property.id,
      utmCampaign: name.toLowerCase().replace(/\s+/g, '-'),
      isDemo: true,
    });
  });

  const insertedCampaigns: Array<{ id: string; name: string; platformId: string }> = [];
  await insertInBatches(campaignRows, 50, async (batch) => {
    const rows = await db
      .insert(campaigns)
      .values(batch)
      .returning({ id: campaigns.id, name: campaigns.name, platformId: campaigns.platformId });
    insertedCampaigns.push(...rows);
  });

  const metricRows: Array<typeof campaignMetrics.$inferInsert> = [];
  const METRIC_DAYS = 180;
  for (const campaign of insertedCampaigns) {
    // Platform-specific efficiency so the comparison table has real spread.
    const cpc = rng.float(2.4, 7.5, 2);
    const ctr = rng.float(0.9, 3.4, 2);
    const leadRate = rng.float(0.03, 0.11, 3);
    const dailySpend = rng.float(600, 3200, 0);

    for (let d = METRIC_DAYS - 1; d >= 0; d -= 1) {
      const metricDate = addDays(today, -d);
      const spend = round2(dailySpend * rng.float(0.65, 1.4, 3));
      const clicks = Math.max(1, Math.round(spend / cpc));
      const impressions = Math.round((clicks / ctr) * 100);
      const leadCount = Math.round(clicks * leadRate);
      const qualified = Math.round(leadCount * rng.float(0.35, 0.6, 2));
      const viewingCount = Math.round(qualified * rng.float(0.4, 0.7, 2));
      const proposalCount = Math.round(viewingCount * rng.float(0.3, 0.55, 2));
      const reservationCount = Math.round(proposalCount * rng.float(0.25, 0.5, 2));
      const contractCount = Math.round(reservationCount * rng.float(0.5, 0.85, 2));

      metricRows.push({
        campaignId: campaign.id,
        metricDate: iso(metricDate),
        adId: null,
        spend,
        impressions,
        reach: Math.round(impressions * rng.float(0.55, 0.8, 2)),
        clicks,
        leadCount,
        qualifiedLeadCount: qualified,
        viewingCount,
        proposalCount,
        reservationCount,
        contractCount,
        contractValue: round2(contractCount * rng.float(250000, 1400000, 0)),
        isDemo: true,
      });
    }
  }
  await insertInBatches(metricRows, 500, async (batch) => db.insert(campaignMetrics).values(batch));

  // --- Marketing attribution for digitally-sourced leads -------------------
  const { eq, and, isNotNull } = await import('drizzle-orm');
  const { leads: leadsTable } = await import('../schema');
  const digitalLeads = await db
    .select({ id: leadsTable.id, utmSource: leadsTable.utmSource, createdAt: leadsTable.createdAt })
    .from(leadsTable)
    .where(and(eq(leadsTable.organizationId, orgId), isNotNull(leadsTable.utmSource)));

  const attributionRows = digitalLeads
    .filter((lead) => lead.utmSource && lead.utmSource !== 'direct')
    .flatMap((lead) => {
      const platformId = reference.marketingPlatformIds[lead.utmSource as string];
      if (!platformId) return [];
      const campaign = insertedCampaigns.find((c) => c.platformId === platformId);
      return [
        {
          organizationId: orgId,
          leadId: lead.id,
          campaignId: campaign?.id ?? null,
          platformId,
          touchType: 'first_touch',
          touchedAt: lead.createdAt,
          utmSource: lead.utmSource,
          utmMedium: 'cpc',
          creditBps: 10000,
          isDemo: true,
        },
        {
          organizationId: orgId,
          leadId: lead.id,
          campaignId: campaign?.id ?? null,
          platformId,
          touchType: 'last_touch',
          touchedAt: lead.createdAt,
          utmSource: lead.utmSource,
          utmMedium: 'cpc',
          creditBps: 10000,
          isDemo: true,
        },
      ];
    });
  if (attributionRows.length > 0) {
    await insertInBatches(attributionRows, 400, async (batch) =>
      db.insert(marketingAttributions).values(batch),
    );
  }
}
