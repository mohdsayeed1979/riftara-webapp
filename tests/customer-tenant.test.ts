import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { bootstrapTestDb } from './setup-db';
import type { Database } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Phase 2 — Customer & Tenant management tests. Isolated seeded PGlite database
 * (never production). Covers create/update, org scoping, validation, BR-007
 * duplicate detection, RBAC, audit and the Customer↔Tenant relationship.
 */

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth/session')>();
  return { ...mod, getSession: vi.fn() };
});

let db: Database;
let cleanup: () => void;
let admin: SessionUser;
let getSessionMock: ReturnType<typeof vi.fn>;

const uniq = () => Math.random().toString(36).slice(2, 8);

beforeAll(async () => {
  const ctx = await bootstrapTestDb();
  db = ctx.db;
  cleanup = ctx.cleanup;
  const { users } = await import('@/db/schema');
  const { loadSessionUser, getSession } = await import('@/lib/auth/session');
  getSessionMock = getSession as unknown as ReturnType<typeof vi.fn>;
  const [u] = await db.select().from(users).where(eq(users.email, 'sayeed.almousa@riftara.sa')).limit(1);
  const loaded = await loadSessionUser(u.id);
  if (!loaded) throw new Error('admin actor not found');
  admin = loaded;
}, 180_000);

afterAll(() => cleanup?.());

function customerForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    customerType: 'individual',
    fullNameEn: `Test Customer ${uniq()}`,
    communicationConsent: 'on',
    ...overrides,
  };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  return fd;
}
function tenantForm(customerId: string, overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = { customerId, displayName: `Tenant ${uniq()}`, status: 'active', ...overrides };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  return fd;
}

/* --------------------------------- Customer ------------------------------- */

describe('A/B/J. Customer create + org scoping + audit', () => {
  it('creates a customer scoped to the org with an audit entry', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createCustomerAction } = await import('@/app/(app)/leasing/customers/actions');
    const { customers, auditLogs } = await import('@/db/schema');
    const result = await createCustomerAction(null, customerForm({ mobile: `+96650${Math.floor(1000000 + Math.random() * 8999999)}` }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [row] = await db.select().from(customers).where(eq(customers.id, result.data.id));
    expect(row.organizationId).toBe(admin.organizationId);
    const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, 'customer'), eq(auditLogs.entityId, result.data.id)));
    expect(audits.length).toBe(1);
    expect(audits[0].action).toBe('create');
  });
});

describe('C/D. Customer validation', () => {
  it('C: rejects a missing name', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createCustomerAction } = await import('@/app/(app)/leasing/customers/actions');
    const fd = customerForm();
    fd.delete('fullNameEn');
    const result = await createCustomerAction(null, fd);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors?.fullNameEn?.[0]).toBeTruthy();
  });
  it('D: rejects an invalid customer type', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createCustomerAction } = await import('@/app/(app)/leasing/customers/actions');
    const result = await createCustomerAction(null, customerForm({ customerType: 'alien' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors?.customerType?.[0]).toBeTruthy();
  });
});

describe('E/F/G/H. Duplicate detection (BR-007)', () => {
  it('E: duplicate mobile is surfaced as a warning', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createCustomerAction } = await import('@/app/(app)/leasing/customers/actions');
    const mobile = `+96651${Math.floor(1000000 + Math.random() * 8999999)}`;
    expect((await createCustomerAction(null, customerForm({ mobile }))).ok).toBe(true);
    const result = await createCustomerAction(null, customerForm({ mobile }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect('duplicates' in result && result.duplicates && result.duplicates.length > 0).toBe(true);
    if ('duplicates' in result) expect(result.duplicates?.[0].matchedOn).toBe('mobile');
  });
  it('F: duplicate email is surfaced as a warning', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createCustomerAction } = await import('@/app/(app)/leasing/customers/actions');
    const email = `dup${uniq()}@example.com`;
    expect((await createCustomerAction(null, customerForm({ email }))).ok).toBe(true);
    const result = await createCustomerAction(null, customerForm({ email }));
    expect(result.ok).toBe(false);
    if (!result.ok && 'duplicates' in result) expect(result.duplicates?.[0].matchedOn).toBe('email');
  });
  it('G: duplicate National ID is surfaced', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createCustomerAction } = await import('@/app/(app)/leasing/customers/actions');
    const nid = `1${Math.floor(100000000 + Math.random() * 899999999)}`;
    expect((await createCustomerAction(null, customerForm({ nationalId: nid }))).ok).toBe(true);
    const result = await createCustomerAction(null, customerForm({ nationalId: nid }));
    expect(result.ok).toBe(false);
    if (!result.ok && 'duplicates' in result) expect(result.duplicates?.[0].matchedOn).toBe('national_id');
  });
  it('H: duplicate CR is surfaced for corporate', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createCustomerAction } = await import('@/app/(app)/leasing/customers/actions');
    const cr = `70${Math.floor(10000000 + Math.random() * 89999999)}`;
    const corp = () => customerForm({ customerType: 'corporate', companyName: `Co ${uniq()}`, commercialRegistration: cr });
    expect((await createCustomerAction(null, corp())).ok).toBe(true);
    const result = await createCustomerAction(null, corp());
    expect(result.ok).toBe(false);
    if (!result.ok && 'duplicates' in result) expect(result.duplicates?.[0].matchedOn).toBe('commercial_registration');
  });
});

