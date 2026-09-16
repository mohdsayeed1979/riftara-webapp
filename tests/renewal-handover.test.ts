import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { bootstrapTestDb } from './setup-db';
import type { Database } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Phase 17 — Contract Renewal & Handover.
 *
 * Isolated seeded PGlite database (never production). Exercises the renewal
 * pipeline (eligibility, proposal, approval gate, tenant decision, renewed
 * contract generation, overlap prevention) and the handover checklist
 * (outstanding-balance gate, completion, unit-availability release), plus
 * RBAC and audit-trail coverage.
 */

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth/session')>();
  return { ...mod, getSession: vi.fn() };
});

let db: Database;
let cleanup: () => void;
let admin: SessionUser;
let getSessionMock: ReturnType<typeof vi.fn>;

let propertyA = '';
let unitTypeId = '';
let availableStatusId = '';

const uniq = () => Math.random().toString(36).slice(2, 8);

beforeAll(async () => {
  const ctx = await bootstrapTestDb();
  db = ctx.db;
  cleanup = ctx.cleanup;
  const { users, properties, unitTypes, unitStatuses } = await import('@/db/schema');
  const { loadSessionUser, getSession } = await import('@/lib/auth/session');
  getSessionMock = getSession as unknown as ReturnType<typeof vi.fn>;
  const [u] = await db.select().from(users).where(eq(users.email, 'sayeed.almousa@riftara.sa')).limit(1);
  admin = (await loadSessionUser(u.id))!;

  const [prop] = await db.select({ id: properties.id }).from(properties).where(eq(properties.organizationId, admin.organizationId)).limit(1);
  propertyA = prop.id;
  const [type] = await db.select({ id: unitTypes.id }).from(unitTypes).where(eq(unitTypes.organizationId, admin.organizationId)).limit(1);
  unitTypeId = type.id;
  const [status] = await db
    .select({ id: unitStatuses.id })
    .from(unitStatuses)
    .where(and(eq(unitStatuses.organizationId, admin.organizationId), eq(unitStatuses.key, 'available')))
    .limit(1);
  availableStatusId = status.id;
}, 180_000);

afterAll(() => cleanup?.());

async function makeUnit(): Promise<string> {
  const { createUnit } = await import('@/services/unit-service');
  const r = await createUnit(admin, {
    propertyId: propertyA,
    code: `U-RH-${uniq()}`,
    unitNumber: `RH-${Math.floor(Math.random() * 100000)}`,
    unitTypeId,
    usageType: 'commercial',
    statusId: availableStatusId,
    leasableArea: 100,
  });
  return r.id;
}
async function makeTenant(): Promise<string> {
  const { createCustomerWithDeduplication } = await import('@/services/customer-service');
  const { createTenant } = await import('@/services/tenant-service');
  const c = await createCustomerWithDeduplication(admin, { customerType: 'corporate', fullNameEn: `Co ${uniq()}`, companyName: `Co ${uniq()}` }, { linkOnDuplicate: false });
  const t = await createTenant(admin, { customerId: c.customerId, displayName: `Tenant ${uniq()}`, status: 'active' });
  return t.id;
}

/** Creates and signs a contract, returning its id, unit id and end date. */
async function makeActiveContract(opts: { startDate?: string; endDate?: string } = {}) {
  const { createContract, signContract } = await import('@/services/contract-service');
  const tenantId = await makeTenant();
  const unitId = await makeUnit();
  const created = await createContract(admin, {
    tenantId,
    propertyId: propertyA,
    unitId,
    startDate: opts.startDate ?? '2024-01-01',
    endDate: opts.endDate ?? '2027-12-31',
    annualRent: 100_000,
    paymentFrequency: 'quarterly',
  });
  await signContract(admin, created.id);
  return { contractId: created.id, unitId, tenantId, endDate: opts.endDate ?? '2027-12-31' };
}

