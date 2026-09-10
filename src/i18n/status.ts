import type { Locale } from './config';
import { getMessages } from './index';

/**
 * Localizes an enum/DB status token for display (server-side or anywhere a
 * hook is unavailable). Database values stay English/internal; only the shown
 * label changes. Falls back to a humanized form for tokens not in the catalog.
 */
export function statusLabel(locale: Locale, token: string | null | undefined): string {
  if (!token) return '—';
  const map = getMessages(locale).common.statuses as Record<string, string>;
  if (map[token]) return map[token];
  return token
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
