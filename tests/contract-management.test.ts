import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { bootstrapTestDb } from './setup-db';
import type { Database } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Phase 3 — Contract creation & leasing completion. Isolated seeded PGlite
 * database (never production). Wires the existing contract-service into the UI
 * action layer and verifies create/edit/sign, scoping, BR-003 overlap, audit
 * and the payment-schedule/invoice generation on signing.
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
  propertyA = props[0].id;
  propertyB = props[1].id;
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

async function makeUnit(propertyId = propertyA): Promise<string> {
  const { createUnit } = await import('@/services/unit-service');
  const r = await createUnit(admin, {
    propertyId,
    code: `U-CT-${uniq()}`,
    unitNumber: `CT-${Math.floor(Math.random() * 100000)}`,
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

function contractForm(o: Record<string, string>): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    startDate: '2027-01-01',
    endDate: '2027-12-31',
    annualRent: '120000',
    paymentFrequency: 'quarterly',
    ...o,
  };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  return fd;
}

describe('A. /contracts/new route exists', () => {
  it('has a real page module', () => {
    expect(existsSync(join(process.cwd(), 'src', 'app', '(app)', 'contracts', 'new', 'page.tsx'))).toBe(true);
  });
});

describe('B/L/T/U. Create draft + audit + relationships', () => {
  it('creates a draft contract with an audit entry', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createContractAction } = await import('@/app/(app)/contracts/actions');
    const { contracts, auditLogs } = await import('@/db/schema');
    const tenantId = await makeTenant();
    const unitId = await makeUnit();
    const result = await createContractAction(null, contractForm({ tenantId, propertyId: propertyA, unitId }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [row] = await db.select().from(contracts).where(eq(contracts.id, result.data.id));
    expect(row.status).toBe('draft');
    expect(row.isActive).toBe(false);
    expect(row.organizationId).toBe(admin.organizationId);
    expect(row.tenantId).toBe(tenantId); // T
    expect(row.unitId).toBe(unitId); // U
    const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, 'contract'), eq(auditLogs.entityId, result.data.id)));
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits.some((a) => a.action === 'create')).toBe(true);
  });
});

describe('C/D/E/F. Reference scoping & hierarchy', () => {
  it('C: unknown tenant rejected', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createContractAction } = await import('@/app/(app)/contracts/actions');
    const unitId = await makeUnit();
    const r = await createContractAction(null, contractForm({ tenantId: '11111111-1111-4111-8111-111111111111', propertyId: propertyA, unitId }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors?.tenantId?.[0]).toBeTruthy();
  });
  it('D: unknown property rejected', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createContractAction } = await import('@/app/(app)/contracts/actions');
    const tenantId = await makeTenant();
    const unitId = await makeUnit();
    const r = await createContractAction(null, contractForm({ tenantId, propertyId: '22222222-2222-4222-8222-222222222222', unitId }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors?.propertyId?.[0]).toBeTruthy();
  });
  it('E: unknown unit rejected', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createContractAction } = await import('@/app/(app)/contracts/actions');
    const tenantId = await makeTenant();
    const r = await createContractAction(null, contractForm({ tenantId, propertyId: propertyA, unitId: '33333333-3333-4333-8333-333333333333' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors?.unitId?.[0]).toBeTruthy();
  });
  it('F: unit from a different property rejected', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createContractAction } = await import('@/app/(app)/contracts/actions');
    const tenantId = await makeTenant();
    const unitInB = await makeUnit(propertyB);
    const r = await createContractAction(null, contractForm({ tenantId, propertyId: propertyA, unitId: unitInB }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors?.unitId?.[0]).toMatch(/does not belong/i);
  });
});

describe('G/H/I. Validation', () => {
  it('G: update rejects a non-UUID contract id', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { updateContractAction } = await import('@/app/(app)/contracts/actions');
    const r = await updateContractAction('not-a-uuid', null, contractForm({ tenantId: '', propertyId: '', unitId: '' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  });
  it('H: end date must be after start date', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createContractAction } = await import('@/app/(app)/contracts/actions');
    const tenantId = await makeTenant();
    const unitId = await makeUnit();
    const r = await createContractAction(null, contractForm({ tenantId, propertyId: propertyA, unitId, startDate: '2027-12-31', endDate: '2027-01-01' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors?.endDate?.[0]).toBeTruthy();
  });
  it('I: missing required unit rejected', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createContractAction } = await import('@/app/(app)/contracts/actions');
    const tenantId = await makeTenant();
    const fd = contractForm({ tenantId, propertyId: propertyA });
    fd.delete('unitId');
    const r = await createContractAction(null, fd);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors?.unitId?.[0]).toBeTruthy();
  });
});