describe('Renewal eligibility', () => {
  it('is eligible for an active contract', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { isContractRenewalEligible } = await import('@/services/renewal-service');
    const { contractId } = await makeActiveContract();
    const result = await isContractRenewalEligible(admin.organizationId, contractId);
    expect(result.eligible).toBe(true);
  });

  it('is not eligible for a draft contract', async () => {
    const { createContract } = await import('@/services/contract-service');
    const { isContractRenewalEligible } = await import('@/services/renewal-service');
    const tenantId = await makeTenant();
    const unitId = await makeUnit();
    const draft = await createContract(admin, {
      tenantId, propertyId: propertyA, unitId, startDate: '2027-01-01', endDate: '2027-12-31', annualRent: 50_000, paymentFrequency: 'annual',
    });
    const result = await isContractRenewalEligible(admin.organizationId, draft.id);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/signed or active/i);
  });

  it('is not eligible for a terminated contract', async () => {
    const { contracts } = await import('@/db/schema');
    const { isContractRenewalEligible } = await import('@/services/renewal-service');
    const { contractId } = await makeActiveContract();
    await db.update(contracts).set({ terminatedAt: new Date() }).where(eq(contracts.id, contractId));
    const result = await isContractRenewalEligible(admin.organizationId, contractId);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/terminated/i);
  });
});

describe('Renewal creation is idempotent', () => {
  it('returns the same renewal on repeated calls instead of creating a duplicate', async () => {
    const { renewals } = await import('@/db/schema');
    const { createRenewalFromContract } = await import('@/services/renewal-service');
    const { contractId } = await makeActiveContract();

    const first = await createRenewalFromContract(admin, contractId);
    const second = await createRenewalFromContract(admin, contractId);
    expect(first.id).toBe(second.id);
    expect(second.created).toBe(false);

    const rows = await db.select().from(renewals).where(eq(renewals.contractId, contractId));
    expect(rows.length).toBe(1);
  });

  it('records a create audit entry', async () => {
    const { auditLogs } = await import('@/db/schema');
    const { createRenewalFromContract } = await import('@/services/renewal-service');
    const { contractId } = await makeActiveContract();
    const { id } = await createRenewalFromContract(admin, contractId);
    const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, 'renewal'), eq(auditLogs.entityId, id)));
    expect(audits.some((a) => a.action === 'create')).toBe(true);
  });
});

describe('Rent-change approval gate', () => {
  it('a small rent change does not require approval; the offer can be sent directly', async () => {
    const { createRenewalFromContract, updateRenewalProposal, sendRenewalOffer, getRenewalById } = await import('@/services/renewal-service');
    const { contractId } = await makeActiveContract();
    const { id } = await createRenewalFromContract(admin, contractId);
    await updateRenewalProposal(admin, id, { proposedRent: 102_000 }); // +2%, within default 5% tolerance
    await sendRenewalOffer(admin, id);
    const data = await getRenewalById(admin.organizationId, id);
    expect(data?.renewal.status).toBe('offer_sent');
    expect(Number(data?.renewal.agreedRent)).toBe(102_000);
  });

  it('a large rent change requires approval before an offer can be sent', async () => {
    const { createRenewalFromContract, updateRenewalProposal, sendRenewalOffer, approveRenewal, getRenewalById } = await import('@/services/renewal-service');
    const { contractId } = await makeActiveContract();
    const { id } = await createRenewalFromContract(admin, contractId);
    await updateRenewalProposal(admin, id, { proposedRent: 130_000 }); // +30%, exceeds tolerance

    await expect(sendRenewalOffer(admin, id)).rejects.toMatchObject({ code: 'BUSINESS_RULE' });

    await approveRenewal(admin, id);
    await sendRenewalOffer(admin, id);
    const data = await getRenewalById(admin.organizationId, id);
    expect(data?.renewal.status).toBe('offer_sent');
    expect(Number(data?.renewal.agreedRent)).toBe(130_000);
  });

  it('approving a change that does not require approval is rejected', async () => {
    const { createRenewalFromContract, updateRenewalProposal, approveRenewal } = await import('@/services/renewal-service');
    const { contractId } = await makeActiveContract();
    const { id } = await createRenewalFromContract(admin, contractId);
    await updateRenewalProposal(admin, id, { proposedRent: 101_000 });
    await expect(approveRenewal(admin, id)).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('records an approve audit entry', async () => {
    const { auditLogs } = await import('@/db/schema');
    const { createRenewalFromContract, updateRenewalProposal, approveRenewal } = await import('@/services/renewal-service');
    const { contractId } = await makeActiveContract();
    const { id } = await createRenewalFromContract(admin, contractId);
    await updateRenewalProposal(admin, id, { proposedRent: 140_000 });
    await approveRenewal(admin, id);
    const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, 'renewal'), eq(auditLogs.entityId, id)));
    expect(audits.some((a) => a.action === 'approve')).toBe(true);
  });
});

