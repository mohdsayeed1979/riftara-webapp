import type { Metadata } from 'next';
import Link from 'next/link';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { notifications } from '@/db/schema';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/page';
import { requireUser } from '@/lib/auth/guard';
import { formatRelativeTime } from '@/lib/format';
import { getRequestLocale } from '@/lib/locale';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

const SEVERITY_DOT: Record<string, string> = {
  info: 'bg-[var(--color-info)]',
  success: 'bg-[var(--color-success)]',
  warning: 'bg-[var(--color-warning)]',
  error: 'bg-[var(--color-error)]',
};

export default async function NotificationsPage() {
  const user = await requireUser();
  const locale = await getRequestLocale();
  const db = await getDb();

  const audience = user.permissions.length
    ? or(eq(notifications.userId, user.id), inArray(notifications.requiredPermission, user.permissions))
    : eq(notifications.userId, user.id);

  const rows = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.organizationId, user.organizationId), audience))
    .orderBy(desc(notifications.createdAt))
    .limit(60);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Notifications" subtitle="Alerts and reminders relevant to your role." />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="You are all caught up" description="New notifications will appear here." />
        ) : (
          <ul className="divide-y divide-[var(--color-border-subtle)]">
            {rows.map((notification) => {
              const body = (
                <div className={cn('flex gap-3 px-5 py-3.5 transition-colors hover:bg-[var(--color-surface-muted)]', !notification.readAt && 'bg-[var(--color-gold-50)]/40')}>
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', SEVERITY_DOT[notification.severity] ?? SEVERITY_DOT.info)} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-[var(--color-text-primary)]">{notification.title}</p>
                    {notification.body ? <p className="mt-0.5 text-[12px] text-[var(--color-text-secondary)]">{notification.body}</p> : null}
                    <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">{formatRelativeTime(notification.createdAt, { locale })}</p>
                  </div>
                </div>
              );
              return (
                <li key={notification.id}>
                  {notification.linkHref ? <Link href={notification.linkHref}>{body}</Link> : body}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
