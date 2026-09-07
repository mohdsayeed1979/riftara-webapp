/**
 * RIFTARA permission catalog — the single source of truth for authorization.
 *
 * Permissions are `module:action` strings. Roles are collections of
 * permissions and are fully editable at runtime from /roles; the definitions
 * below are the seeded defaults, not hard-coded authorization.
 *
 * See docs/RBAC.md for the role/permission matrix.
 */

export const MODULES = [
  'dashboard',
  'properties',
  'buildings',
  'units',
  'pricing',
  'leasing',
  'customers',
  'viewings',
  'proposals',
  'reservations',
  'contracts',
  'tenants',
  'collections',
  'financials',
  'maintenance',
  'assets',
  'marketing',
  'reports',
  'documents',
  'integrations',
  'users',
  'settings',
  'audit',
  'website',
] as const;

export type Module = (typeof MODULES)[number];

export const ACTIONS = [
  'view',
  'create',
  'edit',
  'delete',
  'approve',
  'export',
  'publish',
  'manage',
] as const;

export type Action = (typeof ACTIONS)[number];

export type PermissionKey = `${Module}:${Action}`;

interface PermissionDefinition {
  key: PermissionKey;
  module: Module;
  action: Action;
  description: string;
}

function define(module: Module, actions: Action[], nouns: string): PermissionDefinition[] {
  const verbs: Record<Action, string> = {
    view: `View ${nouns}`,
    create: `Create ${nouns}`,
    edit: `Edit ${nouns}`,
    delete: `Archive ${nouns}`,
    approve: `Approve ${nouns}`,
    export: `Export ${nouns}`,
    publish: `Publish ${nouns}`,
    manage: `Manage ${nouns} configuration`,
  };
  return actions.map((action) => ({
    key: `${module}:${action}` as PermissionKey,
    module,
    action,
    description: verbs[action],
  }));
}