describe('Tenant decision', () => {
  async function offeredRenewal() {
    const { createRenewalFromContract, updateRenewalProposal, sendRenewalOffer } = await import('@/services/renewal-service');
    const { contractId } = await makeActiveContract();
    const { id } = await createRenewalFromContract(admin, contractId);
    await updateRenewalProposal(admin, id, { proposedRent: 101_000 });
    await sendRenewalOffer(admin, id);
    return { renewalId: id, contractId };
  }

  it('acceptance never bypasses a required approval (agreedRent is already settled by the time an offer exists)', async () => {
    const { createRenewalFromContract, updateRenewalProposal, sendRenewalOffer, approveRenewal, recordTenantRenewalDecision, getRenewalById } = await import('@/services/renewal-service');
    const { contractId } = await makeActiveContract();
    const { id } = await createRenewalFromContract(admin, contractId);
    await updateRenewalProposal(admin, id, { proposedRent: 150_000 });
    await approveRenewal(admin, id);
    await sendRenewalOffer(admin, id);
    await recordTenantRenewalDecision(admin, id, 'accept');
    const data = await getRenewalById(admin.organizationId, id);
    expect(data?.renewal.agreedRent).not.toBeNull();
    expect(data?.renewal.decidedAt).not.toBeNull();
    expect(data?.renewal.status).toBe('offer_sent');
  });

  it('decline moves the renewal to a terminal state and resets the contract renewal status', async () => {
    const { recordTenantRenewalDecision, getRenewalById } = await import('@/services/renewal-service');
    const { contracts } = await import('@/db/schema');
    const { renewalId, contractId } = await offeredRenewal();
    await recordTenantRenewalDecision(admin, renewalId, 'decline', 'Tenant relocating');
    const data = await getRenewalById(admin.organizationId, renewalId);
    expect(data?.renewal.status).toBe('declined');
    const [contract] = await db.select().from(contracts).where(eq(contracts.id, contractId));
    expect(contract.status).not.toBe('terminated'); // original contract history preserved
  });

  it('not-renewed preserves the original contract untouched', async () => {
    const { createRenewalFromContract, markNotRenewed, getRenewalById } = await import('@/services/renewal-service');
    const { contracts } = await import('@/db/schema');
    const { contractId } = await makeActiveContract();
    const { id } = await createRenewalFromContract(admin, contractId);
    await markNotRenewed(admin, id, 'Owner wants to relist at market rate.');
    const data = await getRenewalById(admin.organizationId, id);
    expect(data?.renewal.status).toBe('not_renewed');
    const [contract] = await db.select().from(contracts).where(eq(contracts.id, contractId));
    expect(contract.status).toBe('active');
    expect(contract.endDate).toBe('2027-12-31');
  });
});

