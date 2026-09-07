'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { TooltipProvider } from '@/components/ui/misc';
import type { PermissionKey } from '@/lib/permissions/catalog';
import { cn } from '@/lib/utils';
import { AppHeader, type HeaderLocation } from './header';
import type { NotificationItem } from './notification-center';
import { Sidebar, type SidebarSummary } from './sidebar';

const COLLAPSE_STORAGE_KEY = 'riftara.sidebar.collapsed';

export function AppShell({
  user,
  permissions,
  locations,
  activeLocationId,
  notifications,
  unreadCount,
  sidebarSummary,
  demoMode,
  demoBanner,
  children,
}: {
  user: { fullName: string; roleLabel: string; avatarUrl: string | null; email: string };
  permissions: PermissionKey[];
  locations: HeaderLocation[];
  activeLocationId: string | null;
  notifications: NotificationItem[];
  unreadCount: number;
  sidebarSummary: SidebarSummary | null;
  demoMode: boolean;
  demoBanner: ReactNode;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Sidebar width is a per-viewer convenience, so localStorage is the right home.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === 'true');
    } catch {
      /* private browsing or blocked storage — keep the default */
    }
  }, []);

  function toggleSidebar() {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex min-h-screen w-full bg-[var(--color-canvas)]">
        <aside
          className={cn(
            'sticky top-0 hidden h-screen shrink-0 shadow-[var(--shadow-sidebar)] transition-[width] duration-200 lg:block',
            collapsed ? 'w-[68px]' : 'w-[232px]',
          )}
        >
          <Sidebar permissions={permissions} collapsed={collapsed} summary={sidebarSummary} />
        </aside>

        <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <DialogContent
            side="end"
            size="sm"
            hideClose
            className="start-0 end-auto w-[260px] max-w-[80vw] border-e border-s-0 p-0"
          >
            <div className="sr-only">Navigation</div>
            <Sidebar
              permissions={permissions}
              collapsed={false}
              summary={sidebarSummary}
              onNavigate={() => setMobileNavOpen(false)}
            />
          </DialogContent>
        </Dialog>

        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader
            user={user}
            locations={locations}
            activeLocationId={activeLocationId}
            notifications={notifications}
            unreadCount={unreadCount}
            onToggleSidebar={toggleSidebar}
            onOpenMobileNav={() => setMobileNavOpen(true)}
            sidebarCollapsed={collapsed}
          />
          {demoMode ? demoBanner : null}
          <main className="min-w-0 flex-1 px-4 py-5 lg:px-6 lg:py-6">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}
