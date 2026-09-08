import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '@/config/env';
import { getDb } from '@/db/client';
import { leadSources, leads, properties, units, users } from '@/db/schema';
import { apiCreated, apiError, apiSuccess } from '@/lib/api/response';
import { enforcePublicRateLimit } from '@/lib/api/guard';
import { validationError, forbidden } from '@/lib/errors';
import { isUuid } from '@/lib/utils';
import type { SessionUser } from '@/lib/auth/session';
import { createCustomerWithDeduplication } from '@/services/customer-service';
import { createLead, updateLead } from '@/services/lead-service';

export const dynamic = 'force-dynamic';

const intakeSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  mobile: z.string().trim().max(32).optional(),
  email: z.string().trim().email().max(160).optional(),
  propertyId: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
  message: z.string().trim().max(5000).optional(),
  requiredArea: z.coerce.number().nonnegative().optional(),
  budgetMin: z.coerce.number().nonnegative().optional(),
  budgetMax: z.coerce.number().nonnegative().optional(),
  moveInDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  landingPage: z.string().trim().max(2000).optional(),
  utmSource: z.string().trim().max(120).optional(),
  utmMedium: z.string().trim().max(120).optional(),
  utmCampaign: z.string().trim().max(160).optional(),
  utmContent: z.string().trim().max(160).optional(),
  utmTerm: z.string().trim().max(160).optional(),
}).refine((value) => Boolean(value.propertyId || value.unitId), {
  message: 'A property or unit reference is required.', path: ['propertyId'],
});

function matchesSecret(value: string | null): boolean {
  if (!value || !env.WEBSITE_WEBHOOK_SECRET) return false;
  const actual = Buffer.from(value);
  const expected = Buffer.from(env.WEBSITE_WEBHOOK_SECRET);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** POST /api/v1/website/leads — authenticated public website intake (BR-008). */
export async function POST(request: NextRequest) {
  try {
    if (!matchesSecret(request.headers.get('x-riftara-webhook-secret'))) throw forbidden('Invalid website integration credentials.');
    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (contentLength > 16_384) throw validationError('Request body is too large.');
    const text = await request.text();
    if (text.length > 16_384) throw validationError('Request body is too large.');
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw validationError('Request body must be valid JSON.'); }
    const parsed = intakeSchema.safeParse(body);
    if (!parsed.success) throw validationError('Please provide valid inquiry details.');
    const input = parsed.data;

    const db = await getDb();
    const propertyId = input.propertyId;
    const unitId = input.unitId;
    if ((propertyId && !isUuid(propertyId)) || (unitId && !isUuid(unitId))) throw validationError('Invalid property or unit reference.');
    const [unit] = unitId ? await db.select({ id: units.id, propertyId: units.propertyId, organizationId: units.organizationId })
      .from(units).where(and(eq(units.id, unitId), isNull(units.deletedAt))).limit(1) : [undefined];
    const resolvedPropertyId = propertyId ?? unit?.propertyId;
    const [property] = resolvedPropertyId ? await db.select({ id: properties.id, organizationId: properties.organizationId })
      .from(properties).where(and(eq(properties.id, resolvedPropertyId), isNull(properties.deletedAt))).limit(1) : [undefined];
    if (!property || (unit && unit.organizationId !== property.organizationId) || (unit && propertyId && unit.propertyId !== propertyId)) {
      throw validationError('The requested property or unit is not available.');
    }
    await enforcePublicRateLimit(`website:${property.organizationId}`);

    const [actorRow, source] = await Promise.all([
      db.select({ id: users.id }).from(users).where(and(eq(users.organizationId, property.organizationId), eq(users.isActive, true), isNull(users.deletedAt))).limit(1),
      db.select({ id: leadSources.id }).from(leadSources).where(and(eq(leadSources.organizationId, property.organizationId), eq(leadSources.key, 'corporate_website'), eq(leadSources.isActive, true))).limit(1),
    ]);
    if (!actorRow[0] || !source[0]) throw validationError('Website lead intake is not configured for this property.');
    const actor = { id: actorRow[0].id, organizationId: property.organizationId, fullName: 'Website integration' } as SessionUser;
    const customer = await createCustomerWithDeduplication(actor, {
      customerType: 'individual', fullNameEn: input.fullName, mobile: input.mobile ?? null, email: input.email ?? null,
      communicationConsent: true,
    });
    const leadInput = {
      customerId: customer.customerId, sourceId: source[0].id, requestedPropertyId: property.id,
      requestedUnitId: unit?.id ?? null, requiredArea: input.requiredArea ?? null, budgetMin: input.budgetMin ?? null,
      budgetMax: input.budgetMax ?? null, moveInDate: input.moveInDate ?? null, notes: input.message ?? null,
      landingPage: input.landingPage ?? null, utmSource: input.utmSource ?? null, utmMedium: input.utmMedium ?? null,
      utmCampaign: input.utmCampaign ?? null, utmContent: input.utmContent ?? null, utmTerm: input.utmTerm ?? null,
    };
    // A repeat website form for the same active inquiry refreshes the existing
    // lead instead of generating CRM noise (BR-008). Terminal leads are never
    // reopened here; staff must use the authoritative stage workflow.
    const [existing] = await db.select({ id: leads.id }).from(leads).where(and(
      eq(leads.organizationId, property.organizationId), eq(leads.customerId, customer.customerId),
      eq(leads.requestedPropertyId, property.id), isNull(leads.closedAt), isNull(leads.deletedAt),
    )).limit(1);
    if (existing) {
      await updateLead(actor, existing.id, leadInput);
      return apiSuccess({ id: existing.id, customerReused: !customer.created, updated: true });
    }
    const lead = await createLead(actor, leadInput);
    return apiCreated({ id: lead.id, customerReused: !customer.created });
  } catch (error) {
    return apiError(error);
  }
}
