export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'riftara_locale';

export const LOCALE_META: Record<Locale, { label: string; nativeLabel: string; dir: 'ltr' | 'rtl' }> =
  {
    en: { label: 'English', nativeLabel: 'English', dir: 'ltr' },
    ar: { label: 'Arabic', nativeLabel: 'العربية', dir: 'rtl' },
  };

export function isLocale(value: string | undefined | null): value is Locale {
  return value === 'en' || value === 'ar';
}

export function directionFor(locale: Locale): 'ltr' | 'rtl' {
  return LOCALE_META[locale].dir;
}
