import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { bootstrapTestDb } from './setup-db';
import type { Database } from '@/db/types';

const WEBHOOK_SECRET = 'test-website-webhook-secret-value';

// The public rate limiter reads request headers; outside a Next request scope
// we supply a minimal stand-in so the route can run under the test bootstrap.
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.10' }),
}));

// env is parsed once at import from process.env, which never carries the
// webhook secret in tests. Inject it so the route's credential check has a
// value to compare against (the real secret is never committed).
vi.mock('@/config/env', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/config/env')>();
  return { ...mod, env: { ...mod.env, WEBSITE_WEBHOOK_SECRET: WEBHOOK_SECRET } };
});

let db: Database;
let cleanup: () => void;
let orgId = '';
let propertyId = '';
let otherPropertyId = '';
let unitId = '';

function post(body: unknown, opts: { secret?: string | null; contentLength?: string; raw?: string } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' });
  const secret = opts.secret === undefined ? WEBHOOK_SECRET : opts.secret;
  if (secret !== null) headers.set('x-riftara-webhook-secret', secret);
  if (opts.contentLength) headers.set('content-length', opts.contentLength);
  const payload = opts.raw !== undefined ? opts.raw : JSON.stringify(body);
  return new Request('http://localhost/api/v1/website/leads', { method: 'POST', headers, body: payload });
}

async function callRoute(request: Request) {
  const { POST } = await import('@/app/api/v1/website/leads/route');
  const response = await POST(request as never);
  const json = await response.json();
  return { status: response.status, json };
}

beforeAll(async () => {
  const ctx = await bootstrapTestDb();
  db = ctx.db;
  cleanup = ctx.cleanup;

  const { properties, units } = await import('@/db/schema');
  const rows = await db
    .select({ id: properties.id, organizationId: properties.organizationId })
    .from(properties)
    .where(isNull(properties.deletedAt))
    .limit(2);
  propertyId = rows[0].id;
  orgId = rows[0].organizationId;
  otherPropertyId = rows[1].id;
  const [unit] = await db
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.propertyId, propertyId), isNull(units.deletedAt)))
    .limit(1);
  unitId = unit.id;
}, 120_000);

afterAll(() => cleanup?.());

describe('A. Structure — public intake reuses shared CRM services', () => {
  it('exposes the endpoint and never trusts a client organization id', async () => {
    const route = join(process.cwd(), 'src', 'app', 'api', 'v1', 'website', 'leads', 'route.ts');
    expect(existsSync(route)).toBe(true);
    const source = await readFile(route, 'utf8');
    expect(source).toContain('createCustomerWithDeduplication');
    expect(source).toContain('createLead');
    expect(source).toContain('enforcePublicRateLimit');
    expect(source).not.toContain('organizationId: input.organizationId');
  });
});

describe('B. Authentication', () => {
  it('rejects a missing webhook secret with 403 and no leak', async () => {
    const { status, json } = await callRoute(post({ fullName: 'No Secret', propertyId }, { secret: null }));
    expect(status).toBe(403);
    expect(json.error.code).toBe('FORBIDDEN');
    expect(json.data).toBeUndefined();
  });

  it('rejects an invalid webhook secret with 403', async () => {
    const { status, json } = await callRoute(post({ fullName: 'Wrong Secret', propertyId }, { secret: 'nope' }));
    expect(status).toBe(403);
    expect(json.error.code).toBe('FORBIDDEN');
  });
});

describe('C. Payload validation', () => {
  it('rejects malformed JSON with a safe validation error', async () => {
    const { status, json } = await callRoute(post(null, { raw: '{ not json' }));
    expect(status).toBe(422);
    expect(json.error.code).toBe('VALIDATION');
  });

  it('rejects an oversized body by content-length', async () => {
    const { status, json } = await callRoute(post({ fullName: 'Big', propertyId }, { contentLength: '20000' }));
    expect(status).toBe(422);
    expect(json.error.code).toBe('VALIDATION');
  });

  it('requires a property or unit reference', async () => {
    const { status, json } = await callRoute(post({ fullName: 'No Reference' }));
    expect(status).toBe(422);
    expect(json.error.code).toBe('VALIDATION');
  });

  it('rejects an unknown property without exposing internals', async () => {
    const { status, json } = await callRoute(post({ fullName: 'Ghost', propertyId: '00000000-0000-4000-8000-000000000000' }));
    expect(status).toBe(422);
    expect(json.error.code).toBe('VALIDATION');
    expect(JSON.stringify(json)).not.toMatch(/select|drizzle|\bat \/|\.ts:/i);
  });

  it('rejects a unit that does not belong to the supplied property', async () => {
    const { status } = await callRoute(post({ fullName: 'Mismatch', propertyId: otherPropertyId, unitId }));
    expect(status).toBe(422);
  });
});

describe('D. Successful intake', () => {
  it('creates a customer and CRM lead with UTM/source attribution and an audit entry', async () => {
    const { auditLogs, leads, leadSources } = await import('@/db/schema');
    const { status, json } = await callRoute(
      post({
        fullName: 'Website Applicant',
        email: 'applicant.web@example.com',
        mobile: '0555000111',
        unitId,
        message: 'Interested in leasing.',
        landingPage: '/properties/riyadh-office',
        utmSource: 'google',
        utmMedium: 'cpc',
        utmCampaign: 'q4-offices',
      }),
    );
    expect(status).toBe(201);
    expect(json.data.id).toBeTruthy();
    expect(json.data.customerReused).toBe(false);

    const [lead] = await db
      .select({
        organizationId: leads.organizationId,
        sourceId: leads.sourceId,
        landingPage: leads.landingPage,
        utmSource: leads.utmSource,
        requestedUnitId: leads.requestedUnitId,
      })
      .from(leads)
      .where(eq(leads.id, json.data.id));
    expect(lead.organizationId).toBe(orgId);
    expect(lead.landingPage).toBe('/properties/riyadh-office');
    expect(lead.utmSource).toBe('google');
    expect(lead.requestedUnitId).toBe(unitId);

    const [source] = await db
      .select({ key: leadSources.key })
      .from(leadSources)
      .where(eq(leadSources.id, lead.sourceId!));
    expect(source.key).toBe('corporate_website');

    const audit = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, 'lead'), eq(auditLogs.entityId, json.data.id)));
    expect(audit.some((row) => row.action === 'create')).toBe(true);
  });

  it('reuses the existing customer and refreshes the open lead on a repeat submission (BR-008)', async () => {
    const first = await callRoute(post({ fullName: 'Repeat Buyer', email: 'repeat.web@example.com', propertyId }));
    expect(first.status).toBe(201);
    const second = await callRoute(post({ fullName: 'Repeat Buyer', email: 'repeat.web@example.com', propertyId, message: 'Following up.' }));
    expect(second.status).toBe(200);
    expect(second.json.data.updated).toBe(true);
    expect(second.json.data.customerReused).toBe(true);
    expect(second.json.data.id).toBe(first.json.data.id);
  });
});

describe('E. Rate limiting', () => {
  it('throws once the per-identity window is exceeded', async () => {
    const { enforcePublicRateLimit } = await import('@/lib/api/guard');
    const identity = `website:test-${Date.now()}`;
    for (let i = 0; i < 5; i += 1) await enforcePublicRateLimit(identity, 5);
    await expect(enforcePublicRateLimit(identity, 5)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});
