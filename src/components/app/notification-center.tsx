'use client';

import { Bell, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useI18n } from '@/i18n/provider';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface NotificationItem {
  id: string;
  title: string;
  body: string | null;
  severity: string;
  linkHref: string | null;
  notificationType: string;
  createdAt: string;
  readAt: string | null;
}

const SEVERITY_DOT: Record<string, string> = {
  info: 'bg-[var(--color-info)]',
  success: 'bg-[var(--color-success)]',
  warning: 'bg-[var(--color-warning)]',
  error: 'bg-[var(--color-error)]',
};

export function NotificationBell({
  notifications,
  unreadCount,
}: {
  notifications: NotificationItem[];
  unreadCount: number;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  async function markAllRead() {
    await fetch('/api/v1/notifications/read-all', { method: 'POST' });
    startTransition(() => router.refresh());
  }

  async function markRead(id: string) {
    await fetch(`/api/v1/notifications/${id}/read`, { method: 'POST' });
    startTransition(() => router.refresh());
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={t('header.notifications')}>
          <Bell />
          {unreadCount > 0 ? (
            <span className="absolute -end-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-[var(--color-error)] px-1 text-[9.5px] font-semibold text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[22rem] p-0">
        <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-3.5 py-2.5">
          <p className="text-[13px] font-semibold text-[var(--color-text-primary)]">
            {t('header.notifications')}
          </p>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={() => void markAllRead()}
              className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--color-info)] hover:underline"
            >
              <CheckCheck className="size-3.5" aria-hidden />
              {t('header.markAllRead')}
            </button>
          ) : null}
        </div>

        <div className="max-h-96 overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="px-4 py-10 text-center text-[12.5px] text-[var(--color-text-secondary)]">
              {t('header.noNotifications')}
            </p>
          ) : (
            notifications.map((notification) => {
              const body = (
                <div
                  className={cn(
                    'flex gap-2.5 border-b border-[var(--color-border-subtle)] px-3.5 py-3 transition-colors last:border-b-0 hover:bg-[var(--color-surface-muted)]',
                    !notification.readAt && 'bg-[var(--color-gold-50)]/60',
                  )}
                >
                  <span
                    className={cn(
                      'mt-1.5 size-1.5 shrink-0 rounded-full',
                      SEVERITY_DOT[notification.severity] ?? SEVERITY_DOT.info,
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-medium text-[var(--color-text-primary)]">
                      {notification.title}
                    </p>
                    {notification.body ? (
                      <p className="mt-0.5 line-clamp-2 text-[11.5px] text-[var(--color-text-secondary)]">
                        {notification.body}
                      </p>
                    ) : null}
                    <p className="mt-1 text-[10.5px] text-[var(--color-text-tertiary)]">
                      {formatRelativeTime(notification.createdAt, { locale })}
                    </p>
                  </div>
                </div>
              );

              return notification.linkHref ? (
                <Link
                  key={notification.id}
                  href={notification.linkHref}
                  onClick={() => {
                    setOpen(false);
                    if (!notification.readAt) void markRead(notification.id);
                  }}
                  className="block"
                >
                  {body}
                </Link>
              ) : (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => void markRead(notification.id)}
                  className="block w-full text-start"
                >
                  {body}
                </button>
              );
            })
          )}
        </div>

        <div className="border-t border-[var(--color-border-subtle)] px-3.5 py-2">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="text-[12px] font-medium text-[var(--color-info)] hover:underline"
          >
            {t('common.viewAll')}
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
