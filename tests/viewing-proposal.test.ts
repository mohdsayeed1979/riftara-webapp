import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { bootstrapTestDb } from './setup-db';
import type { Database } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Phase 4B — Viewing + Proposal + Pricing Approval. Isolated seeded PGlite DB.
 * Verifies viewing lifecycle + feedback, proposal lifecycle, BR-004 approval via
 * the existing pricing engine, reservation gating, versioning, RBAC, org
 * isolation, UUID guards and audit.
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
let propertyB = '';
let unitTypeId = '';
let availableStatusId = '';

const uniq = () => Math.random().toString(36).slice(2, 8);
const OTHER_ORG = '00000000-0000-4000-8000-000000000000';

beforeAll(async () => {
  const ctx = await bootstrapTestDb();
  db = ctx.db;
  cleanup = ctx.cleanup;
  const { users, properties, unitTypes, unitStatuses } = await import('@/db/schema');
  const { loadSessionUser, getSession } = await import('@/lib/auth/session');
  getSessionMock = getSession as unknown as ReturnType<typeof vi.fn>;
  const [u] = await db.select().from(users).where(eq(users.email, 'sayeed.almousa@riftara.sa')).limit(1);
  admin = (await loadSessionUser(u.id))!;
  const props = await db.select({ id: properties.id }).from(properties).where(eq(properties.organizationId, admin.organizationId)).limit(2);
  propertyA = props[0].id; propertyB = props[1].id;
  unitTypeId = (await db.select({ id: unitTypes.id }).from(unitTypes).where(eq(unitTypes.organizationId, admin.organizationId)).limit(1))[0].id;
  availableStatusId = (await db.select({ id: unitStatuses.id }).from(unitStatuses).where(and(eq(unitStatuses.organizationId, admin.organizationId), eq(unitStatuses.key, 'available'))).limit(1))[0].id;
}, 180_000);

afterAll(() => cleanup?.());

async function makeUnit(askingRent = 100000, propertyId = propertyA): Promise<string> {
  const { createUnit } = await import('@/services/unit-service');
  const { updateUnitPricing } = await import('@/services/pricing-service');
  const r = await createUnit(admin, { propertyId, code: `U-VP-${uniq()}`, unitNumber: `VP-${Math.floor(Math.random() * 100000)}`, unitTypeId, usageType: 'commercial', statusId: availableStatusId, leasableArea: 100 });
  if (askingRent > 0) await updateUnitPricing(admin, { unitId: r.id, values: { askingRent }, reason: 'test pricing' });
  return r.id;
}
async function makeCustomer(): Promise<string> {
  const { createCustomerWithDeduplication } = await import('@/services/customer-service');
  return (await createCustomerWithDeduplication(admin, { customerType: 'individual', fullNameEn: `P ${uniq()}` }, { linkOnDuplicate: false })).customerId;
}
function vform(o: Record<string, string>): FormData {
  const fd = new FormData();
  const base: Record<string, string> = { scheduledDate: '2027-05-01', scheduledTime: '14:30', ...o };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  return fd;
}
function pform(o: Record<string, string>): FormData {
  const fd = new FormData();
  const base: Record<string, string> = { leasableArea: '100', annualRent: '100000', contractDurationMonths: '12', ...o };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  return fd;
}

/* --------------------------------- Viewing -------------------------------- */

describe('Viewing 1/8/10. create + org isolation + audit', () => {
  it('creates a viewing, org-scoped, audited', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createViewingAction } = await import('@/app/(app)/leasing/viewings/actions');
    const { viewings, auditLogs } = await import('@/db/schema');
    const customerId = await makeCustomer();
    const unitId = await makeUnit(0);
    const result = await createViewingAction(null, vform({ customerId, propertyId: propertyA, unitId }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [row] = await db.select().from(viewings).where(eq(viewings.id, result.data.id));
    expect(row.organizationId).toBe(admin.organizationId);
    expect(row.status).toBe('scheduled');
    const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, 'viewing'), eq(auditLogs.entityId, result.data.id)));
    expect(audits.some((a) => a.action === 'create')).toBe(true);
    const { getViewingDetail } = await import('@/services/viewing-service');
    expect(await getViewingDetail(OTHER_ORG, result.data.id)).toBeNull();
  });
});

