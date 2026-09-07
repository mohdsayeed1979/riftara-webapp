import 'server-only';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { settings } from '@/db/schema';
import type { DbExecutor } from '@/db/types';
import { DEFAULT_SETTINGS } from '@/config/settings-defaults';

/**
 * Runtime settings access. Business thresholds are read from the database so
 * an administrator can change them without a deployment (BRD 3.5).
 *
 * Values are cached per organization for the lifetime of a request batch; the
 * cache is invalidated whenever a setting is written.
 */

const DEFAULT_BY_KEY = new Map(DEFAULT_SETTINGS.map((s) => [s.key, s.value]));

const cache = new Map<string, { values: Map<string, unknown>; expiresAt: number }>();
const CACHE_TTL_MS = 30_000;

export async function loadSettings(organizationId: string): Promise<Map<string, unknown>> {
  const cached = cache.get(organizationId);
  if (cached && cached.expiresAt > Date.now()) return cached.values;

  const db = await getDb();
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(eq(settings.organizationId, organizationId));

  const values = new Map<string, unknown>(DEFAULT_BY_KEY);
  for (const row of rows) values.set(row.key, row.value);

  cache.set(organizationId, { values, expiresAt: Date.now() + CACHE_TTL_MS });
  return values;
}

export function invalidateSettingsCache(organizationId?: string): void {
  if (organizationId) cache.delete(organizationId);
  else cache.clear();
}

export async function getSetting<T>(organizationId: string, key: string, fallback: T): Promise<T> {
  const values = await loadSettings(organizationId);
  const value = values.get(key);
  return (value === undefined ? fallback : value) as T;
}

export async function setSetting(
  executor: DbExecutor,
  organizationId: string,
  key: string,
  value: unknown,
  userId: string | null,
): Promise<void> {
  await executor
    .update(settings)
    .set({ value, updatedByUserId: userId, updatedAt: new Date() })
    .where(and(eq(settings.organizationId, organizationId), eq(settings.key, key)));
  invalidateSettingsCache(organizationId);
}

/* -------------------------------------------------------------------------- */
/* Typed accessors for the settings services depend on                         */
/* -------------------------------------------------------------------------- */

export interface ApprovalTierSetting {
  maxDiscountPercent: number;
  roleKey: string;
  label: string;
}

export interface AgingBucketSetting {
  key: string;
  label: string;
  minDays: number;
  maxDays: number;
}

export interface EscalationStepSetting {
  daysOverdue: number;
  action: string;
}

export interface SlaByPrioritySetting {
  [priority: string]: { responseHours: number; resolutionHours: number };
}

export interface OrganizationPolicy {
  approvalTiers: ApprovalTierSetting[];
  minimumRentFloorPercent: number;
  reservationValidityDays: number;
  releaseUnitOnReservationExpiry: boolean;
  defaultReservationFee: number;
  leadFirstResponseSlaMinutes: number;
  leadEscalationMinutes: number;
  leadDistributionStrategy: string;
  requireNextAction: boolean;
  renewalNoticeDays: number[];
  defaultRenewalEscalationPercent: number;
  agingBuckets: AgingBucketSetting[];
  collectionEscalationLadder: EscalationStepSetting[];
  autoAllocatePayments: boolean;
  maintenanceSlaByPriority: SlaByPrioritySetting;
  maintenanceSpendApprovalThreshold: number;
  turnaroundDays: number;
  availableSoonWindowDays: number;
  autoPublishOnAvailable: boolean;
  publishExactUnitNumber: boolean;
  longVacancyDays: number;
  collectionRateFloor: number;
  maintenanceBudgetVariance: number;
  contractExpiryWindowDays: number;
  tenantConcentrationPercent: number;
  vatRatePercent: number;
  defaultPaymentFrequency: string;
  invoiceLeadDays: number;
  currency: string;
}

/** Loads the full policy set in one round trip. */
export async function getPolicy(organizationId: string): Promise<OrganizationPolicy> {
  const values = await loadSettings(organizationId);
  const read = <T>(key: string, fallback: T): T => (values.get(key) as T) ?? fallback;

  return {
    approvalTiers: read('pricing.approval_tiers', [] as ApprovalTierSetting[]),
    minimumRentFloorPercent: read('pricing.minimum_rent_floor_percent', 80),
    reservationValidityDays: read('reservation.validity_days', 14),
    releaseUnitOnReservationExpiry: read('reservation.release_unit_on_expiry', true),
    defaultReservationFee: read('reservation.default_fee', 10000),
    leadFirstResponseSlaMinutes: read('lead.first_response_sla_minutes', 15),
    leadEscalationMinutes: read('lead.escalation_minutes', 30),
    leadDistributionStrategy: read('lead.distribution_strategy', 'workload_based'),
    requireNextAction: read('lead.require_next_action', true),
    renewalNoticeDays: read('renewal.notice_days', [180, 120, 90, 60, 30]),
    defaultRenewalEscalationPercent: read('renewal.default_escalation_percent', 5),
    agingBuckets: read('collections.aging_buckets', [] as AgingBucketSetting[]),
    collectionEscalationLadder: read('collections.escalation_ladder', [] as EscalationStepSetting[]),
    autoAllocatePayments: read('collections.auto_allocate_payments', true),
    maintenanceSlaByPriority: read('maintenance.sla_by_priority', {} as SlaByPrioritySetting),
    maintenanceSpendApprovalThreshold: read('maintenance.spend_approval_threshold', 50000),
    turnaroundDays: read('availability.turnaround_days', 21),
    availableSoonWindowDays: read('availability.available_soon_window_days', 90),
    autoPublishOnAvailable: read('website.auto_publish_on_available', true),
    publishExactUnitNumber: read('website.publish_exact_unit_number', false),
    longVacancyDays: read('exceptions.long_vacancy_days', 120),
    collectionRateFloor: read('exceptions.collection_rate_floor', 88),
    maintenanceBudgetVariance: read('exceptions.maintenance_budget_variance', 15),
    contractExpiryWindowDays: read('exceptions.contract_expiry_window_days', 90),
    tenantConcentrationPercent: read('exceptions.tenant_concentration_percent', 15),
    vatRatePercent: read('finance.vat_rate_percent', 15),
    defaultPaymentFrequency: read('finance.default_payment_frequency', 'quarterly'),
    invoiceLeadDays: read('finance.invoice_lead_days', 30),
    currency: read('localization.currency', 'SAR'),
  };
}
