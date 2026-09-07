'use client';

import { Bell, ChevronDown, Globe, LogOut, MapPin, Menu, PanelLeft, User } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Avatar } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LOCALE_META, LOCALES, type Locale } from '@/i18n/config';
import { useI18n } from '@/i18n/provider';
import { cn } from '@/lib/utils';
import { GlobalSearch } from './global-search';
import { NotificationBell, type NotificationItem } from './notification-center';

export interface HeaderLocation {
  id: string;
  name: string;
}

export function AppHeader({
  user,
  locations,
  activeLocationId,
  notifications,
  unreadCount,
  onToggleSidebar,
  onOpenMobileNav,
  sidebarCollapsed,
}: {
  user: { fullName: string; roleLabel: string; avatarUrl: string | null; email: string };
  locations: HeaderLocation[];
  activeLocationId: string | null;
  notifications: NotificationItem[];
  unreadCount: number;
  onToggleSidebar: () => void;
  onOpenMobileNav: () => void;
  sidebarCollapsed: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const activeLocation = locations.find((l) => l.id === activeLocationId);

  function setPreference(name: 'riftara_locale' | 'riftara_location', value: string) {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    startTransition(() => router.refresh());
  }

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-[var(--color-border-base)] bg-[var(--color-surface-muted)]/95 px-3 backdrop-blur lg:px-5">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onOpenMobileNav}
        aria-label={t('header.openMenu')}
      >
        <Menu />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="hidden lg:inline-flex"
        onClick={onToggleSidebar}
        aria-label={sidebarCollapsed ? t('header.expandSidebar') : t('header.collapseSidebar')}
        aria-expanded={!sidebarCollapsed}
      >
        <PanelLeft className="rtl-flip" />
      </Button>

      <GlobalSearch className="mx-1 max-w-2xl flex-1" />

      <div className="flex items-center gap-1">
        {locations.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="hidden gap-1.5 md:inline-flex">
                <MapPin className="text-[var(--color-text-tertiary)]" />
                <span className="max-w-28 truncate">
                  {activeLocation?.name ?? t('header.allLocations')}
                </span>
                <ChevronDown className="size-3.5 text-[var(--color-text-tertiary)]" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>{t('header.location')}</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setPreference('riftara_location', 'all')}>
                {t('header.allLocations')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {locations.map((location) => (
                <DropdownMenuItem
                  key={location.id}
                  onSelect={() => setPreference('riftara_location', location.id)}
                  className={cn(location.id === activeLocationId && 'font-medium')}
                >
                  {location.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="hidden gap-1.5 sm:inline-flex" disabled={pending}>
              <Globe className="text-[var(--color-text-tertiary)]" />
              <span>{LOCALE_META[locale].nativeLabel}</span>
              <ChevronDown className="size-3.5 text-[var(--color-text-tertiary)]" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>{t('header.language')}</DropdownMenuLabel>
            {LOCALES.map((code: Locale) => (
              <DropdownMenuItem
                key={code}
                onSelect={() => setPreference('riftara_locale', code)}
                className={cn(code === locale && 'font-medium')}
              >
                {LOCALE_META[code].nativeLabel}
                <span className="ms-auto text-[11px] text-[var(--color-text-tertiary)]">
                  {LOCALE_META[code].dir.toUpperCase()}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <NotificationBell notifications={notifications} unreadCount={unreadCount} />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="ms-1 flex items-center gap-2 rounded-[10px] px-1.5 py-1 transition-colors hover:bg-[var(--color-surface-alt)]"
            >
              <Avatar name={user.fullName} src={user.avatarUrl} size="md" />
              <span className="hidden text-start md:block">
                <span className="block max-w-36 truncate text-[13px] font-medium text-[var(--color-text-primary)]">
                  {user.fullName}
                </span>
                <span className="block text-[11px] text-[var(--color-text-secondary)]">
                  {user.roleLabel}
                </span>
              </span>
              <ChevronDown className="hidden size-3.5 text-[var(--color-text-tertiary)] md:block" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-56">
            <div className="px-2.5 py-2">
              <p className="text-[13px] font-medium text-[var(--color-text-primary)]">{user.fullName}</p>
              <p className="truncate text-[11.5px] text-[var(--color-text-secondary)]">{user.email}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/account">
                <User />
                {t('header.myAccount')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/notifications">
                <Bell />
                {t('header.notifications')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => void signOut()}>
              <LogOut />
              {t('header.signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