describe('Viewing 2/3/4/6. update, complete+feedback, cancel, invalid transition', () => {
  it('updates, completes with feedback, and blocks re-completion', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createViewingAction, updateViewingAction, completeViewingAction } = await import('@/app/(app)/leasing/viewings/actions');
    const { viewings, viewingFeedback } = await import('@/db/schema');
    const customerId = await makeCustomer();
    const created = await createViewingAction(null, vform({ customerId, propertyId: propertyA }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const upd = await updateViewingAction(created.data.id, null, vform({ customerId, propertyId: propertyA, meetingPoint: 'Lobby' }));
    expect(upd.ok).toBe(true);
    // complete with feedback
    const fb = new FormData();
    fb.set('interestLevel', '4'); fb.set('likelihoodToLease', '5'); fb.set('nextAction', 'Send proposal');
    const done = await completeViewingAction(created.data.id, null, fb);
    expect(done.ok).toBe(true);
    const [row] = await db.select().from(viewings).where(eq(viewings.id, created.data.id));
    expect(row.status).toBe('completed');
    const [feedback] = await db.select().from(viewingFeedback).where(eq(viewingFeedback.viewingId, created.data.id));
    expect(feedback.interestLevel).toBe(4);
    // invalid transition: completing again fails
    const again = await completeViewingAction(created.data.id, null, new FormData());
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.message).toMatch(/cannot be completed/i);
  });
  it('cancels an open viewing', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createViewingAction, cancelViewingAction } = await import('@/app/(app)/leasing/viewings/actions');
    const { viewings } = await import('@/db/schema');
    const created = await createViewingAction(null, vform({ customerId: await makeCustomer(), propertyId: propertyA }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const cancelled = await cancelViewingAction(created.data.id, 'Customer unavailable');
    expect(cancelled.ok).toBe(true);
    const [row] = await db.select().from(viewings).where(eq(viewings.id, created.data.id));
    expect(row.status).toBe('cancelled');
  });
});

describe('Viewing 5/7/9. mismatch, RBAC, UUID', () => {
  it('rejects a unit from a different property', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createViewingAction } = await import('@/app/(app)/leasing/viewings/actions');
    const unitB = await makeUnit(0, propertyB);
    const result = await createViewingAction(null, vform({ customerId: await makeCustomer(), propertyId: propertyA, unitId: unitB }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.unitId?.[0]).toMatch(/does not belong/i);
  });
  it('RBAC: create denied without viewings:create', async () => {
    getSessionMock.mockResolvedValue({ ...admin, permissions: admin.permissions.filter((p) => p !== 'viewings:create') });
    const { createViewingAction } = await import('@/app/(app)/leasing/viewings/actions');
    const result = await createViewingAction(null, vform({ customerId: 'x', propertyId: 'y' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');
  });
  it('UUID: cancel rejects a non-UUID id', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { cancelViewingAction } = await import('@/app/(app)/leasing/viewings/actions');
    const result = await cancelViewingAction('not-a-uuid');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });
});

/* --------------------------------- Proposal ------------------------------- */

describe('Proposal 11/24/25. create + org isolation + audit', () => {
  it('creates a draft proposal, org-scoped, audited', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createProposalAction } = await import('@/app/(app)/leasing/proposals/actions');
    const { proposals, auditLogs } = await import('@/db/schema');
    const customerId = await makeCustomer();
    const unitId = await makeUnit();
    const result = await createProposalAction(null, pform({ customerId, propertyId: propertyA, unitId }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [row] = await db.select().from(proposals).where(eq(proposals.id, result.data.id));
    expect(row.organizationId).toBe(admin.organizationId);
    expect(row.status).toBe('draft');
    expect(row.version).toBe(1);
    const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, 'proposal'), eq(auditLogs.entityId, result.data.id)));
    expect(audits.some((a) => a.action === 'create')).toBe(true);
    const { getProposalDetail } = await import('@/services/proposal-service');
    expect(await getProposalDetail(OTHER_ORG, result.data.id)).toBeNull();
  });
});

