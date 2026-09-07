import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { Info } from 'lucide-react';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app/app-shell';
import type { NotificationItem } from '@/components/app/notification-center';
import type { SidebarSummary } from '@/components/app/sidebar';
import { env } from '@/config/env';
import { getDb } from '@/db/client';
import { cities, notifications, properties, valuations } from '@/db/schema';
import { getSession } from '@/lib/auth/session';
import { formatCompactCurrency, formatDelta } from '@/lib/format';
import { getRequestLocationId } from '@/lib/locale';

export const dynamic = 'force-dynamic';

async function loadNotifications(
  organizationId: string,
  userId: string,
  userPermissions: string[],
): Promise<{ items: NotificationItem[]; unread: number }> {
  const db = await getDb();

  // A user sees notifications addressed to them, plus broadcasts for any
  // permission they hold — notifications respect permissions (BRD 50).
  const audience = userPermissions.length
    ? or(eq(notifications.userId, userId), inArray(notifications.requiredPermission, userPermissions))
    : eq(notifications.userId, userId);

  const rows = await db
    .select({
      id: notifications.id,
      title: notifications.title,
      body: notifications.body,
      severity: notifications.severity,
      linkHref: notifications.linkHref,
      notificationType: notifications.notificationType,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
    })
    .from(notifications)
    .where(and(eq(notifications.organizationId, organizationId), audience))
    .orderBy(desc(notifications.createdAt))
    .limit(15);

  const [countRow] = await db
    .select({ unread: sql<number>`count(*) filter (where ${notifications.readAt} is null)::int` })
    .from(notifications)
    .where(and(eq(notifications.organizationId, organizationId), audience));

  return {
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      severity: row.severity,
      linkHref: row.linkHref,
      notificationType: row.notificationType,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt ? row.readAt.toISOString() : null,
    })),
    unread: Number(countRow?.unread ?? 0),
  };
}

async function loadSidebarSummary(
  organizationId: string,
  allowedPropertyIds: string[] | null,
): Promise<SidebarSummary | null> {
  const db = await getDb();

  const propertyFilter = allowedPropertyIds?.length
    ? and(eq(properties.organizationId, organizationId), inArray(properties.id, allowedPropertyIds))
    : eq(properties.organizationId, organizationId);

  const [row] = await db
    .select({
      current: sql<number>`coalesce(sum(${valuations.marketValue}) filter (where ${valuations.isCurrent}), 0)::float8`,
      previous: sql<number>`coalesce(sum(${valuations.previousMarketValue}) filter (where ${valuations.isCurrent}), 0)::float8`,
      image: sql<string | null>`min(${properties.coverImageUrl})`,
    })
    .from(valuations)
    .innerJoin(properties, eq(properties.id, valuations.propertyId))
    .where(propertyFilter);

  const current = Number(row?.current ?? 0);
  if (current === 0) return null;
  const previous = Number(row?.previous ?? 0);
  const delta = previous > 0 ? ((current - previous) / previous) * 100 : null;

  return {
    label: 'Total Portfolio Value',
    value: formatCompactCurrency(current),
    caption: `as of ${new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`,
    delta: delta !== null ? formatDelta(delta) : null,
    imageUrl: row?.image ?? null,
  };
}

async function loadLocations(organizationId: string, allowedCityIds: string[] | null) {
  const db = await getDb();
  const filter = allowedCityIds?.length
    ? and(eq(cities.organizationId, organizationId), inArray(cities.id, allowedCityIds))
    : eq(cities.organizationId, organizationId);

  const rows = await db
    .select({ id: cities.id, name: cities.nameEn })
    .from(cities)
    .where(and(filter, eq(cities.isActive, true), isNull(cities.deletedAt)))
    .orderBy(cities.nameEn);

  return rows;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSession();
  if (!user) redirect('/login');

  const allowedPropertyIds = user.scopedPropertyIds.length > 0 ? user.scopedPropertyIds : null;
  const allowedCityIds = user.scopedCityIds.length > 0 ? user.scopedCityIds : null;

  const [notificationData, sidebarSummary, locations, activeLocationId] = await Promise.all([
    loadNotifications(user.organizationId, user.id, user.permissions),
    loadSidebarSummary(user.organizationId, allowedPropertyIds),
    loadLocations(user.organizationId, allowedCityIds),
    getRequestLocationId(),
  ]);

  return (
    <AppShell
      user={{
        fullName: user.fullName,
        roleLabel: user.roleNames[0] ?? user.jobTitle ?? 'User',
        avatarUrl: user.avatarUrl,
        email: user.email,
      }}
      permissions={user.permissions}
      locations={locations}
      activeLocationId={activeLocationId}
      notifications={notificationData.items}
      unreadCount={notificationData.unread}
      sidebarSummary={sidebarSummary}
      demoMode={env.DEMO_MODE}
      demoBanner={<DemoBanner />}
    >
      {children}
    </AppShell>
  );
}

function DemoBanner() {
  return (
    <div className="no-print flex items-start gap-2.5 border-b border-[var(--color-gold-200)] bg-[var(--color-gold-50)] px-4 py-2 lg:px-6">
      <Info className="mt-0.5 size-3.5 shrink-0 text-[var(--color-gold-600)]" aria-hidden />
      <p className="text-[11.5px] leading-4 text-[var(--color-gold-800)]">
        <span className="font-semibold">Demonstration environment.</span> All records are seeded demo
        data. Integrations are not connected and payments are not real financial transactions.
      </p>
    </div>
  );
}
