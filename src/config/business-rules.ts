/**
 * The BRD's core business rules (BRD 153), registered so administrators can
 * see their status, adjust parameters and — where safe — relax enforcement
 * without a code change.
 *
 * Rules marked `enforced` with `configurable: false` are structural: they are
 * additionally guaranteed by database constraints and cannot be switched off.
 */

export interface BusinessRuleSpec {
  code: string;
  name: string;
  description: string;
  enforcement: 'enforced' | 'warning' | 'disabled';
  /** false when the rule is also guaranteed at the database level. */
  configurable: boolean;
  /** Where the rule is implemented. */
  implementedIn: string;
  parameters?: Record<string, unknown>;
}

export const BUSINESS_RULES: BusinessRuleSpec[] = [
  {
    code: 'BR-001',
    name: 'A unit cannot be published if its status is not eligible',
    description:
      'Publication is only permitted for statuses flagged publishable in the unit status taxonomy.',
    enforcement: 'enforced',
    configurable: true,
    implementedIn: 'src/services/publishing-service.ts',
  },
  {
    code: 'BR-002',
    name: 'A unit cannot have conflicting active reservations',
    description:
      'Guaranteed by the partial unique index reservations_one_active_per_unit as well as the reservation service.',
    enforcement: 'enforced',
    configurable: false,
    implementedIn: 'src/services/reservation-service.ts + database index',
  },
  {
    code: 'BR-003',
    name: 'A unit cannot have overlapping active lease contracts',
    description:
      'Guaranteed by the trg_contracts_no_overlap database trigger as well as the contract service.',
    enforcement: 'enforced',
    configurable: false,
    implementedIn: 'src/services/contract-service.ts + database trigger',
  },
  {
    code: 'BR-004',
    name: 'Pricing below permitted limits requires approval',
    description: 'Discount tiers are configurable under Settings › Approval Rules.',
    enforcement: 'enforced',
    configurable: true,
    implementedIn: 'src/services/pricing-service.ts',
    parameters: { settingKey: 'pricing.approval_tiers' },
  },
  {
    code: 'BR-005',
    name: 'All pricing changes must be retained in price history',
    description: 'price_history is append-only; updates and deletes are blocked by trigger.',
    enforcement: 'enforced',
    configurable: false,
    implementedIn: 'src/services/pricing-service.ts + database trigger',
  },
  {
    code: 'BR-006',
    name: 'A lost lead cannot be closed without a loss reason',
    description: 'Enforced by the lead service and by form validation.',
    enforcement: 'enforced',
    configurable: true,
    implementedIn: 'src/services/lead-service.ts',
  },
  {
    code: 'BR-007',
    name: 'Customer duplicate detection must occur before creating a new customer',
    description:
      'Mobile, email, national ID, iqama and commercial registration are checked; a match links to the existing customer.',
    enforcement: 'enforced',
    configurable: true,
    implementedIn: 'src/services/customer-service.ts + unique index',
    parameters: {
      identifierTypes: ['mobile', 'email', 'national_id', 'iqama', 'commercial_registration'],
    },
  },
  {
    code: 'BR-008',
    name: 'A website inquiry must automatically create or update a lead',
    description: 'The public intake endpoint routes every inquiry through duplicate detection.',
    enforcement: 'enforced',
    configurable: false,
    implementedIn: 'src/app/api/v1/website/leads/route.ts',
  },
  {
    code: 'BR-009',
    name: 'Unit status changes must automatically update the website',
    description: 'The publishing service rewrites the website listing projection on every status change.',
    enforcement: 'enforced',
    configurable: true,
    implementedIn: 'src/services/publishing-service.ts',
  },
  {
    code: 'BR-010',
    name: 'A signed contract must automatically update unit leasing status',
    description: 'Signing a contract transitions the unit to Leased inside the same transaction.',
    enforcement: 'enforced',
    configurable: false,
    implementedIn: 'src/services/contract-service.ts',
  },
  {
    code: 'BR-011',
    name: 'An expired reservation shall release the unit according to business rules',
    description: 'Configurable under Settings › Leasing.',
    enforcement: 'enforced',
    configurable: true,
    implementedIn: 'src/services/reservation-service.ts',
    parameters: { settingKey: 'reservation.release_unit_on_expiry' },
  },
  {
    code: 'BR-012',
    name: 'Signed contracts must not be permanently deleted',
    description: 'Blocked by the trg_contracts_protect_delete database trigger.',
    enforcement: 'enforced',
    configurable: false,
    implementedIn: 'database trigger',
  },
  {
    code: 'BR-013',
    name: 'Financial transactions must not be permanently deleted',
    description:
      'Invoices, payments, allocations and ledger entries are protected by database triggers; they are cancelled or reversed instead.',
    enforcement: 'enforced',
    configurable: false,
    implementedIn: 'database triggers',
  },
  {
    code: 'BR-014',
    name: 'Maintenance costs must roll up from unit to property and portfolio',
    description: 'Maintenance costs feed OPEX and therefore NOI at every hierarchy level.',
    enforcement: 'enforced',
    configurable: false,
    implementedIn: 'src/services/maintenance-service.ts',
  },
  {
    code: 'BR-015',
    name: 'Collections must roll up from payment to unit, property, city and portfolio',
    description: 'Payment allocation updates invoice, ledger and every aggregate KPI.',
    enforcement: 'enforced',
    configurable: false,
    implementedIn: 'src/services/payment-service.ts',
  },
  {
    code: 'BR-016',
    name: 'Dashboards and management reports use the approved master data source',
    description:
      'All dashboards read the shared metrics services; reports freeze a snapshot at generation time.',
    enforcement: 'enforced',
    configurable: false,
    implementedIn: 'src/services/metrics-service.ts',
  },
  {
    code: 'BR-017',
    name: 'All sensitive business changes must be recorded in the audit trail',
    description: 'audit_logs is append-only; updates and deletes are blocked by trigger.',
    enforcement: 'enforced',
    configurable: false,
    implementedIn: 'src/lib/audit/index.ts + database trigger',
  },
  {
    code: 'BR-018',
    name: 'External integration failures must be logged and traceable',
    description: 'Every connector call writes an integration_logs row with result and error detail.',
    enforcement: 'enforced',
    configurable: false,
    implementedIn: 'src/services/integration-service.ts',
  },
];

export const BUSINESS_RULE_BY_CODE = new Map(BUSINESS_RULES.map((rule) => [rule.code, rule]));