describe('I. RBAC — customer create denied', () => {
  it('returns FORBIDDEN without customers:create', async () => {
    const viewer: SessionUser = { ...admin, permissions: admin.permissions.filter((p) => p !== 'customers:create') };
    getSessionMock.mockResolvedValue(viewer);
    const { createCustomerAction } = await import('@/app/(app)/leasing/customers/actions');
    const result = await createCustomerAction(null, customerForm());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('FORBIDDEN');
  });
});

/* ---------------------------------- Tenant -------------------------------- */

async function makeCustomer(): Promise<string> {
  const { createCustomerWithDeduplication } = await import('@/services/customer-service');
  const r = await createCustomerWithDeduplication(admin, { customerType: 'individual', fullNameEn: `Party ${uniq()}` }, { linkOnDuplicate: false });
  return r.customerId;
}

describe('K/L/S/U/V/W. Tenant create from customer + scoping + audit + relationship', () => {
  it('creates a tenant from an existing customer', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createTenantAction } = await import('@/app/(app)/tenants/actions');
    const { tenants, auditLogs } = await import('@/db/schema');
    const customerId = await makeCustomer();

    const result = await createTenantAction(null, tenantForm(customerId, { displayName: 'Acme Tenant' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [row] = await db.select().from(tenants).where(eq(tenants.id, result.data.id));
    expect(row.organizationId).toBe(admin.organizationId); // L: org scoping
    expect(row.customerId).toBe(customerId); // V/W: tenant → customer (unit is via contracts, not tenant)
    expect('unitId' in row).toBe(false); // W: tenant has no direct unit column

    // U: customer → tenant
    const { getCustomer360 } = await import('@/services/customer-service');
    const c360 = await getCustomer360(admin.organizationId, customerId);
    expect(c360.tenantId).toBe(result.data.id);

    // S: audit
    const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, 'tenant'), eq(auditLogs.entityId, result.data.id)));
    expect(audits.length).toBe(1);
  });
});

describe('M/N/O/P. Tenant reference validation & scoping', () => {
  it('M: rejects an unknown customer', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createTenantAction } = await import('@/app/(app)/tenants/actions');
    const result = await createTenantAction(null, tenantForm('11111111-1111-4111-8111-111111111111'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors?.customerId?.[0]).toBeTruthy();
  });
  it('N: a tenant needs no property (unit occupancy is contract-level)', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createTenantAction } = await import('@/app/(app)/tenants/actions');
    const customerId = await makeCustomer();
    // No property/unit fields are provided or required.
    const result = await createTenantAction(null, tenantForm(customerId));
    expect(result.ok).toBe(true);
  });
  it('O: cannot create a tenant for a customer from another organization', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createTenant } = await import('@/services/tenant-service');
    // A random (cross-org) customer id is not visible → notFound.
    await expect(
      createTenant(admin, { customerId: '22222222-2222-4222-8222-222222222222', displayName: 'X', status: 'active' }),
    ).rejects.toThrow();
  });
  it('P: update rejects a non-UUID tenant id', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { updateTenantAction } = await import('@/app/(app)/tenants/actions');
    const customerId = await makeCustomer();
    const result = await updateTenantAction('not-a-uuid', null, tenantForm(customerId));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });
});

describe('Q. Duplicate tenant relationship handled', () => {
  it('blocks a second tenant account for the same customer', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createTenantAction } = await import('@/app/(app)/tenants/actions');
    const customerId = await makeCustomer();
    expect((await createTenantAction(null, tenantForm(customerId))).ok).toBe(true);
    const second = await createTenantAction(null, tenantForm(customerId));
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe('CONFLICT');
    expect(second.error.message).not.toMatch(/duplicate key|constraint/i);
  });
});

describe('R. RBAC — tenant create denied', () => {
  it('returns FORBIDDEN without tenants:create', async () => {
    const viewer: SessionUser = { ...admin, permissions: admin.permissions.filter((p) => p !== 'tenants:create') };
    getSessionMock.mockResolvedValue(viewer);
    const { createTenantAction } = await import('@/app/(app)/tenants/actions');
    const customerId = await makeCustomer();
    const result = await createTenantAction(null, tenantForm(customerId));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('FORBIDDEN');
  });
});

describe('T. Tenant update works', () => {
  it('updates status and display name', async () => {
    getSessionMock.mockResolvedValue(admin);
    const { createTenantAction, updateTenantAction } = await import('@/app/(app)/tenants/actions');
    const { tenants } = await import('@/db/schema');
    const customerId = await makeCustomer();
    const created = await createTenantAction(null, tenantForm(customerId, { displayName: 'Before', status: 'prospective' }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const updated = await updateTenantAction(created.data.id, null, tenantForm(customerId, { displayName: 'After', status: 'active' }));
    expect(updated.ok).toBe(true);
    const [row] = await db.select().from(tenants).where(eq(tenants.id, created.data.id));
    expect(row.displayName).toBe('After');
    expect(row.status).toBe('active');
  });
});

describe('X. Organization isolation', () => {
  it('another org sees no customers and cannot open one', async () => {
    const { listCustomers, getCustomer360 } = await import('@/services/customer-service');
    const other = await listCustomers({ organizationId: '00000000-0000-4000-8000-000000000000', page: 1, pageSize: 5 });
    expect(other.total).toBe(0);
    const customerId = await makeCustomer();
    await expect(getCustomer360('00000000-0000-4000-8000-000000000000', customerId)).rejects.toThrow();
  });
});
