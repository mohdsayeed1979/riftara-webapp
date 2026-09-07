import { DEFAULT_LOCALE, type Locale } from './config';
import { ar } from './messages/ar';
import { en, type Messages } from './messages/en';

const CATALOGS: Record<Locale, Messages> = { en, ar };

export function getMessages(locale: Locale): Messages {
  return CATALOGS[locale] ?? CATALOGS[DEFAULT_LOCALE];
}

/** Interpolates `{name}` placeholders. */
export function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

export type { Messages };
export { en, ar };
