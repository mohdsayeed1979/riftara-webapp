import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/messages/en';
import { ar } from '@/i18n/messages/ar';
import { getMessages } from '@/i18n';
import { directionFor, LOCALES } from '@/i18n/config';
import { statusLabel } from '@/i18n/status';

type Dict = Record<string, unknown>;

/** Recursively collects every leaf key path and its string value. */
function flatten(obj: Dict, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') Object.assign(out, flatten(value as Dict, path));
    else out[path] = value as string;
  }
  return out;
}

/** Interpolation placeholders like {count} used in a template. */
function placeholders(template: string): string[] {
  return (template.match(/\{(\w+)\}/g) ?? []).sort();
}

const enFlat = flatten(en as unknown as Dict);
const arFlat = flatten(ar as unknown as Dict);

describe('i18n catalogs', () => {
  it('English and Arabic expose exactly the same key paths', () => {
    const enKeys = Object.keys(enFlat).sort();
    const arKeys = Object.keys(arFlat).sort();
    const missingInAr = enKeys.filter((k) => !(k in arFlat));
    const extraInAr = arKeys.filter((k) => !(k in enFlat));
    expect(missingInAr, `missing in ar: ${missingInAr.join(', ')}`).toEqual([]);
    expect(extraInAr, `extra in ar: ${extraInAr.join(', ')}`).toEqual([]);
  });

  it('has no empty or whitespace-only values in either catalog', () => {
    const emptyEn = Object.entries(enFlat).filter(([, v]) => !v || !v.trim()).map(([k]) => k);
    const emptyAr = Object.entries(arFlat).filter(([, v]) => !v || !v.trim()).map(([k]) => k);
    expect(emptyEn, `empty en: ${emptyEn.join(', ')}`).toEqual([]);
    expect(emptyAr, `empty ar: ${emptyAr.join(', ')}`).toEqual([]);
  });

  it('keeps interpolation placeholders identical between languages', () => {
    const mismatches: string[] = [];
    for (const [key, enValue] of Object.entries(enFlat)) {
      const arValue = arFlat[key];
      if (placeholders(enValue).join(',') !== placeholders(arValue).join(',')) mismatches.push(key);
    }
    expect(mismatches, `placeholder mismatch: ${mismatches.join(', ')}`).toEqual([]);
  });

  it('Arabic values are not just copied English (spot check core terms)', () => {
    expect(ar.nav.properties).not.toBe(en.nav.properties);
    expect(ar.common.statuses.leased).not.toBe(en.common.statuses.leased);
    expect(ar.contracts.title).not.toBe(en.contracts.title);
  });

  it('resolves catalogs and RTL direction per locale', () => {
    expect(getMessages('en').nav.dashboard).toBe('Dashboard');
    expect(getMessages('ar').nav.dashboard).toBe('لوحة المعلومات');
    expect(directionFor('en')).toBe('ltr');
    expect(directionFor('ar')).toBe('rtl');
    expect(LOCALES).toContain('ar');
  });

  it('localizes dynamic status tokens in both languages and falls back safely', () => {
    expect(statusLabel('en', 'leased')).toBe('Leased');
    expect(statusLabel('ar', 'leased')).toBe('مؤجّرة');
    expect(statusLabel('ar', 'pending_approval')).toBe('بانتظار الاعتماد');
    // Unknown token → humanized fallback, never a crash or raw key.
    expect(statusLabel('ar', 'some_new_token')).toBe('Some New Token');
    expect(statusLabel('en', null)).toBe('—');
  });

  it('covers every status tone token used by the badge mapper', async () => {
    const arStatuses = ar.common.statuses as Record<string, string>;
    // A representative set the UI renders directly from enum/DB values.
    for (const token of ['available', 'reserved', 'leased', 'active', 'overdue', 'completed', 'high', 'signed', 'cancelled']) {
      expect(arStatuses[token], `missing ar status: ${token}`).toBeTruthy();
    }
  });
});
