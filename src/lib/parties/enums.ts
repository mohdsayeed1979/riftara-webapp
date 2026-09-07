/**
 * Fixed value-sets for Customer and Tenant records (BRD 21-24). These map to
 * the existing `customer_type` enum and documented `varchar` columns. Nothing
 * here is a configurable taxonomy.
 */
export interface Option {
  value: string;
  label: string;
}

/** Matches the `customer_type` Postgres enum. */
export const CUSTOMER_TYPES = [
  { value: 'individual', label: 'Individual' },
  { value: 'corporate', label: 'Corporate / Company' },
] as const satisfies readonly Option[];

export const CUSTOMER_PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const satisfies readonly Option[];

/** tenants.status */
export const TENANT_STATUSES = [
  { value: 'prospective', label: 'Prospective' },
  { value: 'active', label: 'Active' },
  { value: 'former', label: 'Former' },
  { value: 'blacklisted', label: 'Blacklisted' },
] as const satisfies readonly Option[];

export const CUSTOMER_TYPE_VALUES = CUSTOMER_TYPES.map((o) => o.value) as [string, ...string[]];
export const CUSTOMER_PRIORITY_VALUES = CUSTOMER_PRIORITIES.map((o) => o.value) as [string, ...string[]];
export const TENANT_STATUS_VALUES = TENANT_STATUSES.map((o) => o.value) as [string, ...string[]];
