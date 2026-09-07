'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/i18n/provider';
import { isNavItemActive, NAV_GROUPS } from '@/config/navigation';
import type { PermissionKey } from '@/lib/permissions/catalog';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/ui/misc';
import { RiftaraLogo } from './logo';

export interface SidebarSummary {
  label: string;
  value: string;
  caption: string;
  delta?: string | null;
  imageUrl?: string | null;
}

export function Sidebar({
  permissions,
  collapsed,
  summary,
  onNavigate,
}: {
  permissions: PermissionKey[];
  collapsed: boolean;
  summary?: SidebarSummary | null;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { t } = useI18n();

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => permissions.includes(item.permission)),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flex h-full flex-col bg-[var(--color-sidebar)] text-[var(--color-sidebar-foreground)]">
      <div
        className={cn(
          'flex h-16 shrink-0 items-center border-b border-[var(--color-sidebar-border)]',
          collapsed ? 'justify-center px-2' : 'px-5',
        )}
      >
        <Link href="/dashboard" onClick={onNavigate} aria-label="RIFTARA home">
          <RiftaraLogo compact={collapsed} subtitle={t('common.portalName').toUpperCase()} />
        </Link>
      </div>

      <nav className="no-scrollbar flex-1 overflow-y-auto px-2 py-3" aria-label="Main navigation">
        {groups.map((group, groupIndex) => (
          <div key={group.key} className={cn(groupIndex > 0 && 'mt-4')}>
            {!collapsed ? (
              <p className="px-3 pb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-[var(--color-sidebar-foreground)]/45">
                {t(group.labelKey)}
              </p>
            ) : groupIndex > 0 ? (
              <div className="mx-3 mb-2 h-px bg-[var(--color-sidebar-border)]" />
            ) : null}

            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = isNavItemActive(item, pathname);
                const Icon = item.icon;
                const link = (
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group relative flex items-center gap-3 rounded-[10px] py-2.5 text-[13px] font-medium transition-colors',
                      collapsed ? 'justify-center px-2' : 'px-3',
                      active
                        ? 'bg-[var(--color-sidebar-active)] text-[var(--color-sidebar-foreground-active)]'
                        : 'text-[var(--color-sidebar-foreground)] hover:bg-[var(--color-sidebar-hover)] hover:text-[var(--color-sidebar-foreground-active)]',
                    )}
                  >
                    {active ? (
                      <span
                        className="absolute inset-y-1.5 start-0 w-[3px] rounded-e-full bg-[var(--color-brand-gold)]"
                        aria-hidden
                      />
                    ) : null}
                    <Icon className="size-4.5 shrink-0" aria-hidden />
                    {!collapsed ? <span className="truncate">{t(item.labelKey)}</span> : null}
                  </Link>
                );

                return (
                  <li key={item.key}>
                    {collapsed ? (
                      <Tooltip content={t(item.labelKey)} side="right">
                        {link}
                      </Tooltip>
                    ) : (
                      link
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {summary && !collapsed ? (
        <div className="shrink-0 p-3">
          <div className="overflow-hidden rounded-[12px] border border-[var(--color-sidebar-border)] bg-[var(--color-espresso-950)]/50">
            {summary.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={summary.imageUrl}
                alt=""
                className="h-24 w-full object-cover opacity-90"
                loading="lazy"
              />
            ) : (
              <div className="h-16 w-full bg-gradient-to-br from-[var(--color-espresso-700)] to-[var(--color-espresso-900)]" />
            )}
            <div className="p-3">
              <p className="text-[10.5px] text-[var(--color-sidebar-foreground)]/65">{summary.label}</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-[17px] font-semibold text-[var(--color-sidebar-foreground-active)] tabular">
                  {summary.value}
                </span>
                {summary.delta ? (
                  <span className="text-[11px] font-medium text-[var(--color-success)] tabular">
                    {summary.delta}
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 text-[10.5px] text-[var(--color-sidebar-foreground)]/55">
                {summary.caption}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