export const PERMISSIONS: PermissionDefinition[] = [
  ...define('dashboard', ['view', 'export'], 'executive dashboards'),
  ...define('properties', ['view', 'create', 'edit', 'delete', 'export', 'publish'], 'properties'),
  ...define('buildings', ['view', 'create', 'edit', 'delete'], 'buildings and floors'),
  ...define('units', ['view', 'create', 'edit', 'delete', 'export', 'publish'], 'units'),
  ...define('pricing', ['view', 'edit', 'approve'], 'unit pricing'),
  ...define('leasing', ['view', 'create', 'edit', 'delete', 'export'], 'leads and the CRM pipeline'),
  ...define('customers', ['view', 'create', 'edit', 'delete', 'export'], 'customers'),
  ...define('viewings', ['view', 'create', 'edit', 'delete'], 'viewings'),
  ...define('proposals', ['view', 'create', 'edit', 'approve', 'export'], 'leasing proposals'),
  ...define('reservations', ['view', 'create', 'edit', 'approve'], 'reservations'),
  ...define('contracts', ['view', 'create', 'edit', 'approve', 'export'], 'lease contracts'),
  ...define('tenants', ['view', 'create', 'edit', 'export'], 'tenants'),
  ...define('collections', ['view', 'create', 'edit', 'approve', 'export'], 'collections and receivables'),
  ...define('financials', ['view', 'create', 'edit', 'approve', 'export'], 'financial records'),
  ...define('maintenance', ['view', 'create', 'edit', 'delete', 'approve', 'export'], 'maintenance work orders'),
  ...define('assets', ['view', 'create', 'edit', 'delete'], 'the asset register'),
  ...define('marketing', ['view', 'create', 'edit', 'export'], 'marketing campaigns'),
  ...define('reports', ['view', 'create', 'export'], 'management reports'),
  ...define('documents', ['view', 'create', 'delete', 'manage'], 'documents'),
  ...define('integrations', ['view', 'manage'], 'integrations'),
  ...define('users', ['view', 'create', 'edit', 'delete', 'manage'], 'users, roles and permissions'),
  ...define('settings', ['view', 'manage'], 'system settings'),
  ...define('audit', ['view', 'export'], 'audit logs'),
  ...define('website', ['view', 'publish', 'manage'], 'website publication'),
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

/** Convenience matcher for role definitions: every permission of a module. */
function all(module: Module): PermissionKey[] {
  return PERMISSIONS.filter((p) => p.module === module).map((p) => p.key);
}

function readOnly(modules: Module[]): PermissionKey[] {
  return modules.map((m) => `${m}:view` as PermissionKey);
}

export interface RoleDefinition {
  key: string;
  nameEn: string;
  nameAr: string;
  description: string;
  permissions: PermissionKey[] | 'all';
}

/** Default roles, seeded once. Administrators may edit or add roles at runtime. */
export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    key: 'super_admin',
    nameEn: 'Super Admin',
    nameAr: 'مدير النظام',
    description: 'Unrestricted access to every module, including user and system administration.',
    permissions: 'all',
  },
  {
    key: 'executive',
    nameEn: 'Executive Management',
    nameAr: 'الإدارة التنفيذية',
    description: 'Portfolio-wide read access with reporting, approvals and export rights.',
    permissions: [
      ...readOnly([
        'dashboard',
        'properties',
        'buildings',
        'units',
        'pricing',
        'leasing',
        'customers',
        'viewings',
        'proposals',
        'reservations',
        'contracts',
        'tenants',
        'collections',
        'financials',
        'maintenance',
        'assets',
        'marketing',
        'reports',
        'documents',
        'audit',
        'website',
      ]),
      'dashboard:export',
      'reports:create',
      'reports:export',
      'pricing:approve',
      'proposals:approve',
      'contracts:approve',
      'financials:approve',
      'collections:export',
      'properties:export',
      'units:export',
    ],
  },
  {
    key: 'asset_manager',
    nameEn: 'Asset Manager',
    nameAr: 'مدير الأصول',
    description: 'Owns asset performance, valuations, budgets and portfolio analysis.',
    permissions: [
      ...readOnly(['dashboard', 'leasing', 'contracts', 'tenants', 'collections', 'marketing', 'audit']),
      ...all('properties'),
      ...all('buildings'),
      ...all('units'),
      ...all('assets'),
      'financials:view',
      'financials:create',
      'financials:edit',
      'financials:export',
      'maintenance:view',
      'maintenance:export',
      'reports:view',
      'reports:create',
      'reports:export',
      'documents:view',
      'documents:create',
      'pricing:view',
      'pricing:edit',
    ],
  },
  {
    key: 'property_manager',
    nameEn: 'Property Manager',
    nameAr: 'مدير العقارات',
    description: 'Day-to-day operation of assigned properties: units, maintenance and tenants.',
    permissions: [
      'dashboard:view',
      ...all('properties').filter((p) => p !== 'properties:delete'),
      ...all('buildings'),
      ...all('units').filter((p) => p !== 'units:delete'),
      'pricing:view',
      'pricing:edit',
      ...all('maintenance').filter((p) => p !== 'maintenance:delete'),
      ...all('assets'),
      ...readOnly(['leasing', 'contracts', 'collections', 'customers']),
      'tenants:view',
      'tenants:edit',
      'documents:view',
      'documents:create',
      'reports:view',
      'reports:export',
      'financials:view',
    ],
  },
  {
    key: 'leasing_manager',
    nameEn: 'Leasing Manager',
    nameAr: 'مدير التأجير',
    description: 'Runs the leasing pipeline and approves standard pricing exceptions.',
    permissions: [
      'dashboard:view',
      ...readOnly(['properties', 'buildings']),
      ...all('units').filter((p) => p !== 'units:delete'),
      ...all('pricing'),
      ...all('leasing'),
      ...all('customers'),
      ...all('viewings'),
      ...all('proposals'),
      ...all('reservations'),
      'contracts:view',
      'contracts:create',
      'contracts:edit',
      'contracts:export',
      'tenants:view',
      'tenants:create',
      'tenants:edit',
      'documents:view',
      'documents:create',
      'reports:view',
      'reports:export',
      'marketing:view',
      'website:view',
      'website:publish',
    ],
  },
  {
    key: 'leasing_agent',
    nameEn: 'Leasing Agent',
    nameAr: 'موظف تأجير',
    description: 'Works assigned leads, books viewings and drafts proposals.',
    permissions: [
      'dashboard:view',
      ...readOnly(['properties', 'buildings', 'contracts', 'tenants']),
      'units:view',
      'pricing:view',
      'leasing:view',
      'leasing:create',
      'leasing:edit',
      'customers:view',
      'customers:create',
      'customers:edit',
      ...all('viewings'),
      'proposals:view',
      'proposals:create',
      'proposals:edit',
      'reservations:view',
      'reservations:create',
      'documents:view',
      'documents:create',
    ],
  },
  {
    key: 'finance',
    nameEn: 'Finance',
    nameAr: 'المالية',
    description: 'Owns invoicing, payments, budgets and financial reporting.',
    permissions: [
      'dashboard:view',
      ...readOnly(['properties', 'units', 'leasing', 'maintenance', 'assets']),
      ...all('financials'),
      ...all('collections'),
      ...all('contracts').filter((p) => p !== 'contracts:create'),
      ...readOnly(['tenants']),
      'tenants:edit',
      'tenants:export',
      'reports:view',
      'reports:create',
      'reports:export',
      'documents:view',
      'documents:create',
      'audit:view',
    ],
  },
  {
    key: 'collections_officer',
    nameEn: 'Collections Officer',
    nameAr: 'مسؤول التحصيل',
    description: 'Pursues receivables through the reminder-to-legal escalation workflow.',
    permissions: [
      'dashboard:view',
      ...readOnly(['properties', 'units', 'contracts']),
      'collections:view',
      'collections:create',
      'collections:edit',
      'collections:export',
      'financials:view',
      'financials:create',
      'tenants:view',
      'tenants:export',
      'customers:view',
      'documents:view',
      'reports:view',
      'reports:export',
    ],
  },
  {
    key: 'maintenance_manager',
    nameEn: 'Maintenance Manager',
    nameAr: 'مدير الصيانة',
    description: 'Plans preventive maintenance, assigns vendors and controls maintenance spend.',
    permissions: [
      'dashboard:view',
      ...readOnly(['properties', 'buildings', 'units', 'tenants']),
      ...all('maintenance'),
      ...all('assets'),
      'financials:view',
      'financials:create',
      'documents:view',
      'documents:create',
      'reports:view',
      'reports:export',
    ],
  },
  {
    key: 'maintenance_staff',
    nameEn: 'Maintenance Staff',
    nameAr: 'فني صيانة',
    description: 'Executes assigned work orders and records completion details.',
    permissions: [
      'dashboard:view',
      'properties:view',
      'units:view',
      'maintenance:view',
      'maintenance:edit',
      'assets:view',
      'documents:view',
      'documents:create',
    ],
  },
  {
    key: 'marketing_manager',
    nameEn: 'Marketing Manager',
    nameAr: 'مدير التسويق',
    description: 'Owns campaigns, attribution and website publication.',
    permissions: [
      'dashboard:view',
      ...readOnly(['properties', 'units', 'leasing', 'customers']),
      ...all('marketing'),
      ...all('website'),
      'documents:view',
      'documents:create',
      'reports:view',
      'reports:export',
      'integrations:view',
    ],
  },
  {
    key: 'auditor',
    nameEn: 'Auditor',
    nameAr: 'مدقق',
    description: 'Read-only access across the platform plus full audit-trail visibility.',
    permissions: [
      ...readOnly([
        'dashboard',
        'properties',
        'buildings',
        'units',
        'pricing',
        'leasing',
        'customers',
        'viewings',
        'proposals',
        'reservations',
        'contracts',
        'tenants',
        'collections',
        'financials',
        'maintenance',
        'assets',
        'marketing',
        'reports',
        'documents',
        'integrations',
        'settings',
        'website',
      ]),
      'audit:view',
      'audit:export',
      'reports:export',
    ],
  },
  {
    key: 'read_only',
    nameEn: 'Read Only',
    nameAr: 'اطلاع فقط',
    description: 'Operational visibility with no ability to change data.',
    permissions: readOnly([
      'dashboard',
      'properties',
      'buildings',
      'units',
      'leasing',
      'customers',
      'contracts',
      'tenants',
      'collections',
      'maintenance',
      'reports',
      'documents',
    ]),
  },
];

export function resolveRolePermissions(role: RoleDefinition): PermissionKey[] {
  if (role.permissions === 'all') return PERMISSION_KEYS;
  return Array.from(new Set(role.permissions));
}
