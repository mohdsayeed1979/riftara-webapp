import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { and, eq, inArray } from 'drizzle-orm';
import { BarChart3, Building2, FileText, Wrench } from 'lucide-react';
import { RiftaraLogo } from '@/components/app/logo';
import { env } from '@/config/env';
import { getDb } from '@/db/client';
import { roles, userRoles, users } from '@/db/schema';
import { getSession } from '@/lib/auth/session';
import { LoginForm, type DemoAccount } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

/** Roles surfaced as quick-select demo accounts, in presentation order. */
const DEMO_ROLE_KEYS = [
  'super_admin',
  'executive',
  'leasing_manager',
  'finance',
  'maintenance_manager',
  'auditor',
];

async function loadDemoAccounts(): Promise<DemoAccount[]> {
  if (!env.DEMO_MODE) return [];
  try {
    const db = await getDb();
    const rows = await db
      .select({
        email: users.email,
        name: users.fullName,
        roleKey: roles.key,
        roleName: roles.nameEn,
      })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(users.isDemo, true), inArray(roles.key, DEMO_ROLE_KEYS)));

    return DEMO_ROLE_KEYS.flatMap((key) => {
      const match = rows.find((row) => row.roleKey === key);
      return match ? [{ email: match.email, name: match.name, role: match.roleName }] : [];
    });
  } catch {
    // The database may not be seeded yet; the form still works with manual entry.
    return [];
  }
}

const HIGHLIGHTS = [
  { icon: Building2, label: 'Property & unit management' },
  { icon: FileText, label: 'Leasing, contracts & collections' },
  { icon: Wrench, label: 'Maintenance & asset performance' },
  { icon: BarChart3, label: 'Executive portfolio reporting' },
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  const session = await getSession();
  if (session) redirect('/dashboard');

  const params = await searchParams;
  const redirectTo =
    params.redirectTo && params.redirectTo.startsWith('/') && !params.redirectTo.startsWith('//')
      ? params.redirectTo
      : '/dashboard';

  const demoAccounts = await loadDemoAccounts();

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-[var(--color-sidebar)] p-10 lg:flex">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, #c9a96a 0, transparent 45%), radial-gradient(circle at 80% 70%, #c9a96a 0, transparent 40%)',
          }}
          aria-hidden
        />
        <RiftaraLogo subtitle="ENTERPRISE PLATFORM" />

        <div className="relative">
          <h1 className="max-w-lg font-[var(--font-serif)] text-[40px] font-bold leading-[1.15] text-[var(--color-text-inverse)]">
            The real estate operating system for your portfolio.
          </h1>
          <p className="mt-4 max-w-md text-[14px] leading-6 text-[var(--color-sidebar-foreground)]">
            One platform connecting property, units, pricing, leasing, contracts, collections,
            maintenance and executive reporting — built for owners, operators and institutional
            investors.
          </p>

          <ul className="mt-8 grid max-w-md grid-cols-2 gap-4">
            {HIGHLIGHTS.map((item) => (
              <li key={item.label} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-white/10 text-[var(--color-brand-gold)]">
                  <item.icon className="size-4" aria-hidden />
                </span>
                <span className="text-[12.5px] leading-5 text-[var(--color-sidebar-foreground)]">
                  {item.label}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[11.5px] tracking-wide text-[var(--color-sidebar-foreground)]/60">
          Real Assets. Greater Possibilities.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-[var(--color-canvas)] px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-7 lg:hidden">
            <RiftaraLogo tone="dark" subtitle="ENTERPRISE PLATFORM" />
          </div>

          <h2 className="text-[24px] font-semibold tracking-[-0.02em] text-[var(--color-text-primary)]">
            Sign in to RIFTARA
          </h2>
          <p className="mt-1 mb-6 text-[13px] text-[var(--color-text-secondary)]">
            Enterprise Property, Leasing &amp; Asset Management
          </p>

          <LoginForm
            redirectTo={redirectTo}
            demoAccounts={demoAccounts}
            demoPassword={env.DEMO_MODE ? env.SEED_DEFAULT_PASSWORD : null}
          />

          <p className="mt-6 text-[11px] leading-4 text-[var(--color-text-tertiary)]">
            Access is monitored. Failed sign-in attempts are recorded and repeated failures lock the
            account temporarily.
          </p>
        </div>
      </div>
    </div>
  );
}
