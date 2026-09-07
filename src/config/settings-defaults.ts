/**
 * Default configurable settings (BRD 68, 3.5).
 *
 * Every business threshold in the platform is read from the `settings` table
 * through `src/lib/settings.ts` — none is hard-coded in a service or a screen.
 */

export interface SettingDefault {
  key: string;
  group: string;
  label: string;
  description: string;
  valueType: 'number' | 'percent' | 'boolean' | 'string' | 'json' | 'duration_days' | 'duration_minutes';
  value: unknown;
  isSystem?: boolean;
}

export const DEFAULT_SETTINGS: SettingDefault[] = [
  // --- Pricing approval thresholds (BRD 18) -------------------------------
  {
    key: 'pricing.approval_tiers',
    group: 'approvals',
    label: 'Pricing approval tiers',
    description:
      'Discount percentage bands and the role required to approve each. Evaluated in order; the first band whose maxDiscountPercent covers the request wins.',
    valueType: 'json',
    value: [
      { maxDiscountPercent: 5, roleKey: 'leasing_manager', label: 'Leasing Manager' },
      { maxDiscountPercent: 10, roleKey: 'asset_manager', label: 'Leasing Director' },
      { maxDiscountPercent: 100, roleKey: 'executive', label: 'Executive Approval' },
    ],
  },
  {
    key: 'pricing.minimum_rent_floor_percent',
    group: 'approvals',
    label: 'Minimum rent floor',
    description:
      'A requested rent below this percentage of the asking rent always requires executive approval, regardless of tier.',
    valueType: 'percent',
    value: 80,
  },

  // --- Reservations (BRD 33-34) ------------------------------------------
  {
    key: 'reservation.validity_days',
    group: 'leasing',
    label: 'Reservation validity',
    description: 'Days a reservation stays active before it expires and releases the unit.',
    valueType: 'duration_days',
    value: 14,
  },
  {
    key: 'reservation.release_unit_on_expiry',
    group: 'leasing',
    label: 'Release unit on reservation expiry',
    description: 'BR-011 — return the unit to Available automatically when a reservation expires.',
    valueType: 'boolean',
    value: true,
  },
  {
    key: 'reservation.default_fee',
    group: 'leasing',
    label: 'Default reservation fee',
    description: 'Reservation amount proposed by default when creating a reservation (SAR).',
    valueType: 'number',
    value: 10000,
  },

  // --- Lead SLA (BRD 25) --------------------------------------------------
  {
    key: 'lead.first_response_sla_minutes',
    group: 'leasing',
    label: 'Lead first-response target',
    description: 'Minutes within which a new lead must be contacted.',
    valueType: 'duration_minutes',
    value: 15,
  },
  {
    key: 'lead.escalation_minutes',
    group: 'leasing',
    label: 'Lead escalation threshold',
    description: 'Minutes after which an uncontacted lead is escalated to the manager.',
    valueType: 'duration_minutes',
    value: 30,
  },
  {
    key: 'lead.distribution_strategy',
    group: 'leasing',
    label: 'Lead distribution strategy',
    description:
      'How new leads are assigned: manual, round_robin, property_based, city_based, source_based, team_based or workload_based.',
    valueType: 'string',
    value: 'workload_based',
  },
  {
    key: 'lead.require_next_action',
    group: 'leasing',
    label: 'Require a next action',
    description: 'No qualified or active lead may be saved without a next action and follow-up date.',
    valueType: 'boolean',
    value: true,
  },

  // --- Renewals (BRD 83) --------------------------------------------------
  {
    key: 'renewal.notice_days',
    group: 'leasing',
    label: 'Renewal notice windows',
    description: 'Days before expiry at which renewal workflows are triggered.',
    valueType: 'json',
    value: [180, 120, 90, 60, 30],
  },
  {
    key: 'renewal.default_escalation_percent',
    group: 'leasing',
    label: 'Default renewal escalation',
    description: 'Default rent increase proposed on renewal.',
    valueType: 'percent',
    value: 5,
  },

  // --- Collections (BRD 46-47) -------------------------------------------
  {
    key: 'collections.aging_buckets',
    group: 'collections',
    label: 'Aging buckets',
    description: 'Day ranges used for receivables aging analysis.',
    valueType: 'json',
    value: [
      { key: 'current', label: 'Current', minDays: -99999, maxDays: 0 },
      { key: '1_30', label: '1-30 days', minDays: 1, maxDays: 30 },
      { key: '31_60', label: '31-60 days', minDays: 31, maxDays: 60 },
      { key: '61_90', label: '61-90 days', minDays: 61, maxDays: 90 },
      { key: '91_180', label: '91-180 days', minDays: 91, maxDays: 180 },
      { key: '180_plus', label: '180+ days', minDays: 181, maxDays: 99999 },
    ],
  },
  {
    key: 'collections.escalation_ladder',
    group: 'collections',
    label: 'Collection escalation ladder',
    description: 'Days overdue at which each collection action becomes due.',
    valueType: 'json',
    value: [
      { daysOverdue: 1, action: 'reminder' },
      { daysOverdue: 15, action: 'follow_up' },
      { daysOverdue: 45, action: 'escalation' },
      { daysOverdue: 75, action: 'formal_notice' },
      { daysOverdue: 120, action: 'legal_review' },
    ],
  },
  {
    key: 'collections.auto_allocate_payments',
    group: 'collections',
    label: 'Automatic payment allocation',
    description: 'Allocate received payments to the oldest open invoice first.',
    valueType: 'boolean',
    value: true,
  },

  // --- Maintenance SLA (BRD 53) ------------------------------------------
  {
    key: 'maintenance.sla_by_priority',
    group: 'maintenance',
    label: 'Maintenance SLA by priority',
    description: 'Target response and resolution hours for each work-order priority.',
    valueType: 'json',
    value: {
      critical: { responseHours: 1, resolutionHours: 8 },
      high: { responseHours: 4, resolutionHours: 24 },
      medium: { responseHours: 12, resolutionHours: 72 },
      low: { responseHours: 24, resolutionHours: 168 },
    },
  },
  {
    key: 'maintenance.spend_approval_threshold',
    group: 'approvals',
    label: 'Maintenance spend approval threshold',
    description: 'Work-order cost above which management approval is required (SAR).',
    valueType: 'number',
    value: 50000,
  },

  // --- Availability engine (BRD 14) --------------------------------------
  {
    key: 'availability.turnaround_days',
    group: 'operations',
    label: 'Unit turnaround period',
    description: 'Preparation days added after a tenant vacates before a unit becomes available.',
    valueType: 'duration_days',
    value: 21,
  },
  {
    key: 'availability.available_soon_window_days',
    group: 'operations',
    label: 'Available Soon window',
    description: 'Days ahead of the available-from date at which a unit is marketed as Available Soon.',
    valueType: 'duration_days',
    value: 90,
  },

  // --- Website publishing (BRD 89) ---------------------------------------
  {
    key: 'website.auto_publish_on_available',
    group: 'website',
    label: 'Auto-publish available units',
    description: 'BR-009 — publish a unit to the website automatically when it becomes available.',
    valueType: 'boolean',
    value: true,
  },
  {
    key: 'website.publish_exact_unit_number',
    group: 'website',
    label: 'Publish exact unit number',
    description: 'Show the real unit number on public listings.',
    valueType: 'boolean',
    value: false,
  },

  // --- Executive exceptions (BRD 74) -------------------------------------
  {
    key: 'exceptions.long_vacancy_days',
    group: 'kpi',
    label: 'Long-vacancy threshold',
    description: 'Days vacant above which a unit is flagged to management.',
    valueType: 'duration_days',
    value: 120,
  },
  {
    key: 'exceptions.collection_rate_floor',
    group: 'kpi',
    label: 'Collection rate floor',
    description: 'Collection rate below which a property is flagged.',
    valueType: 'percent',
    value: 88,
  },
  {
    key: 'exceptions.maintenance_budget_variance',
    group: 'kpi',
    label: 'Maintenance budget variance limit',
    description: 'Percentage over budget at which maintenance spend is flagged.',
    valueType: 'percent',
    value: 15,
  },
  {
    key: 'exceptions.contract_expiry_window_days',
    group: 'kpi',
    label: 'Contract expiry alert window',
    description: 'Days ahead of expiry at which contracts appear in the exceptions panel.',
    valueType: 'duration_days',
    value: 90,
  },
  {
    key: 'exceptions.tenant_concentration_percent',
    group: 'kpi',
    label: 'Tenant concentration limit',
    description: 'Share of portfolio revenue from one tenant above which concentration is flagged.',
    valueType: 'percent',
    value: 15,
  },

  // --- Finance ------------------------------------------------------------
  {
    key: 'finance.vat_rate_percent',
    group: 'finance',
    label: 'VAT rate',
    description: 'Value Added Tax rate applied to rent and service charges.',
    valueType: 'percent',
    value: 15,
  },
  {
    key: 'finance.default_payment_frequency',
    group: 'finance',
    label: 'Default payment frequency',
    description: 'Payment frequency proposed when creating a new contract.',
    valueType: 'string',
    value: 'quarterly',
  },
  {
    key: 'finance.invoice_lead_days',
    group: 'finance',
    label: 'Invoice lead time',
    description: 'Days before the due date on which an invoice is issued.',
    valueType: 'duration_days',
    value: 30,
  },

  // --- Localisation -------------------------------------------------------
  {
    key: 'localization.default_locale',
    group: 'localization',
    label: 'Default interface language',
    description: 'Language used for new users and unauthenticated screens.',
    valueType: 'string',
    value: 'en',
  },
  {
    key: 'localization.currency',
    group: 'localization',
    label: 'Reporting currency',
    description: 'Currency used across dashboards, contracts and reports.',
    valueType: 'string',
    value: 'SAR',
    isSystem: true,
  },
];

export const SETTING_KEYS = DEFAULT_SETTINGS.map((s) => s.key);
