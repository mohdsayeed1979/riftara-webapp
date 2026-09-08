import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { bootstrapTestDb } from './setup-db';
import type { Database } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Phase 4A — Lead creation + Reservation foundation. Isolated seeded PGlite
 * database (never production). Covers lead create/edit + customer dedup reuse,
 * reservation create/cancel, BR-002, availability recompute, BR-011 expiry,
 * reservation → contract, RBAC, org isolation and audit.
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
let lostStageKey = '';

const uniq = () => Math.random().toString(36).slice(2, 8);

beforeAll(async () => {
  const ctx = await bootstrapTestDb();
  db = ctx.db;
  cleanup = ctx.cleanup;
  const { users, properties, unitTypes, unitStatuses, leadStages } = await import('@/db/schema');
  const { loadSessionUser, getSession } = await import('@/lib/auth/session');
  getSessionMock = getSession as unknown as ReturnType<typeof vi.fn>;
  const [u] = await db.select().from(users).where(eq(users.email, 'sayeed.almousa@riftara.sa')).limit(1);
  admin = (await loadSessionUser(u.id))!;
  const props = await db.select({ id: properties.id }).from(properties).where(eq(properties.organizationId, admin.organizationId)).limit(2);
  propertyA = props[0].id;
  propertyB = props[1].id;
  unitTypeId = (await db.select({ id: unitTypes.id }).from(unitTypes).where(eq(unitTypes.organizationId, admin.organizationId)).limit(1))[0].id;
  availableStatusId = (await db.select({ id: unitStatuses.id }).from(unitStatuses).where(and(eq(unitStatuses.organizationId, admin.organizationId), eq(unitStatuses.key, 'available'))).limit(1))[0].id;
  const lost = await db.select({ key: leadStages.key }).from(leadStages).where(and(eq(leadStages.organizationId, admin.organizationId), eq(leadStages.stageType, 'lost'))).limit(1);
  lostStageKey = lost[0]?.key ?? '';
}, 180_000);

afterAll(() => cleanup?.());

async function makeUnit(propertyId = propertyA): Promise<string> {
  const { createUnit } = await import('@/services/unit-service');
  const r = await createUnit(admin, { propertyId, code: `U-LR-${uniq()}`, unitNumber: `LR-${Math.floor(Math.random() * 100000)}`, unitTypeId, usageType: 'commercial', statusId: availableStatusId, leasableArea: 100 });
  return r.id;
}
async function makeCustomer(): Promise<string> {
  const { createCustomerWithDeduplication } = await import('@/services/customer-service');
  return (await createCustomerWithDeduplication(admin, { customerType: 'individual', fullNameEn: `Party ${uniq()}` }, { linkOnDuplicate: false })).customerId;
}
async function makeTenant(customerId: string): Promise<string> {
  const { createTenant } = await import('@/services/tenant-service');
  return (await createTenant(admin, { customerId, displayName: `T ${uniq()}`, status: 'active' })).id;
}
function leadForm(o: Record<string, string>): FormData {
  const fd = new FormData();
  const base: Record<string, string> = { customerMode: 'existing', ...o };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  return fd;
}
function resForm(o: Record<string, string>): FormData {
  const fd = new FormData();
  const base: Record<string, string> = { reservationDate: '2027-01-01', expiryDate: '2027-02-01', ...o };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  return fd;
}

/* --------------------------------- Lead ----------------------------------- */

describe('A/E/H. Lead create + org scope + audit', () => {
  it('creates a lead scoped to the org, into an open stage, with an audit entry', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createLeadAction } = await import('@/app/(app)/leasing/leads/actions');
    const { leads, leadStages, auditLogs } = await import('@/db/schema');
    const customerId = await makeCustomer();
    const result = await createLeadAction(null, leadForm({ customerId, priority: 'high', nextAction: 'Call customer' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [row] = await db.select().from(leads).where(eq(leads.id, result.data.id));
    expect(row.organizationId).toBe(admin.organizationId);
    expect(row.customerId).toBe(customerId);
    const [stage] = await db.select({ stageType: leadStages.stageType }).from(leadStages).where(eq(leadStages.id, row.stageId));
    expect(stage.stageType).toBe('open');
    const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, 'lead'), eq(auditLogs.entityId, result.data.id)));
    expect(audits.some((a) => a.action === 'create')).toBe(true);
    // E: other org cannot read it.
    const { getLeadForEdit } = await import('@/services/lead-service');
    expect(await getLeadForEdit('00000000-0000-4000-8000-000000000000', result.data.id)).toBeNull();
  });
});

describe('B/L. Missing/foreign customer rejected', () => {
  it('B: missing customer is rejected', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createLeadAction } = await import('@/app/(app)/leasing/leads/actions');
    const result = await createLeadAction(null, leadForm({}));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.customerId?.[0]).toBeTruthy();
  });
  it('L: a customerId from another org is rejected', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createLeadAction } = await import('@/app/(app)/leasing/leads/actions');
    const result = await createLeadAction(null, leadForm({ customerId: '11111111-1111-4111-8111-111111111111' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.customerId?.[0]).toBeTruthy();
  });
});

