import type { Database } from '../types';
import {
  leadActivities,
  leads,
  pricingApprovals,
  proposals,
  reservations,
  viewingFeedback,
  viewings,
} from '../schema';
import type { LeasingResult } from './leasing';
import type { PortfolioResult } from './portfolio';
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

const OPEN_STAGE_WEIGHTS: ReadonlyArray<readonly [string, number]> = [
  ['new_lead', 14],
  ['contact_attempted', 6],
  ['contacted', 10],
  ['qualified', 9],
  ['viewing_scheduled', 8],
  ['viewing_completed', 7],
  ['negotiation', 6],
  ['proposal_issued', 6],
  ['pending_approval', 3],
  ['approved', 3],
  ['reserved', 3],
  ['contract_preparation', 2],
  ['contract_issued', 2],
  ['contract_signed', 2],
];

const NEXT_ACTIONS = [
  'Call to confirm requirements',
  'Send updated availability list',
  'Schedule a site viewing',
  'Follow up on the issued proposal',
  'Prepare a revised commercial offer',
  'Confirm fit-out expectations',
  'Collect commercial registration documents',
  'Agree reservation terms',
];

const ACTIVITY_TEMPLATES = [
  { type: 'call', subject: 'Discovery call', outcome: 'Requirements captured' },
  { type: 'whatsapp', subject: 'WhatsApp follow-up', outcome: 'Customer replied' },
  { type: 'email', subject: 'Availability list sent', outcome: 'Delivered' },
  { type: 'meeting', subject: 'Meeting at the property', outcome: 'Positive interest' },
  { type: 'note', subject: 'Internal note', outcome: null },
  { type: 'viewing', subject: 'Site viewing completed', outcome: 'Shortlisted two units' },
];

/**
 * Generates the leasing pipeline: leads across every stage with SLA data,
 * viewings with feedback, versioned proposals, pricing approvals and
 * reservations on the units the portfolio seed reserved.
 */