describe('K. RBAC', () => {
  it('create denied without contracts:create', async () => {
    const viewer: SessionUser = { ...admin, permissions: admin.permissions.filter((p) => p !== 'contracts:create') };
    getSessionMock.mockResolvedValue(viewer);
    const { createContractAction } = await import('@/app/(app)/contracts/actions');
    const r = await createContractAction(null, contractForm({ tenantId: 'x', propertyId: 'y', unitId: 'z' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN');
  });
});

describe('M. Draft can be edited', () => {
  it('updates a draft contract', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createContractAction, updateContractAction } = await import('@/app/(app)/contracts/actions');
    const { contracts } = await import('@/db/schema');
    const tenantId = await makeTenant();
    const unitId = await makeUnit();
    const created = await createContractAction(null, contractForm({ tenantId, propertyId: propertyA, unitId }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const updated = await updateContractAction(created.data.id, null, contractForm({ tenantId, propertyId: propertyA, unitId, annualRent: '150000' }));
    expect(updated.ok).toBe(true);
    const [row] = await db.select().from(contracts).where(eq(contracts.id, created.data.id));
    expect(Number(row.annualRent)).toBe(150000);
  });
});

describe('O/P/Q/R/S. Signing generates schedule + invoices, leases the unit', () => {
  it('signs a draft and produces schedule/invoices/collections', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createContractAction } = await import('@/app/(app)/contracts/actions');
    const { signContract } = await import('@/services/contract-service');
    const { paymentSchedules, invoices, units, unitStatuses } = await import('@/db/schema');
    const tenantId = await makeTenant();
    const unitId = await makeUnit();
    // Past start so some invoice dates have passed → invoices generated (R).
    const created = await createContractAction(null, contractForm({ tenantId, propertyId: propertyA, unitId, startDate: '2024-01-01', endDate: '2027-12-31' }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const signResult = await signContract(admin, created.data.id); // O
    expect(signResult.scheduleCount).toBeGreaterThan(0); // Q
    expect(signResult.invoiceCount).toBeGreaterThan(0); // R

    const schedule = await db.select().from(paymentSchedules).where(eq(paymentSchedules.contractId, created.data.id));
    expect(schedule.length).toBe(signResult.scheduleCount);
    const inv = await db.select().from(invoices).where(eq(invoices.contractId, created.data.id));
    expect(inv.length).toBe(signResult.invoiceCount);

    // P: unit is Leased.
    const [unitRow] = await db
      .select({ statusKey: unitStatuses.key })
      .from(units)
      .innerJoin(unitStatuses, eq(unitStatuses.id, units.statusId))
      .where(eq(units.id, unitId));
    expect(unitRow.statusKey).toBe('leased');

    // S: invoices visible to the collection module.
    const { listInvoices } = await import('@/services/collection-service');
    const collected = await listInvoices({ organizationId: admin.organizationId, page: 1, pageSize: 200 });
    expect(collected.items.some((i) => inv.some((x) => x.id === i.id))).toBe(true);
  });
});

describe('J/W. BR-003 overlap protection with friendly message', () => {
  it('rejects an overlapping contract on the same unit and hides raw DB text', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createContractAction } = await import('@/app/(app)/contracts/actions');
    const { signContract } = await import('@/services/contract-service');
    const tenantId = await makeTenant();
    const unitId = await makeUnit();
    const first = await createContractAction(null, contractForm({ tenantId, propertyId: propertyA, unitId, startDate: '2027-01-01', endDate: '2027-12-31' }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await signContract(admin, first.data.id); // make it active

    const tenant2 = await makeTenant();
    const overlap = await createContractAction(null, contractForm({ tenantId: tenant2, propertyId: propertyA, unitId, startDate: '2027-06-01', endDate: '2028-05-31' }));
    expect(overlap.ok).toBe(false);
    if (overlap.ok) return;
    expect(overlap.error.message).toMatch(/overlapping/i); // friendly
    expect(overlap.error.message).not.toMatch(/duplicate key|constraint|ERROR:|22P02/i); // W: no raw DB text
  });
});

describe('N. Signed contract is locked from editing', () => {
  it('rejects editing a signed contract', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createContractAction, updateContractAction } = await import('@/app/(app)/contracts/actions');
    const { signContract } = await import('@/services/contract-service');
    const tenantId = await makeTenant();
    const unitId = await makeUnit();
    const created = await createContractAction(null, contractForm({ tenantId, propertyId: propertyA, unitId }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await signContract(admin, created.data.id);
    const edit = await updateContractAction(created.data.id, null, contractForm({ tenantId, propertyId: propertyA, unitId, annualRent: '99999' }));
    expect(edit.ok).toBe(false);
    if (!edit.ok) expect(edit.error.message).toMatch(/only draft contracts can be edited/i);
  });
});

describe('V. Organization isolation', () => {
  it('another org cannot read the contract', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createContractAction } = await import('@/app/(app)/contracts/actions');
    const { getContractDetail } = await import('@/services/contract-service');
    const tenantId = await makeTenant();
    const unitId = await makeUnit();
    const created = await createContractAction(null, contractForm({ tenantId, propertyId: propertyA, unitId }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const other = await getContractDetail('00000000-0000-4000-8000-000000000000', created.data.id);
    expect(other).toBeNull();
  });
});