describe('C. Inline customer creation reuses dedup', () => {
  it('surfaces a duplicate warning instead of a silent duplicate', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createCustomerWithDeduplication } = await import('@/services/customer-service');
    const { createLeadAction } = await import('@/app/(app)/leasing/leads/actions');
    const mobile = `+96652${Math.floor(1000000 + Math.random() * 8999999)}`;
    await createCustomerWithDeduplication(admin, { customerType: 'individual', fullNameEn: `Dupe ${uniq()}`, mobile }, { linkOnDuplicate: false });
    const result = await createLeadAction(null, leadForm({ customerMode: 'new', fullNameEn: 'New Lead Person', mobile }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect('duplicates' in result && result.duplicates && result.duplicates.length > 0).toBe(true);
  });
});

describe('D. Validation', () => {
  it('rejects an invalid move-in date', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createLeadAction } = await import('@/app/(app)/leasing/leads/actions');
    const customerId = await makeCustomer();
    const result = await createLeadAction(null, leadForm({ customerId, moveInDate: 'not-a-date' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.moveInDate?.[0]).toBeTruthy();
  });
});

describe('F/G. Lead RBAC', () => {
  it('F: create denied without leasing:create', async () => {
    getSessionMock.mockResolvedValue({ ...admin, permissions: admin.permissions.filter((p) => p !== 'leasing:create') });
    const { createLeadAction } = await import('@/app/(app)/leasing/leads/actions');
    const result = await createLeadAction(null, leadForm({ customerId: await makeCustomer() }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');
  });
  it('G: edit denied without leasing:edit', async () => {
    getSessionMock.mockResolvedValue({ ...admin, permissions: admin.permissions.filter((p) => p !== 'leasing:edit') });
    const { updateLeadAction } = await import('@/app/(app)/leasing/leads/actions');
    const result = await updateLeadAction('22222222-2222-4222-8222-222222222222', null, leadForm({}));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');
  });
});

describe('I/K. Lead update + invalid UUID', () => {
  it('I: update works and audits', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createLeadAction, updateLeadAction } = await import('@/app/(app)/leasing/leads/actions');
    const { leads, auditLogs } = await import('@/db/schema');
    const created = await createLeadAction(null, leadForm({ customerId: await makeCustomer() }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const updated = await updateLeadAction(created.data.id, null, leadForm({ nextAction: 'Follow up tomorrow', priority: 'critical' }));
    expect(updated.ok).toBe(true);
    const [row] = await db.select().from(leads).where(eq(leads.id, created.data.id));
    expect(row.nextAction).toBe('Follow up tomorrow');
    const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, 'lead'), eq(auditLogs.entityId, created.data.id)));
    expect(audits.some((a) => a.action === 'update')).toBe(true);
  });
  it('K: update rejects a non-UUID lead id', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { updateLeadAction } = await import('@/app/(app)/leasing/leads/actions');
    const result = await updateLeadAction('not-a-uuid', null, leadForm({}));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });
});

describe('J. BR-006 lost-stage rule remains enforced', () => {
  it('rejects moving a lead to a lost stage without a loss reason', async () => {
    if (!lostStageKey) return;
    const { createLeadAction } = await import('@/app/(app)/leasing/leads/actions');
    const { moveLeadToStage } = await import('@/services/lead-service');
    getSessionMock.mockResolvedValue(admin);
    const created = await createLeadAction(null, leadForm({ customerId: await makeCustomer() }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await expect(moveLeadToStage(admin, { leadId: created.data.id, stageKey: lostStageKey })).rejects.toThrow(/loss reason/i);
  });
});

/* ------------------------------ Reservation ------------------------------- */

describe('M/U/V. Reservation create + availability + audit', () => {
  it('creates an active reservation, reserves the unit, and audits', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createReservationAction } = await import('@/app/(app)/leasing/reservations/actions');
    const { reservations, units, auditLogs } = await import('@/db/schema');
    const customerId = await makeCustomer();
    const unitId = await makeUnit();
    const result = await createReservationAction(null, resForm({ customerId, propertyId: propertyA, unitId }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [row] = await db.select().from(reservations).where(eq(reservations.id, result.data.id));
    expect(row.status).toBe('active');
    expect(row.isActive).toBe(true);
    expect(row.organizationId).toBe(admin.organizationId);
    // U: unit now reserved.
    const [unit] = await db.select({ cls: units.computedAvailabilityClass }).from(units).where(eq(units.id, unitId));
    expect(unit.cls).toBe('reserved');
    // V: audit.
    const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, 'reservation'), eq(auditLogs.entityId, result.data.id)));
    expect(audits.some((a) => a.action === 'create')).toBe(true);
  });
});

