'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { DEFAULT_LOCALE, directionFor, type Locale } from './config';
import { getMessages, interpolate, type Messages } from './index';

interface I18nContextValue {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  messages: Messages;
  t: (path: string, values?: Record<string, string | number>) => string;
  currency: string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function resolvePath(messages: Messages, path: string): string | undefined {
  const segments = path.split('.');
  let current: unknown = messages;
  for (const segment of segments) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'string' ? current : undefined;
}

export function I18nProvider({
  locale,
  currency = 'SAR',
  children,
}: {
  locale: Locale;
  currency?: string;
  children: ReactNode;
}) {
  const messages = useMemo(() => getMessages(locale), [locale]);

  const t = useCallback(
    (path: string, values?: Record<string, string | number>) => {
      const template = resolvePath(messages, path);
      // Falling back to the key surfaces missing translations during review
      // instead of rendering an empty string in production.
      if (!template) return path;
      return values ? interpolate(template, values) : template;
    },
    [messages],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, dir: directionFor(locale), messages, t, currency }),
    [locale, messages, t, currency],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    // Safe default keeps isolated component tests and Storybook-style renders working.
    const messages = getMessages(DEFAULT_LOCALE);
    return {
      locale: DEFAULT_LOCALE,
      dir: 'ltr',
      messages,
      t: (path: string, values?: Record<string, string | number>) => {
        const template = resolvePath(messages, path);
        if (!template) return path;
        return values ? interpolate(template, values) : template;
      },
      currency: 'SAR',
    };
  }
  return context;
}

export function useTranslations() {
  return useI18n().t;
}
