/**
 * Canonical fixed value-sets for the Unit Master (BRD 10, 11). These map to
 * `varchar` columns on `units` with a documented allowed set. Configurable
 * taxonomies (unit types, unit statuses) live in the database and are loaded
 * from the service layer — never from here.
 */
export interface Option {
  value: string;
  label: string;
}

export const UNIT_USAGES = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'office', label: 'Office' },
  { value: 'retail', label: 'Retail' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'mixed', label: 'Mixed Use' },
  { value: 'land', label: 'Land' },
] as const satisfies readonly Option[];

export const FURNISHING_STATUSES = [
  { value: 'unfurnished', label: 'Unfurnished' },
  { value: 'semi_furnished', label: 'Semi-Furnished' },
  { value: 'furnished', label: 'Furnished' },
] as const satisfies readonly Option[];

/** Commercial fit-out state (units.fit_out_status). */
export const FIT_OUT_STATUSES = [
  { value: 'shell_core', label: 'Shell & Core' },
  { value: 'semi_fitted', label: 'Semi-Fitted' },
  { value: 'fully_fitted', label: 'Fully Fitted' },
  { value: 'furnished', label: 'Furnished' },
] as const satisfies readonly Option[];

export const UNIT_CONDITIONS = [
  { value: 'excellent', label: 'Excellent' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
] as const satisfies readonly Option[];

export const UNIT_USAGE_VALUES = UNIT_USAGES.map((o) => o.value) as [string, ...string[]];
export const FURNISHING_STATUS_VALUES = FURNISHING_STATUSES.map((o) => o.value) as [string, ...string[]];
export const FIT_OUT_STATUS_VALUES = FIT_OUT_STATUSES.map((o) => o.value) as [string, ...string[]];
export const UNIT_CONDITION_VALUES = UNIT_CONDITIONS.map((o) => o.value) as [string, ...string[]];

/** Building lifecycle status (buildings.status). */
export const BUILDING_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'under_construction', label: 'Under Construction' },
  { value: 'under_renovation', label: 'Under Renovation' },
  { value: 'inactive', label: 'Inactive' },
] as const satisfies readonly Option[];

export const BUILDING_STATUS_VALUES = BUILDING_STATUSES.map((o) => o.value) as [string, ...string[]];