describe('N/O. Reservation reference validation', () => {
  it('N: unknown unit rejected', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createReservationAction } = await import('@/app/(app)/leasing/reservations/actions');
    const result = await createReservationAction(null, resForm({ customerId: await makeCustomer(), propertyId: propertyA, unitId: '33333333-3333-4333-8333-333333333333' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.unitId?.[0]).toBeTruthy();
  });
  it('O: unit from a different property rejected', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createReservationAction } = await import('@/app/(app)/leasing/reservations/actions');
    const unitInB = await makeUnit(propertyB);
    const result = await createReservationAction(null, resForm({ customerId: await makeCustomer(), propertyId: propertyA, unitId: unitInB }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.unitId?.[0]).toMatch(/does not belong/i);
  });
});

describe('P. Org isolation', () => {
  it('another org cannot read the reservation', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createReservationAction } = await import('@/app/(app)/leasing/reservations/actions');
    const { getReservationDetail } = await import('@/services/reservation-service');
    const created = await createReservationAction(null, resForm({ customerId: await makeCustomer(), propertyId: propertyA, unitId: await makeUnit() }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(await getReservationDetail('00000000-0000-4000-8000-000000000000', created.data.id)).toBeNull();
  });
});

describe('Q. Reservation RBAC', () => {
  it('create denied without reservations:create', async () => {
    getSessionMock.mockResolvedValue({ ...admin, permissions: admin.permissions.filter((p) => p !== 'reservations:create') });
    const { createReservationAction } = await import('@/app/(app)/leasing/reservations/actions');
    const result = await createReservationAction(null, resForm({ customerId: 'x', propertyId: 'y', unitId: 'z' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');
  });
});

describe('R/S/T/U. BR-002 conflict, friendly error, cancel, release', () => {
  it('blocks a second active reservation, then cancel releases the unit', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createReservationAction, cancelReservationAction } = await import('@/app/(app)/leasing/reservations/actions');
    const { reservations, units } = await import('@/db/schema');
    const unitId = await makeUnit();
    const first = await createReservationAction(null, resForm({ customerId: await makeCustomer(), propertyId: propertyA, unitId }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // R/S: second active reservation on the same unit is a friendly conflict.
    const second = await createReservationAction(null, resForm({ customerId: await makeCustomer(), propertyId: propertyA, unitId }));
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.message).toMatch(/active reservation/i);
      expect(second.error.message).not.toMatch(/duplicate key|constraint|22P02|ERROR:/i);
    }
    // T/U: cancel the first → unit released to available.
    const cancelled = await cancelReservationAction(first.data.id, 'Test cancel');
    expect(cancelled.ok).toBe(true);
    const [row] = await db.select().from(reservations).where(eq(reservations.id, first.data.id));
    expect(row.status).toBe('cancelled');
    expect(row.isActive).toBe(false);
    const [unit] = await db.select({ cls: units.computedAvailabilityClass }).from(units).where(eq(units.id, unitId));
    expect(unit.cls).toBe('available');
  });
});

describe('W. BR-011 expiry interaction', () => {
  it('expireLapsedReservations expires a past reservation and releases the unit', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createReservationAction } = await import('@/app/(app)/leasing/reservations/actions');
    const { expireLapsedReservations } = await import('@/services/availability-service');
    const { reservations } = await import('@/db/schema');
    const unitId = await makeUnit();
    const created = await createReservationAction(null, resForm({ customerId: await makeCustomer(), propertyId: propertyA, unitId, reservationDate: '2020-01-01', expiryDate: '2020-02-01' }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const count = await expireLapsedReservations(admin.organizationId);
    expect(count).toBeGreaterThan(0);
    const [row] = await db.select().from(reservations).where(eq(reservations.id, created.data.id));
    expect(row.status).toBe('expired');
    expect(row.isActive).toBe(false);
  });
});

describe('X/Y. Reservation → Contract + invalid UUID', () => {
  it('X: a contract created from a reservation links back to it', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createReservationAction } = await import('@/app/(app)/leasing/reservations/actions');
    const { createContractAction } = await import('@/app/(app)/contracts/actions');
    const { contracts } = await import('@/db/schema');
    const customerId = await makeCustomer();
    const tenantId = await makeTenant(customerId);
    const unitId = await makeUnit();
    const reservation = await createReservationAction(null, resForm({ customerId, propertyId: propertyA, unitId }));
    expect(reservation.ok).toBe(true);
    if (!reservation.ok) return;

    const cfd = new FormData();
    for (const [k, v] of Object.entries({ tenantId, propertyId: propertyA, unitId, reservationId: reservation.data.id, startDate: '2027-03-01', endDate: '2028-02-29', annualRent: '120000', paymentFrequency: 'quarterly' })) cfd.set(k, v);
    const contract = await createContractAction(null, cfd);
    expect(contract.ok).toBe(true);
    if (!contract.ok) return;
    const [row] = await db.select().from(contracts).where(eq(contracts.id, contract.data.id));
    expect(row.reservationId).toBe(reservation.data.id);
  });
  it('Y: cancel rejects a non-UUID reservation id', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { cancelReservationAction } = await import('@/app/(app)/leasing/reservations/actions');
    const result = await cancelReservationAction('not-a-uuid');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });
});