export async function seedPipeline(
  db: Database,
  reference: ReferenceData,
  portfolio: PortfolioResult,
  leasing: LeasingResult,
  rng: Rng,
): Promise<void> {
  const today = new Date();
  const currentMonth = anchorMonth(today);
  const orgId = reference.organizationId;

  const agents = [
    reference.userIds.ahmed_khalid,
    reference.userIds.maha_alzahrani,
    reference.userIds.sarah_mohammed,
  ];
  const lossReasonKeys = Object.keys(reference.lossReasonIds);
  const availableUnits = portfolio.units.filter((u) => u.occupancyPlan !== 'leased');
  const allUnits = portfolio.units;

  // --- Leads ---------------------------------------------------------------
  const TOTAL_LEADS = 340;
  const leadRows: Array<typeof leads.$inferInsert> = [];
  const leadPlans: Array<{
    code: string;
    stageKey: string;
    customerId: string;
    unit: (typeof portfolio.units)[number];
    createdAt: Date;
    assignedUserId: string;
    sourceKey: string;
  }> = [];

  for (let i = 0; i < TOTAL_LEADS; i += 1) {
    const code = sequence('LEAD', i + 1, 5);
    const createdAt = addDays(today, -rng.int(0, 210));
    const customer = rng.pick(leasing.customers);
    const unit = rng.pick(availableUnits.length > 0 ? availableUnits : allUnits);
    const assignedUserId = rng.pick(agents);
    const sourceKey = rng.weighted<string>([
      ['corporate_website', 22],
      ['google_ads', 14],
      ['instagram', 8],
      ['linkedin', 10],
      ['tiktok', 7],
      ['snapchat', 6],
      ['whatsapp', 6],
      ['referral', 8],
      ['broker', 6],
      ['walk_in', 5],
      ['aqar', 4],
      ['bayut', 3],
      ['call_center', 4],
      ['property_finder', 3],
    ]);

    // 18% of leads are closed: two thirds won, one third lost with a reason.
    const isClosed = rng.bool(0.18);
    const isWon = isClosed && rng.bool(0.62);
    const stageKey = isClosed ? (isWon ? 'won' : 'lost') : rng.weighted(OPEN_STAGE_WEIGHTS);

    // SLA: most leads are answered inside the 15-minute target.
    const responded = stageKey !== 'new_lead';
    const firstResponseMinutes = responded
      ? rng.weighted([
          [rng.int(2, 14), 70],
          [rng.int(15, 29), 18],
          [rng.int(30, 180), 12],
        ])
      : null;
    const slaBreached = firstResponseMinutes !== null && firstResponseMinutes > 15;
    const escalated = firstResponseMinutes !== null && firstResponseMinutes > 30;

    const qualification =
      stageKey === 'lost'
        ? 'disqualified'
        : ['new_lead', 'contact_attempted', 'contacted'].includes(stageKey)
          ? 'unqualified'
          : 'qualified';

    const utmSource =
      sourceKey === 'google_ads'
        ? 'google'
        : sourceKey === 'instagram' || sourceKey === 'facebook'
          ? 'meta'
          : ['tiktok', 'snapchat', 'linkedin'].includes(sourceKey)
            ? sourceKey
            : 'direct';

    leadPlans.push({ code, stageKey, customerId: customer.id, unit, createdAt, assignedUserId, sourceKey });

    leadRows.push({
      organizationId: orgId,
      code,
      customerId: customer.id,
      stageId: reference.leadStageIds[stageKey],
      sourceId: reference.leadSourceIds[sourceKey],
      requestedPropertyId: unit.propertyId,
      requestedUnitId: unit.id,
      requiredArea: round2(unit.leasableArea * rng.float(0.75, 1.25)),
      budgetMin: roundRent(unit.askingRent * 0.85),
      budgetMax: roundRent(unit.askingRent * 1.15),
      moveInDate: iso(addMonths(currentMonth, rng.int(1, 6))),
      assignedUserId,
      assignedAt: addDays(createdAt, 0),
      qualification,
      priority: rng.weighted([
        ['low', 2],
        ['medium', 5],
        ['high', 3],
      ]),
      score: rng.int(20, 95),
      // BR-006 companion: an open lead always carries a next action.
      nextAction: stageKey === 'won' || stageKey === 'lost' ? null : rng.pick(NEXT_ACTIONS),
      nextFollowUpAt:
        stageKey === 'won' || stageKey === 'lost' ? null : addDays(today, rng.int(-3, 14)),
      firstResponseAt: firstResponseMinutes ? addDays(createdAt, 0) : null,
      firstResponseMinutes,
      slaBreached,
      escalatedAt: escalated ? addDays(createdAt, 0) : null,
      lossReasonId: stageKey === 'lost' ? reference.lossReasonIds[rng.pick(lossReasonKeys)] : null,
      lossNotes:
        stageKey === 'lost' ? 'Customer confirmed they will not proceed at this stage.' : null,
      closedAt: isClosed ? addDays(createdAt, rng.int(5, 60)) : null,
      landingPage: sourceKey === 'corporate_website' ? '/properties/office-space-riyadh' : null,
      device: rng.pick(['desktop', 'mobile', 'tablet']),
      utmSource,
      utmMedium: sourceKey.includes('ads') ? 'cpc' : 'organic',
      utmCampaign: sourceKey.includes('ads') ? 'winter-leasing-push' : null,
      firstTouchSource: utmSource,
      lastTouchSource: utmSource,
      createdAt,
      isDemo: true,
    });
  }

  const insertedLeads: Array<{ id: string; code: string }> = [];
  await insertInBatches(leadRows, 150, async (batch) => {
    const rows = await db.insert(leads).values(batch).returning({ id: leads.id, code: leads.code });
    insertedLeads.push(...rows);
  });
  const leadIdByCode = new Map(insertedLeads.map((l) => [l.code, l.id]));

  // --- Lead activities -----------------------------------------------------
  const activityRows: Array<typeof leadActivities.$inferInsert> = [];
  for (const plan of leadPlans) {
    const activityCount = rng.int(1, 5);
    for (let i = 0; i < activityCount; i += 1) {
      const template = rng.pick(ACTIVITY_TEMPLATES);
      const occurredAt = addDays(plan.createdAt, i * rng.int(1, 6));
      if (occurredAt > today) break;
      activityRows.push({
        organizationId: orgId,
        leadId: leadIdByCode.get(plan.code) as string,
        customerId: plan.customerId,
        activityType: template.type,
        subject: template.subject,
        body:
          template.type === 'note'
            ? 'Customer is comparing two shortlisted units and needs a fit-out allowance.'
            : `${template.subject} regarding ${plan.unit.code}.`,
        outcome: template.outcome,
        direction: template.type === 'note' ? 'internal' : rng.bool(0.6) ? 'outbound' : 'inbound',
        occurredAt,
        userId: plan.assignedUserId,
        isDemo: true,
      });
    }
  }
  await insertInBatches(activityRows, 400, async (batch) => db.insert(leadActivities).values(batch));

  // --- Viewings ------------------------------------------------------------
  const viewingCandidates = leadPlans.filter((plan) =>
    [
      'viewing_scheduled',
      'viewing_completed',
      'negotiation',
      'proposal_issued',
      'pending_approval',
      'approved',
      'reserved',
      'contract_preparation',
      'contract_issued',
      'contract_signed',
      'won',
      'lost',
    ].includes(plan.stageKey),
  );

  const viewingRows: Array<typeof viewings.$inferInsert> = [];
  const viewingPlans: Array<{ code: string; completed: boolean }> = [];

  viewingCandidates.forEach((plan, index) => {
    const code = sequence('VW', index + 1, 5);
    const scheduled = addDays(plan.createdAt, rng.int(2, 20));
    const isFuture = scheduled > today;
    const status = isFuture
      ? rng.weighted<'scheduled' | 'confirmed'>([
          ['scheduled', 3],
          ['confirmed', 2],
        ])
      : rng.weighted<'completed' | 'cancelled' | 'no_show' | 'rescheduled'>([
          ['completed', 8],
          ['cancelled', 1],
          ['no_show', 1],
          ['rescheduled', 1],
        ]);

    viewingPlans.push({ code, completed: status === 'completed' });
    viewingRows.push({
      organizationId: orgId,
      code,
      leadId: leadIdByCode.get(plan.code) as string,
      customerId: plan.customerId,
      propertyId: plan.unit.propertyId,
      unitId: plan.unit.id,
      assignedUserId: plan.assignedUserId,
      meetingPoint: 'Main reception',
      scheduledDate: iso(scheduled),
      scheduledTime: `${String(rng.int(9, 16)).padStart(2, '0')}:${rng.pick(['00', '30'])}:00`,
      status,
      customerConfirmed: !isFuture || rng.bool(0.6),
      completedAt: status === 'completed' ? scheduled : null,
      isDemo: true,
    });
  });

  const insertedViewings: Array<{ id: string; code: string }> = [];
  await insertInBatches(viewingRows, 200, async (batch) => {
    const rows = await db
      .insert(viewings)
      .values(batch)
      .returning({ id: viewings.id, code: viewings.code });
    insertedViewings.push(...rows);
  });
  const viewingIdByCode = new Map(insertedViewings.map((v) => [v.code, v.id]));

  const feedbackRows = viewingPlans
    .filter((plan) => plan.completed)
    .map((plan) => ({
      viewingId: viewingIdByCode.get(plan.code) as string,
      interestLevel: rng.int(2, 5),
      priceSuitability: rng.int(2, 5),
      areaSuitability: rng.int(3, 5),
      locationSuitability: rng.int(3, 5),
      unitSuitability: rng.int(2, 5),
      likelihoodToLease: rng.int(2, 5),
      customerComments: rng.pick([
        'The layout works well but the asking rent is above our approved budget.',
        'Very good location and finishing quality. We would need a longer fit-out period.',
        'Parking allocation is the deciding factor for us.',
        'We prefer a higher floor with better natural light.',
      ]),
      agentComments: rng.pick([
        'Strong fit. Recommend issuing a proposal with a modest incentive.',
        'Customer needs an alternative with a larger floor plate.',
        'Follow up in one week once their board approves the budget.',
      ]),
      nextAction: rng.pick(NEXT_ACTIONS),
      recordedByUserId: reference.userIds.ahmed_khalid,
      isDemo: true,
    }));
  if (feedbackRows.length > 0) {
    await insertInBatches(feedbackRows, 200, async (batch) => db.insert(viewingFeedback).values(batch));
  }

  // --- Pricing approvals and proposals -------------------------------------
  const proposalCandidates = leadPlans.filter((plan) =>
    [
      'proposal_issued',
      'pending_approval',
      'approved',
      'reserved',
      'contract_preparation',
      'contract_issued',
      'contract_signed',
      'won',
    ].includes(plan.stageKey),
  );

  const approvalRows: Array<typeof pricingApprovals.$inferInsert> = [];
  const proposalRows: Array<typeof proposals.$inferInsert> = [];

  proposalCandidates.forEach((plan, index) => {
    const askingRent = plan.unit.askingRent;
    const discountPercent = rng.weighted([
      [0, 4],
      [rng.float(2, 5), 3],
      [rng.float(5.1, 10), 2],
      [rng.float(10.1, 14), 1],
    ]);
    const requestedRent = roundRent(askingRent * (1 - discountPercent / 100));
    const termMonths = rng.pick([12, 24, 36, 60]);
    const needsApproval = discountPercent > 0;

    const reference_ = sequence('PA-2025', index + 1);
    if (needsApproval) {
      const status =
        plan.stageKey === 'pending_approval'
          ? 'pending'
          : rng.weighted<'approved' | 'rejected' | 'returned'>([
              ['approved', 8],
              ['rejected', 1],
              ['returned', 1],
            ]);
      approvalRows.push({
        organizationId: orgId,
        reference: reference_,
        unitId: plan.unit.id,
        propertyId: plan.unit.propertyId,
        customerId: plan.customerId,
        askingPrice: askingRent,
        requestedPrice: requestedRent,
        discountAmount: round2(askingRent - requestedRent),
        discountPercent: round2(discountPercent),
        annualImpact: round2(askingRent - requestedRent),
        contractTermMonths: termMonths,
        totalContractValue: round2((requestedRent * termMonths) / 12),
        justification:
          discountPercent > 10
            ? 'Strategic anchor tenant with multi-unit expansion commitment over the lease term.'
            : 'Long-term commitment and immediate occupancy; discount within market benchmarks.',
        requiredRoleKey:
          discountPercent <= 5 ? 'leasing_manager' : discountPercent <= 10 ? 'asset_manager' : 'executive',
        status,
        requestedByUserId: plan.assignedUserId,
        decidedByUserId: status === 'pending' ? null : reference.userIds.nora_alhamdan,
        decidedAt: status === 'pending' ? null : addDays(today, -rng.int(1, 25)),
        decisionNotes:
          status === 'approved'
            ? 'Approved. Tenant covenant and lease term justify the concession.'
            : status === 'rejected'
              ? 'Rejected. Requested rent falls below the approved floor for this asset.'
              : status === 'returned'
                ? 'Returned for modification — please attach the tenant business case.'
                : null,
        isDemo: true,
      });
    }

    const proposalReference = sequence('P-2025', index + 1);
    const versionCount = rng.weighted([
      [1, 6],
      [2, 3],
      [3, 1],
    ]);

    for (let version = 1; version <= versionCount; version += 1) {
      const isLatest = version === versionCount;
      const versionRent = roundRent(requestedRent * (1 + (versionCount - version) * 0.02));
      const annualRent = versionRent;
      const status = !isLatest
        ? 'superseded'
        : plan.stageKey === 'pending_approval'
          ? 'pending_approval'
          : plan.stageKey === 'won' || plan.stageKey === 'contract_signed'
            ? 'accepted'
            : rng.weighted<'sent' | 'approved' | 'draft'>([
                ['sent', 6],
                ['approved', 3],
                ['draft', 1],
              ]);

      proposalRows.push({
        organizationId: orgId,
        reference: proposalReference,
        version,
        leadId: leadIdByCode.get(plan.code) as string,
        customerId: plan.customerId,
        propertyId: plan.unit.propertyId,
        unitId: plan.unit.id,
        leasableArea: plan.unit.leasableArea,
        rentPerSqm: round2(annualRent / plan.unit.leasableArea),
        annualRent,
        vatAmount: round2(annualRent * 0.15),
        serviceCharges: plan.unit.serviceCharges,
        depositAmount: roundRent(annualRent * 0.25),
        contractDurationMonths: termMonths,
        paymentTerms: rng.pick(['quarterly', 'semi_annual', 'annual']),
        escalationPercent: rng.pick([0, 3, 5]),
        gracePeriodDays: rng.pick([0, 30, 60]),
        fitOutPeriodDays: rng.pick([0, 30, 60, 90]),
        parkingSpaces: Math.max(1, Math.round(plan.unit.leasableArea / 60)),
        specialTerms:
          version > 1 ? 'Revised following customer feedback on the fit-out contribution.' : null,
        totalContractValue: round2((annualRent * termMonths) / 12),
        status,
        validUntil: iso(addDays(today, 30)),
        sentAt: status === 'draft' ? null : addDays(today, -rng.int(1, 40)),
        createdByUserId: plan.assignedUserId,
        isDemo: true,
      });
    }
  });

  if (approvalRows.length > 0) {
    await insertInBatches(approvalRows, 200, async (batch) => db.insert(pricingApprovals).values(batch));
  }
  await insertInBatches(proposalRows, 200, async (batch) => db.insert(proposals).values(batch));

  // --- Reservations on the units the portfolio marked as reserved ----------
  const reservedUnits = portfolio.units.filter((u) => u.occupancyPlan === 'reserved');
  const reservationRows = reservedUnits.map((unit, index) => {
    const reservationDate = addDays(today, -rng.int(1, 10));
    const customer = rng.pick(leasing.customers.filter((c) => c.isCorporate));
    return {
      organizationId: orgId,
      code: sequence('RES-2025', index + 1),
      customerId: customer.id,
      propertyId: unit.propertyId,
      unitId: unit.id,
      reservationDate: iso(reservationDate),
      expiryDate: iso(addDays(reservationDate, 14)),
      reservationAmount: 10000,
      paymentStatus: rng.weighted([
        ['paid', 7],
        ['unpaid', 3],
      ]),
      terms: 'Reservation is valid for 14 days pending contract execution and deposit settlement.',
      status: 'active' as const,
      isActive: true,
      createdByUserId: reference.userIds.ahmed_khalid,
      isDemo: true,
    };
  });
  if (reservationRows.length > 0) {
    await insertInBatches(reservationRows, 100, async (batch) => db.insert(reservations).values(batch));
  }
}
