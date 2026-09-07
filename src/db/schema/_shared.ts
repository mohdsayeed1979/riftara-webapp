import { sql } from 'drizzle-orm';
import { boolean, numeric, pgEnum, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Primary key. Business-visible codes are never used as primary keys (BRD §58). */
export const pk = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);

/** Money in SAR. numeric(18,2) keeps financial arithmetic exact. */
export const money = (name: string) => numeric(name, { precision: 18, scale: 2, mode: 'number' });
/** Area in square metres. */
export const area = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' });
/** Percentage stored as 0-100 with 4 decimals. */
export const percent = (name: string) => numeric(name, { precision: 9, scale: 4, mode: 'number' });

export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/**
 * Soft-delete marker. Financial and legal records (contracts, invoices,
 * payments, audit) are NEVER hard-deleted — BR-012 / BR-013.
 */
export const timestamps = {
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
};

/** Marks rows produced by the demo seed so demo data is never mistaken for real data (§65). */
export const isDemo = () => boolean('is_demo').notNull().default(false);

// ---------------------------------------------------------------------------
// Fixed state machines (not user-configurable, therefore native enums)
// ---------------------------------------------------------------------------

export const approvalStatusEnum = pgEnum('approval_status', [
  'draft',
  'pending',
  'approved',
  'rejected',
  'returned',
  'cancelled',
]);

export const contractStatusEnum = pgEnum('contract_status', [
  'draft',
  'pending_approval',
  'issued',
  'signed',
  'active',
  'expired',
  'terminated',
  'renewal_pending',
]);

export const invoiceStatusEnum = pgEnum('invoice_status', [
  'upcoming',
  'due',
  'paid',
  'partially_paid',
  'overdue',
  'cancelled',
  'waived',
]);

export const reservationStatusEnum = pgEnum('reservation_status', [
  'pending',
  'active',
  'converted',
  'expired',
  'cancelled',
]);

export const viewingStatusEnum = pgEnum('viewing_status', [
  'scheduled',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
  'rescheduled',
]);

export const workOrderStatusEnum = pgEnum('work_order_status', [
  'open',
  'assigned',
  'in_progress',
  'pending',
  'completed',
  'cancelled',
]);

export const priorityEnum = pgEnum('priority_level', ['low', 'medium', 'high', 'critical']);

export const maintenanceTypeEnum = pgEnum('maintenance_type', [
  'preventive',
  'corrective',
  'emergency',
  'inspection',
  'renovation',
  'unit_turnaround',
]);

export const paymentFrequencyEnum = pgEnum('payment_frequency', [
  'monthly',
  'quarterly',
  'semi_annual',
  'annual',
  'custom',
]);

export const auditActionEnum = pgEnum('audit_action', [
  'create',
  'update',
  'delete',
  'soft_delete',
  'restore',
  'approve',
  'reject',
  'publish',
  'unpublish',
  'login',
  'login_failed',
  'logout',
  'export',
  'import',
  'sign',
  'allocate',
  'sync',
]);

export const integrationStatusEnum = pgEnum('integration_status', [
  'not_connected',
  'configuration_required',
  'connected',
  'error',
]);

export const ownerTypeEnum = pgEnum('owner_type', ['individual', 'entity']);
export const customerTypeEnum = pgEnum('customer_type', ['individual', 'corporate']);
export const proposalStatusEnum = pgEnum('proposal_status', [
  'draft',
  'pending_approval',
  'approved',
  'sent',
  'accepted',
  'rejected',
  'expired',
  'superseded',
]);
export const collectionActionTypeEnum = pgEnum('collection_action_type', [
  'reminder',
  'follow_up',
  'escalation',
  'formal_notice',
  'legal_review',
  'payment_plan',
  'resolved',
]);
export const publicationStateEnum = pgEnum('publication_state', ['unpublished', 'published', 'featured']);
