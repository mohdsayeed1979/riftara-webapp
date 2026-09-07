import 'server-only';
import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from '@/i18n/config';

export const LOCATION_COOKIE = 'riftara_location';

/** Reads the viewer's locale preference from the cookie set by the header. */
export async function getRequestLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** Active city filter, or null when the viewer selected "All locations". */
export async function getRequestLocationId(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(LOCATION_COOKIE)?.value;
  return !value || value === 'all' ? null : value;
}
