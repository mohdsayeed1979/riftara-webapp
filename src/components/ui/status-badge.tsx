'use client';

import { Badge, type BadgeProps } from './badge';
import { useI18n } from '@/i18n/provider';

/**
 * Maps the design-system status tokens (BRD 13 unit statuses, contract,
 * invoice, work-order and lead states) onto badge tones so a status is
 * rendered identically everywhere in the application.
 */
export type StatusTone = NonNullable<BadgeProps['tone']>;

const TONE_BY_TOKEN: Record<string, StatusTone> = {
  // Availability classes
  available: 'success',
  reserved: 'warning',
  leased: 'info',
  occupied: 'info',
  not_available: 'neutral',
  maintenance: 'error',
  blocked: 'neutral',

  // Generic outcomes
  success: 'success',
  warning: 'warning',
  error: 'error',
  info: 'info',
  neutral: 'neutral',
  gold: 'gold',

  // Contract lifecycle
  draft: 'neutral',
  pending_approval: 'warning',
  issued: 'info',
  signed: 'success',
  active: 'success',
  expired: 'neutral',
  terminated: 'error',
  renewal_pending: 'warning',

  // Invoice lifecycle
  upcoming: 'neutral',
  due: 'warning',
  paid: 'success',
  partially_paid: 'warning',
  overdue: 'error',
  cancelled: 'neutral',
  waived: 'neutral',

  // Work order lifecycle
  open: 'error',
  assigned: 'info',
  in_progress: 'info',
  pending: 'warning',
  completed: 'success',

  // Priority
  low: 'success',
  medium: 'warning',
  high: 'error',
  critical: 'error',

  // Approvals / proposals / reservations
  approved: 'success',
  rejected: 'error',
  returned: 'warning',
  sent: 'info',
  accepted: 'success',
  superseded: 'neutral',
  converted: 'success',

  // Viewings
  scheduled: 'info',
  confirmed: 'info',
  no_show: 'error',
  rescheduled: 'warning',

  // Integrations
  connected: 'success',
  not_connected: 'neutral',
  configuration_required: 'warning',
};

export function toneForStatus(token: string | null | undefined): StatusTone {
  if (!token) return 'neutral';
  return TONE_BY_TOKEN[token] ?? 'neutral';
}

/** Converts `pending_approval` to `Pending Approval` for display. */
export function humanizeStatus(token: string | null | undefined): string {
  if (!token) return '—';
  return token
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function StatusBadge({
  status,
  label,
  tone,
  dot = true,
  size = 'sm',
  className,
}: {
  status: string | null | undefined;
  label?: string;
  tone?: StatusTone;
  dot?: boolean;
  size?: BadgeProps['size'];
  className?: string;
}) {
  const { t } = useI18n();
  // An explicit label wins; otherwise localize the enum/DB token via the catalog,
  // falling back to a humanized form for tokens not (yet) in `common.statuses`.
  const key = status ? `common.statuses.${status}` : '';
  const translated = key ? t(key) : '';
  const display = label ?? (translated && translated !== key ? translated : humanizeStatus(status));
  return (
    <Badge tone={tone ?? toneForStatus(status)} size={size} dot={dot} className={className}>
      {display}
    </Badge>
  );
}