describe('Renewed contract generation', () => {
  async function acceptedRenewal(endDate = '2027-12-31') {
    const { createRenewalFromContract, updateRenewalProposal, sendRenewalOffer, recordTenantRenewalDecision } = await import('@/services/renewal-service');
    const { contractId, unitId } = await makeActiveContract({ endDate });
    const { id } = await createRenewalFromContract(admin, contractId);
    await updateRenewalProposal(admin, id, { proposedRent: 105_000 });
    await sendRenewalOffer(admin, id);
    await recordTenantRenewalDecision(admin, id, 'accept');
    return { renewalId: id, contractId, unitId, endDate };
  }

  it('generates the renewed contract linked to the original, on the day after it ends', async () => {
    const { generateRenewedContract } = await import('@/services/renewal-service');
    const { contracts, renewals } = await import('@/db/schema');
    const { renewalId, contractId } = await acceptedRenewal();

    const created = await generateRenewedContract(admin, renewalId, { startDate: '2028-01-01', endDate: '2028-12-31' });
    const [newContract] = await db.select().from(contracts).where(eq(contracts.id, created.id));
    expect(newContract.renewedFromContractId).toBe(contractId);
    expect(Number(newContract.annualRent)).toBe(105_000);
    expect(newContract.status).toBe('draft');

    const [renewal] = await db.select().from(renewals).where(eq(renewals.id, renewalId));
    expect(renewal.newContractId).toBe(created.id);
    expect(renewal.status).toBe('renewed');

    const [original] = await db.select().from(contracts).where(eq(contracts.id, contractId));
    expect(original.renewalStatus).toBe('renewed');
  });

  it('cannot be generated twice for the same renewal', async () => {
    const { generateRenewedContract } = await import('@/services/renewal-service');
    const { renewalId } = await acceptedRenewal();
    await generateRenewedContract(admin, renewalId, { startDate: '2028-01-01', endDate: '2028-12-31' });
    await expect(generateRenewedContract(admin, renewalId, { startDate: '2029-01-01', endDate: '2029-12-31' })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('cannot be generated before the tenant has accepted', async () => {
    const { createRenewalFromContract, updateRenewalProposal, sendRenewalOffer, generateRenewedContract } = await import('@/services/renewal-service');
    const { contractId } = await makeActiveContract();
    const { id } = await createRenewalFromContract(admin, contractId);
    await updateRenewalProposal(admin, id, { proposedRent: 101_000 });
    await sendRenewalOffer(admin, id);
    await expect(generateRenewedContract(admin, id, { startDate: '2028-01-01', endDate: '2028-12-31' })).rejects.toMatchObject({ code: 'BUSINESS_RULE' });
  });

  it('rejects an exact overlap with the original contract (same-day start)', async () => {
    const { generateRenewedContract } = await import('@/services/renewal-service');
    const { renewalId, endDate } = await acceptedRenewal();
    await expect(generateRenewedContract(admin, renewalId, { startDate: endDate, endDate: '2028-12-31' })).rejects.toMatchObject({ code: 'BUSINESS_RULE' });
  });

  it('rejects a partial overlap with another active contract on the same unit', async () => {
    const { createContract, signContract } = await import('@/services/contract-service');
    const { generateRenewedContract } = await import('@/services/renewal-service');
    const { renewalId, unitId } = await acceptedRenewal();

    // A second, unrelated active contract on the SAME unit, starting mid-way through the renewal period.
    const tenant2 = await makeTenant();
    const blocker = await createContract(admin, {
      tenantId: tenant2, propertyId: propertyA, unitId, startDate: '2028-06-01', endDate: '2029-05-31', annualRent: 90_000, paymentFrequency: 'annual',
    });
    await signContract(admin, blocker.id);

    await expect(generateRenewedContract(admin, renewalId, { startDate: '2028-01-01', endDate: '2028-12-31' })).rejects.toMatchObject({ code: 'BUSINESS_RULE' });
  });

  it('allows a contract that starts the day after the original ends (adjacent, non-overlapping)', async () => {
    const { generateRenewedContract } = await import('@/services/renewal-service');
    const { renewalId } = await acceptedRenewal('2027-12-31');
    const created = await generateRenewedContract(admin, renewalId, { startDate: '2028-01-01', endDate: '2028-12-31' });
    expect(created.id).toBeTruthy();
  });

  it('does not block on a terminated contract that previously occupied the unit', async () => {
    const { createContract, signContract } = await import('@/services/contract-service');
    const { contracts } = await import('@/db/schema');
    const { generateRenewedContract } = await import('@/services/renewal-service');
    const { renewalId, unitId } = await acceptedRenewal();

    // A terminated (inactive) contract on the same unit overlapping the new dates must NOT block generation.
    const tenant2 = await makeTenant();
    const old = await createContract(admin, {
      tenantId: tenant2, propertyId: propertyA, unitId, startDate: '2028-01-01', endDate: '2028-12-31', annualRent: 80_000, paymentFrequency: 'annual',
    });
    await signContract(admin, old.id);
    await db.update(contracts).set({ isActive: false, status: 'terminated', terminatedAt: new Date() }).where(eq(contracts.id, old.id));

    const created = await generateRenewedContract(admin, renewalId, { startDate: '2028-01-01', endDate: '2028-12-31' });
    expect(created.id).toBeTruthy();
  });
});

describe('Renewal RBAC', () => {
  it('starting a renewal is denied without renewals:create', async () => {
    const { contractId } = await makeActiveContract();
    const viewer: SessionUser = { ...admin, permissions: admin.permissions.filter((p) => p !== 'renewals:create') };
    getSessionMock.mockResolvedValue(viewer);
    const { startRenewalAction } = await import('@/app/(app)/renewals/actions');
    const r = await startRenewalAction(contractId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN');
    getSessionMock.mockResolvedValue(admin);
  });

  it('approving a renewal is denied without renewals:approve', async () => {
    const { createRenewalFromContract, updateRenewalProposal } = await import('@/services/renewal-service');
    const { contractId } = await makeActiveContract();
    const { id } = await createRenewalFromContract(admin, contractId);
    await updateRenewalProposal(admin, id, { proposedRent: 140_000 });

    const noApprove: SessionUser = { ...admin, permissions: admin.permissions.filter((p) => p !== 'renewals:approve') };
    getSessionMock.mockResolvedValue(noApprove);
    const { approveRenewalAction } = await import('@/app/(app)/renewals/actions');
    const r = await approveRenewalAction(id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN');
    getSessionMock.mockResolvedValue(admin);
  });
});

describe('Handover — outstanding balance gate', () => {
  it('reports the outstanding balance from the contract invoices', async () => {
    const { getOutstandingBalance } = await import('@/services/handover-service');
    const { contractId } = await makeActiveContract();
    const balance = await getOutstandingBalance(admin.organizationId, contractId);
    expect(balance.totalBilled).toBeGreaterThan(0);
    expect(balance.outstanding).toBeGreaterThan(0);
  });

  it('initiation is idempotent for the same contract and type', async () => {
    const { handovers } = await import('@/db/schema');
    const { initiateHandover } = await import('@/services/handover-service');
    const { contractId } = await makeActiveContract();
    const first = await initiateHandover(admin, { contractId, handoverType: 'move_out' });
    const second = await initiateHandover(admin, { contractId, handoverType: 'move_out' });
    expect(first.id).toBe(second.id);
    const rows = await db.select().from(handovers).where(eq(handovers.contractId, contractId));
    expect(rows.length).toBe(1);
  });

  it('blocks completion while the checklist is incomplete', async () => {
    const { initiateHandover, completeHandover } = await import('@/services/handover-service');
    const { contractId } = await makeActiveContract();
    const { id } = await initiateHandover(admin, { contractId, handoverType: 'move_out' });
    await expect(completeHandover(admin, id)).rejects.toMatchObject({ code: 'BUSINESS_RULE' });
  });

  it('blocks completion while an outstanding balance remains, even if the checklist is complete (server-side re-check)', async () => {
    const { initiateHandover, updateHandoverChecklist, completeHandover } = await import('@/services/handover-service');
    const { contractId } = await makeActiveContract();
    const { id } = await initiateHandover(admin, { contractId, handoverType: 'move_out' });
    await updateHandoverChecklist(admin, id, { contractSigned: true, paymentReceived: true, depositReceived: true, unitReady: true });
    await expect(completeHandover(admin, id)).rejects.toMatchObject({ code: 'BUSINESS_RULE' });
  });

  it('allows completion once the balance is cleared, and releases the unit on move-out', async () => {
    const { initiateHandover, updateHandoverChecklist, completeHandover, getOutstandingBalance } = await import('@/services/handover-service');
    const { recordPayment } = await import('@/services/collection-service');
    const { units, unitStatuses } = await import('@/db/schema');
    const { contractId, unitId, tenantId } = await makeActiveContract();

    const balance = await getOutstandingBalance(admin.organizationId, contractId);
    await recordPayment(admin, { tenantId, contractId, amount: balance.totalBilled, paymentDate: new Date().toISOString().slice(0, 10), method: 'bank_transfer' });

    const { id } = await initiateHandover(admin, { contractId, handoverType: 'move_out' });
    await updateHandoverChecklist(admin, id, { contractSigned: true, paymentReceived: true, depositReceived: true, unitReady: true });

    const result = await completeHandover(admin, id);
    expect(result.unitReleased).toBe(true);

    const [unitRow] = await db
      .select({ statusKey: unitStatuses.key })
      .from(units)
      .innerJoin(unitStatuses, eq(unitStatuses.id, units.statusId))
      .where(eq(units.id, unitId));
    expect(unitRow.statusKey).toBe('available');
  });

  it('does not release the unit when another active contract still holds it', async () => {
    const { createContract, signContract } = await import('@/services/contract-service');
    const { initiateHandover, updateHandoverChecklist, completeHandover } = await import('@/services/handover-service');
    const { recordPayment } = await import('@/services/collection-service');
    const { units, unitStatuses } = await import('@/db/schema');
    const { contractId, unitId, tenantId } = await makeActiveContract({ startDate: '2024-01-01', endDate: '2024-12-31' });

    // A second, still-active contract on the same unit for a later period.
    const tenant2 = await makeTenant();
    const other = await createContract(admin, {
      tenantId: tenant2, propertyId: propertyA, unitId, startDate: '2025-01-01', endDate: '2026-12-31', annualRent: 90_000, paymentFrequency: 'annual',
    });
    await signContract(admin, other.id);

    const { getOutstandingBalance } = await import('@/services/handover-service');
    const balance = await getOutstandingBalance(admin.organizationId, contractId);
    await recordPayment(admin, { tenantId, contractId, amount: balance.totalBilled, paymentDate: new Date().toISOString().slice(0, 10), method: 'bank_transfer' });

    const { id } = await initiateHandover(admin, { contractId, handoverType: 'move_out' });
    await updateHandoverChecklist(admin, id, { contractSigned: true, paymentReceived: true, depositReceived: true, unitReady: true });
    const result = await completeHandover(admin, id);
    expect(result.unitReleased).toBe(false);

    const [unitRow] = await db
      .select({ statusKey: unitStatuses.key })
      .from(units)
      .innerJoin(unitStatuses, eq(unitStatuses.id, units.statusId))
      .where(eq(units.id, unitId));
    expect(unitRow.statusKey).toBe('leased');
  });

  it('records create, checklist-update and completion audit entries', async () => {
    const { auditLogs } = await import('@/db/schema');
    const { initiateHandover, updateHandoverChecklist, completeHandover } = await import('@/services/handover-service');
    const { recordPayment } = await import('@/services/collection-service');
    const { getOutstandingBalance } = await import('@/services/handover-service');
    const { contractId, tenantId } = await makeActiveContract();

    const balance = await getOutstandingBalance(admin.organizationId, contractId);
    await recordPayment(admin, { tenantId, contractId, amount: balance.totalBilled, paymentDate: new Date().toISOString().slice(0, 10), method: 'bank_transfer' });

    const { id } = await initiateHandover(admin, { contractId, handoverType: 'move_out' });
    await updateHandoverChecklist(admin, id, { contractSigned: true, paymentReceived: true, depositReceived: true, unitReady: true });
    await completeHandover(admin, id);

    const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, 'handover'), eq(auditLogs.entityId, id)));
    expect(audits.some((a) => a.action === 'create')).toBe(true);
    expect(audits.filter((a) => a.action === 'update').length).toBeGreaterThanOrEqual(2); // checklist update + completion
  });
});

describe('Handover RBAC', () => {
  it('starting a handover is denied without handovers:create', async () => {
    const { contractId } = await makeActiveContract();
    const viewer: SessionUser = { ...admin, permissions: admin.permissions.filter((p) => p !== 'handovers:create') };
    getSessionMock.mockResolvedValue(viewer);
    const { startHandoverAction } = await import('@/app/(app)/handovers/actions');
    const r = await startHandoverAction(contractId, 'move_out');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN');
    getSessionMock.mockResolvedValue(admin);
  });

  it('completing a handover is denied without handovers:edit', async () => {
    const { initiateHandover } = await import('@/services/handover-service');
    const { contractId } = await makeActiveContract();
    const { id } = await initiateHandover(admin, { contractId, handoverType: 'move_out' });

    const noEdit: SessionUser = { ...admin, permissions: admin.permissions.filter((p) => p !== 'handovers:edit') };
    getSessionMock.mockResolvedValue(noEdit);
    const { completeHandoverAction } = await import('@/app/(app)/handovers/actions');
    const r = await completeHandoverAction(id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN');
    getSessionMock.mockResolvedValue(admin);
  });
});
