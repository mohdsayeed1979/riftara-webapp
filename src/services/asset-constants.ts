/**
 * Client-safe asset constants and lifecycle metadata.
 *
 * Kept free of `server-only` and any driver import so it can be shared by both
 * the asset service (server) and the asset UI (client components).
 */

/** Asset statuses — the existing `maintenance_assets.status` value set. */
export const ASSET_STATUSES = ['operational', 'under_maintenance', 'faulty', 'decommissioned'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/** Asset types — the taxonomy documented on `maintenance_assets.asset_type`. */
export const ASSET_TYPES = [
  'elevator',
  'chiller',
  'generator',
  'pump',
  'fire_panel',
  'hvac',
  'cctv',
  'access_control',
  'other',
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

/**
 * Allowed operational status transitions. `decommissioned` is terminal and is
 * reached ONLY through disposal (requires `assets:delete`), never through the
 * change-status flow — so a decommissioned asset can never be reactivated.
 */
export const ASSET_STATUS_TRANSITIONS: Record<AssetStatus, AssetStatus[]> = {
  operational: ['under_maintenance', 'faulty'],
  under_maintenance: ['operational', 'faulty'],
  faulty: ['operational', 'under_maintenance'],
  decommissioned: [],
};

export function isAssetStatus(value: unknown): value is AssetStatus {
  return typeof value === 'string' && (ASSET_STATUSES as readonly string[]).includes(value);
}

export function isAssetType(value: unknown): value is AssetType {
  return typeof value === 'string' && (ASSET_TYPES as readonly string[]).includes(value);
}
