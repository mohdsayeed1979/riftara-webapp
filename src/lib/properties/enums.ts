/**
 * Canonical fixed value-sets for the Property Master (BRD 3, 7, 9).
 *
 * These are domain enumerations the schema models as `varchar` columns with a
 * documented allowed set (not configurable per-organization taxonomy — those
 * live in database tables such as property_types / regions and are loaded from
 * the service layer). Defined once here so the New/Edit forms and the
 * server-side validation share a single source of truth.
 */

export interface Option {
  value: string;
  label: string;
}

export const PROPERTY_USAGES = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'office', label: 'Office' },
  { value: 'retail', label: 'Retail' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'mixed', label: 'Mixed Use' },
  { value: 'land', label: 'Land' },
] as const satisfies readonly Option[];

export const PROPERTY_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'under_construction', label: 'Under Construction' },
  { value: 'under_renovation', label: 'Under Renovation' },
  { value: 'planned', label: 'Planned' },
  { value: 'disposed', label: 'Disposed' },
  { value: 'inactive', label: 'Inactive' },
] as const satisfies readonly Option[];

export const PROPERTY_CONDITIONS = [
  { value: 'excellent', label: 'Excellent' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
] as const satisfies readonly Option[];

/** Matches the `owner_type` Postgres enum (individual | entity). */
export const OWNER_TYPES = [
  { value: 'individual', label: 'Individual' },
  { value: 'entity', label: 'Entity / Company' },
] as const satisfies readonly Option[];

/** Ownership document types (Ejar-aligned, Saudi context). */
export const OWNERSHIP_DOCUMENT_TYPES = [
  { value: 'title_deed', label: 'Title Deed (Sakk)' },
  { value: 'ownership_deed', label: 'Ownership Deed' },
  { value: 'usufruct', label: 'Usufruct' },
  { value: 'lease_to_own', label: 'Lease-to-Own' },
  { value: 'waqf', label: 'Endowment (Waqf)' },
  { value: 'other', label: 'Other' },
] as const satisfies readonly Option[];

export const IDENTIFICATION_TYPES = [
  { value: 'national_id', label: 'National ID' },
  { value: 'iqama', label: 'Iqama (Residency)' },
  { value: 'commercial_registration', label: 'Commercial Registration' },
  { value: 'unified_number', label: 'Unified National Number' },
  { value: 'passport', label: 'Passport' },
] as const satisfies readonly Option[];

export const PROPERTY_USAGE_VALUES = PROPERTY_USAGES.map((o) => o.value) as [string, ...string[]];
export const PROPERTY_STATUS_VALUES = PROPERTY_STATUSES.map((o) => o.value) as [string, ...string[]];
export const PROPERTY_CONDITION_VALUES = PROPERTY_CONDITIONS.map((o) => o.value) as [string, ...string[]];
export const OWNER_TYPE_VALUES = OWNER_TYPES.map((o) => o.value) as [string, ...string[]];
export const OWNERSHIP_DOCUMENT_TYPE_VALUES = OWNERSHIP_DOCUMENT_TYPES.map((o) => o.value) as [string, ...string[]];
export const IDENTIFICATION_TYPE_VALUES = IDENTIFICATION_TYPES.map((o) => o.value) as [string, ...string[]];
