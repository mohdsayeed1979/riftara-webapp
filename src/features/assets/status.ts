import type { StatusTone } from '@/components/ui/status-badge';

/** Maps the asset lifecycle statuses onto design-system badge tones. */
const ASSET_STATUS_TONE: Record<string, StatusTone> = {
  operational: 'success',
  under_maintenance: 'info',
  faulty: 'error',
  decommissioned: 'neutral',
};

export function assetStatusTone(status: string | null | undefined): StatusTone {
  return (status && ASSET_STATUS_TONE[status]) || 'neutral';
}

export function humanizeAssetType(assetType: string): string {
  return assetType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Non-terminal status options offered by the change-status control. */
export const CHANGEABLE_ASSET_STATUSES: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'operational', name: 'Operational' },
  { id: 'under_maintenance', name: 'Under Maintenance' },
  { id: 'faulty', name: 'Faulty' },
];
