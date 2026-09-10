import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { auditActionEnum, isDemo, pk, timestamps } from './_shared';

export const organizations = pgTable('organizations', {
  id: pk(),
  code: varchar('code', { length: 32 }).notNull().unique(),
  nameEn: varchar('name_en', { length: 200 }).notNull(),
  nameAr: varchar('name_ar', { length: 200 }),
  legalName: varchar('legal_name', { length: 200 }),
  commercialRegistration: varchar('commercial_registration', { length: 40 }),
  vatNumber: varchar('vat_number', { length: 40 }),
  defaultCurrency: varchar('default_currency', { length: 3 }).notNull().default('SAR'),
  defaultLocale: varchar('default_locale', { length: 5 }).notNull().default('en'),
  timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Riyadh'),
  vatRateBps: integer('vat_rate_bps').notNull().default(1500),
  logoUrl: text('logo_url'),
  addressLine: text('address_line'),
  phone: varchar('phone', { length: 32 }),
  email: varchar('email', { length: 160 }),
  ...timestamps,
});

export const users = pgTable(
  'users',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    email: varchar('email', { length: 160 }).notNull(),
    passwordHash: text('password_hash'),
    fullName: varchar('full_name', { length: 160 }).notNull(),
    fullNameAr: varchar('full_name_ar', { length: 160 }),
    jobTitle: varchar('job_title', { length: 120 }),
    phone: varchar('phone', { length: 32 }),
    avatarUrl: text('avatar_url'),
    locale: varchar('locale', { length: 5 }).notNull().default('en'),
    isActive: boolean('is_active').notNull().default(true),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    externalAuthId: varchar('external_auth_id', { length: 128 }),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    unique('users_org_email_uq').on(t.organizationId, t.email),
    index('users_email_idx').on(t.email),
    index('users_org_idx').on(t.organizationId),
  ],
);

/**
 * Per-user TOTP enrollment (BRD §148-149). One row per user. The secret is
 * stored AES-256-GCM-encrypted (never in clear); `activatedAt` stays null until
 * the user proves possession with a valid code, at which point `users.mfa_enabled`
 * is set true. Disabling MFA deletes the row (and its recovery codes via cascade).
 */
export const userMfa = pgTable(
  'user_mfa',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    encryptedSecret: text('encrypted_secret').notNull(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [unique('user_mfa_user_uq').on(t.userId), index('user_mfa_org_idx').on(t.organizationId)],
);

/** One-time recovery codes, stored only as SHA-256 hashes; `usedAt` marks a code consumed. */
export const mfaRecoveryCodes = pgTable(
  'mfa_recovery_codes',
  {
    id: pk(),
    userMfaId: uuid('user_mfa_id')
      .notNull()
      .references(() => userMfa.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (t) => [index('mfa_recovery_codes_mfa_idx').on(t.userMfaId)],
);

export const roles = pgTable(
  'roles',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: varchar('key', { length: 64 }).notNull(),
    nameEn: varchar('name_en', { length: 120 }).notNull(),
    nameAr: varchar('name_ar', { length: 120 }),
    description: text('description'),
    isSystem: boolean('is_system').notNull().default(false),
    ...timestamps,
  },
  (t) => [unique('roles_org_key_uq').on(t.organizationId, t.key)],
);

export const permissions = pgTable(
  'permissions',
  {
    id: pk(),
    key: varchar('key', { length: 96 }).notNull().unique(),
    module: varchar('module', { length: 48 }).notNull(),
    action: varchar('action', { length: 48 }).notNull(),
    description: text('description'),
    createdAt: timestamps.createdAt,
  },
  (t) => [index('permissions_module_idx').on(t.module)],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    unique('role_permissions_uq').on(t.roleId, t.permissionId),
    index('role_permissions_role_idx').on(t.roleId),
  ],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    createdAt: timestamps.createdAt,
  },
  (t) => [unique('user_roles_uq').on(t.userId, t.roleId), index('user_roles_user_idx').on(t.userId)],
);

/**
 * Data-level permissions (BRD 126). A user with no scope rows sees the whole
 * organization; scope rows narrow visibility to specific cities or properties.
 */
export const userScopes = pgTable(
  'user_scopes',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scopeType: varchar('scope_type', { length: 24 }).notNull(),
    scopeId: uuid('scope_id').notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    unique('user_scopes_uq').on(t.userId, t.scopeType, t.scopeId),
    index('user_scopes_user_idx').on(t.userId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 128 }).notNull().unique(),
    ipAddress: varchar('ip_address', { length: 64 }),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: pk(),
    email: varchar('email', { length: 160 }).notNull(),
    successful: boolean('successful').notNull(),
    ipAddress: varchar('ip_address', { length: 64 }),
    userAgent: text('user_agent'),
    reason: varchar('reason', { length: 120 }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index('login_attempts_email_idx').on(t.email),
    index('login_attempts_created_idx').on(t.createdAt),
  ],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    prefix: varchar('prefix', { length: 16 }).notNull(),
    keyHash: varchar('key_hash', { length: 128 }).notNull().unique(),
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    rateLimitPerMinute: integer('rate_limit_per_minute').notNull().default(120),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index('api_keys_org_idx').on(t.organizationId)],
);

/**
 * Immutable audit trail (BRD 136, BR-017). Append-only: the application layer
 * never issues UPDATE or DELETE against this table.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    actorLabel: varchar('actor_label', { length: 160 }),
    action: auditActionEnum('action').notNull(),
    entityType: varchar('entity_type', { length: 64 }).notNull(),
    entityId: uuid('entity_id'),
    entityLabel: varchar('entity_label', { length: 200 }),
    previousValue: jsonb('previous_value'),
    newValue: jsonb('new_value'),
    changedFields: jsonb('changed_fields').$type<string[]>(),
    reason: text('reason'),
    approvalReference: varchar('approval_reference', { length: 64 }),
    ipAddress: varchar('ip_address', { length: 64 }),
    device: text('device'),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
    index('audit_logs_org_created_idx').on(t.organizationId, t.createdAt),
    index('audit_logs_user_idx').on(t.userId),
    index('audit_logs_action_idx').on(t.action),
  ],
);

export const usersRelations = relations(users, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [users.organizationId],
    references: [organizations.id],
  }),
  userRoles: many(userRoles),
  scopes: many(userScopes),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  rolePermissions: many(rolePermissions),
  userRoles: many(userRoles),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
}));

export const userScopesRelations = relations(userScopes, ({ one }) => ({
  user: one(users, { fields: [userScopes.userId], references: [users.id] }),
}));
