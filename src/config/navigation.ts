import type { LucideIcon } from 'lucide-react';
import {
  Banknote,
  Blocks,
  Building2,
  ClipboardList,
  FileText,
  Home,
  LayoutGrid,
  Megaphone,
  Settings,
  ShieldCheck,
  Users,
  UsersRound,
  Wrench,
} from 'lucide-react';
import type { PermissionKey } from '@/lib/permissions/catalog';

export interface NavItem {
  key: string;
  href: string;
  labelKey: string;
  icon: LucideIcon;
  permission: PermissionKey;
  /** Additional path prefixes that should keep this item highlighted. */
  matches?: string[];
}

export interface NavGroup {
  key: string;
  labelKey: string;
  items: NavItem[];
}

/**
 * Primary navigation. Items are filtered by permission at render time, so a
 * user never sees a destination they cannot open.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'portfolio',
    labelKey: 'nav.groupPortfolio',
    items: [
      {
        key: 'dashboard',
        href: '/dashboard',
        labelKey: 'nav.dashboard',
        icon: Home,
        permission: 'dashboard:view',
      },
      {
        key: 'properties',
        href: '/properties',
        labelKey: 'nav.properties',
        icon: Building2,
        permission: 'properties:view',
        matches: ['/properties', '/buildings'],
      },
      {
        key: 'units',
        href: '/units',
        labelKey: 'nav.units',
        icon: LayoutGrid,
        permission: 'units:view',
      },
    ],
  },
  {
    key: 'leasing',
    labelKey: 'nav.groupLeasing',
    items: [
      {
        key: 'leasing',
        href: '/leasing',
        labelKey: 'nav.leasingCrm',
        icon: UsersRound,
        permission: 'leasing:view',
        matches: ['/leasing'],
      },
      {
        key: 'customers',
        href: '/leasing/customers',
        labelKey: 'nav.customers',
        icon: UsersRound,
        permission: 'customers:view',
        matches: ['/leasing/customers'],
      },
      {
        key: 'contracts',
        href: '/contracts',
        labelKey: 'nav.contracts',
        icon: FileText,
        permission: 'contracts:view',
      },
      {
        key: 'tenants',
        href: '/tenants',
        labelKey: 'nav.tenants',
        icon: Users,
        permission: 'tenants:view',
      },
    ],
  },
  {
    key: 'finance',
    labelKey: 'nav.groupFinance',
    items: [
      {
        key: 'collections',
        href: '/collections',
        labelKey: 'nav.collections',
        icon: Banknote,
        permission: 'collections:view',
      },
      {
        key: 'financials',
        href: '/financials',
        labelKey: 'nav.financials',
        icon: ClipboardList,
        permission: 'financials:view',
      },
    ],
  },
  {
    key: 'operations',
    labelKey: 'nav.groupOperations',
    items: [
      {
        key: 'maintenance',
        href: '/maintenance',
        labelKey: 'nav.maintenance',
        icon: Wrench,
        permission: 'maintenance:view',
      },
      {
        key: 'assets',
        href: '/assets',
        labelKey: 'nav.assets',
        icon: ShieldCheck,
        permission: 'assets:view',
      },
    ],
  },
  {
    key: 'insight',
    labelKey: 'nav.groupInsight',
    items: [
      {
        key: 'reports',
        href: '/reports',
        labelKey: 'nav.reports',
        icon: FileText,
        permission: 'reports:view',
      },
      {
        key: 'marketing',
        href: '/marketing',
        labelKey: 'nav.marketing',
        icon: Megaphone,
        permission: 'marketing:view',
      },
    ],
  },
  {
    key: 'administration',
    labelKey: 'nav.groupAdministration',
    items: [
      {
        key: 'integrations',
        href: '/integrations',
        labelKey: 'nav.integrations',
        icon: Blocks,
        permission: 'integrations:view',
      },
      {
        key: 'users',
        href: '/users',
        labelKey: 'nav.usersPermissions',
        icon: Users,
        permission: 'users:view',
        matches: ['/users', '/roles', '/permissions'],
      },
      {
        key: 'settings',
        href: '/settings',
        labelKey: 'nav.settings',
        icon: Settings,
        permission: 'settings:view',
      },
    ],
  },
];

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  const candidates = item.matches ?? [item.href];
  return candidates.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
