import type { Metadata, Viewport } from 'next';
import { Inter, Noto_Sans_Arabic } from 'next/font/google';
import { Toaster } from 'sonner';
import { directionFor } from '@/i18n/config';
import { I18nProvider } from '@/i18n/provider';
import { getRequestLocale } from '@/lib/locale';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  fallback: ['system-ui', 'Segoe UI', 'sans-serif'],
});

const notoArabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  variable: '--font-noto-arabic',
  display: 'swap',
  fallback: ['Segoe UI', 'sans-serif'],
});

export const metadata: Metadata = {
  title: {
    default: 'RIFTARA — Enterprise Property, Leasing & Asset Management',
    template: '%s · RIFTARA',
  },
  description:
    'RIFTARA is the enterprise real estate operating system for property, leasing, collections, maintenance, asset performance and executive reporting.',
  applicationName: 'RIFTARA',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#2e211a',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getRequestLocale();
  const dir = directionFor(locale);

  return (
    <html lang={locale} dir={dir} className={`${inter.variable} ${notoArabic.variable}`}>
      <body>
        <I18nProvider locale={locale}>
          {children}
          <Toaster
            position={dir === 'rtl' ? 'bottom-left' : 'bottom-right'}
            dir={dir}
            toastOptions={{
              style: {
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border-base)',
                color: 'var(--color-text-primary)',
                fontSize: '13px',
              },
            }}
          />
        </I18nProvider>
      </body>
    </html>
  );
}