describe('Proposal 13/14/23. within-threshold auto-approves, RBAC', () => {
  it('submitting at asking rent auto-approves (no discount)', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createProposalAction, submitProposalAction } = await import('@/app/(app)/leasing/proposals/actions');
    const { proposals } = await import('@/db/schema');
    const unitId = await makeUnit(100000);
    const created = await createProposalAction(null, pform({ customerId: await makeCustomer(), propertyId: propertyA, unitId, annualRent: '100000' }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const submitted = await submitProposalAction(created.data.id);
    expect(submitted.ok).toBe(true);
    if (submitted.ok) expect(submitted.data.requiresApproval).toBe(false);
    const [row] = await db.select().from(proposals).where(eq(proposals.id, created.data.id));
    expect(row.status).toBe('approved');
  });
  it('RBAC: create denied without proposals:create', async () => {
    getSessionMock.mockResolvedValue({ ...admin, permissions: admin.permissions.filter((p) => p !== 'proposals:create') });
    const { createProposalAction } = await import('@/app/(app)/leasing/proposals/actions');
    const result = await createProposalAction(null, pform({ customerId: 'x', propertyId: 'y', unitId: 'z' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');
  });
});

describe('Proposal 15/16/17/26. approval required → pricing_approval → approve (BR-004)', () => {
  it('discounted rent requires approval, creates a pricing_approval, and approve moves proposal to approved', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createProposalAction, submitProposalAction, decideProposalAction } = await import('@/app/(app)/leasing/proposals/actions');
    const { proposals, pricingApprovals } = await import('@/db/schema');
    const unitId = await makeUnit(100000);
    const created = await createProposalAction(null, pform({ customerId: await makeCustomer(), propertyId: propertyA, unitId, annualRent: '92000' })); // 8% discount
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const submitted = await submitProposalAction(created.data.id);
    expect(submitted.ok).toBe(true);
    if (submitted.ok) expect(submitted.data.requiresApproval).toBe(true);
    const [pending] = await db.select().from(proposals).where(eq(proposals.id, created.data.id));
    expect(pending.status).toBe('pending_approval');
    expect(pending.pricingApprovalId).toBeTruthy();
    // BR-004: a pricing_approval row was created and linked.
    const [pa] = await db.select().from(pricingApprovals).where(eq(pricingApprovals.id, pending.pricingApprovalId!));
    expect(pa.proposalId).toBe(created.data.id);
    // approve
    const decided = await decideProposalAction(created.data.id, 'approved', 'ok');
    expect(decided.ok).toBe(true);
    const [approved] = await db.select().from(proposals).where(eq(proposals.id, created.data.id));
    expect(approved.status).toBe('approved');
  });
  it('18/RBAC: approve denied without proposals:approve', async () => {
    getSessionMock.mockResolvedValue({ ...admin, permissions: admin.permissions.filter((p) => p !== 'proposals:approve') });
    const { decideProposalAction } = await import('@/app/(app)/leasing/proposals/actions');
    const result = await decideProposalAction('22222222-2222-4222-8222-222222222222', 'approved');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');
  });
});

describe('Proposal 19/20. reservation blocked before approval, allowed after', () => {
  it('blocks reservation from a draft proposal and allows it once approved', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createProposalAction, submitProposalAction } = await import('@/app/(app)/leasing/proposals/actions');
    const { createReservationAction } = await import('@/app/(app)/leasing/reservations/actions');
    const { reservations } = await import('@/db/schema');
    const customerId = await makeCustomer();
    const unitId = await makeUnit(100000);
    const proposal = await createProposalAction(null, pform({ customerId, propertyId: propertyA, unitId, annualRent: '100000' }));
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;

    const rForm = (extra: Record<string, string> = {}) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries({ customerId, propertyId: propertyA, unitId, proposalId: proposal.data.id, reservationDate: '2027-05-02', expiryDate: '2027-06-02', ...extra })) fd.set(k, v);
      return fd;
    };
    // draft proposal → blocked
    const blocked = await createReservationAction(null, rForm());
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.message).toMatch(/not been approved/i);

    // approve the proposal (asking rent → auto-approve), then reservation allowed
    await submitProposalAction(proposal.data.id);
    const allowed = await createReservationAction(null, rForm());
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) return;
    const [row] = await db.select().from(reservations).where(eq(reservations.id, allowed.data.id));
    expect(row.proposalId).toBe(proposal.data.id);
  });
});

describe('Proposal 12/21. update + versioning', () => {
  it('edits a draft and creates a superseding version', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createProposalAction, updateProposalAction, createProposalVersionAction } = await import('@/app/(app)/leasing/proposals/actions');
    const { proposals } = await import('@/db/schema');
    const customerId = await makeCustomer();
    const unitId = await makeUnit(100000);
    const created = await createProposalAction(null, pform({ customerId, propertyId: propertyA, unitId, annualRent: '100000' }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const edited = await updateProposalAction(created.data.id, null, pform({ customerId, propertyId: propertyA, unitId, annualRent: '110000' }));
    expect(edited.ok).toBe(true);
    // version
    const v2 = await createProposalVersionAction(created.data.id, null, pform({ customerId, propertyId: propertyA, unitId, annualRent: '105000' }));
    expect(v2.ok).toBe(true);
    if (!v2.ok) return;
    const [old] = await db.select().from(proposals).where(eq(proposals.id, created.data.id));
    const [next] = await db.select().from(proposals).where(eq(proposals.id, v2.data.id));
    expect(old.status).toBe('superseded');
    expect(next.version).toBe(2);
    expect(next.supersedesId).toBe(created.data.id);
    expect(next.reference).toBe(old.reference);
  });
});

describe('Proposal 22. UUID guard', () => {
  it('submit rejects a non-UUID proposal id', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { submitProposalAction } = await import('@/app/(app)/leasing/proposals/actions');
    const result = await submitProposalAction('not-a-uuid');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });
});
