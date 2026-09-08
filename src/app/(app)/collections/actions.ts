'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { and, asc, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { invoices, tenants } from '@/db/schema';
import { requirePermission } from '@/lib/auth/guard';
import { actionFailure, actionSuccess, type ActionResult } from '@/lib/errors';
import { isUuid } from '@/lib/utils';
import {
  generateDueInvoices,
  generateInvoiceFromSchedule,
  generateOverdueNotifications,
  recordCollectionAction,
  recordPayment,
} from '@/services/collection-service';

const schema = z.object({
  tenantId: z.string().uuid('Select a tenant.'),
  amount: z.coerce.number().positive('Enter an amount greater than zero.'),
  paymentDate: z.string().min(1, 'Select a payment date.'),
  method: z.string().min(1),
  referenceNumber: z.string().optional(),
  bankName: z.string().optional(),
  notes: z.string().optional(),
  invoiceId: z.string().uuid('Select a valid invoice.').optional(),
});

export interface RecordPaymentResult {
  paymentNumber: string;
  allocated: number;
  unallocated: number;
}

export async function recordPaymentAction(
  _previous: ActionResult<RecordPaymentResult> | null,
  formData: FormData,
): Promise<ActionResult<RecordPaymentResult>> {
  try {
    const user = await requirePermission('collections:create');
    const parsed = schema.safeParse({
      tenantId: formData.get('tenantId'),
      amount: formData.get('amount'),
      paymentDate: formData.get('paymentDate'),
      method: formData.get('method'),
      referenceNumber: formData.get('referenceNumber') || undefined,
      bankName: formData.get('bankName') || undefined,
      notes: formData.get('notes') || undefined,
      invoiceId: formData.get('invoiceId') || undefined,
    });

    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        (fieldErrors[String(issue.path[0])] ??= []).push(issue.message);
      }
      return { ok: false, error: { code: 'VALIDATION', message: 'Check the payment details.' }, fieldErrors };
    }

    const result = await recordPayment(user, parsed.data);
    revalidatePath('/collections');
    return actionSuccess({
      paymentNumber: result.paymentNumber,
      allocated: result.allocated,
      unallocated: result.unallocated,
    });
  } catch (error) {
    return actionFailure(error);
  }
}

/** Tenant options for the record-payment dialog. */
export async function searchTenantsAction(query: string): Promise<Array<{ id: string; label: string; outstanding: number }>> {
  const user = await requirePermission('collections:view');
  const db = await getDb();

  const rows = await db
    .select({
      id: tenants.id,
      name: tenants.displayName,
      outstanding: sql<number>`coalesce((
        select sum(i.balance_amount) from invoices i
        where i.tenant_id = ${tenants.id} and i.status in ('due','overdue','partially_paid')
      ), 0)::float8`,
    })
    .from(tenants)
    .where(
      and(
        eq(tenants.organizationId, user.organizationId),
        isNull(tenants.deletedAt),
        query ? ilike(tenants.displayName, `%${query}%`) : undefined,
      ),
    )
    .orderBy(desc(sql`coalesce((select sum(i.balance_amount) from invoices i where i.tenant_id = ${tenants.id} and i.status in ('due','overdue','partially_paid')), 0)`))
    .limit(20);

  return rows.map((row) => ({ id: row.id, label: row.name, outstanding: Number(row.outstanding) }));
}

/** Open invoices for a tenant, for the targeted-allocation picker. */
export async function listOpenInvoicesForTenantAction(
  tenantId: string,
): Promise<Array<{ id: string; label: string; balance: number; dueDate: string }>> {
  const user = await requirePermission('collections:view');
  if (!isUuid(tenantId)) return [];
  const db = await getDb();
  const rows = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      balance: invoices.balanceAmount,
      dueDate: invoices.dueDate,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, user.organizationId),
        eq(invoices.tenantId, tenantId),
        inArray(invoices.status, ['due', 'overdue', 'partially_paid']),
        isNull(invoices.deletedAt),
      ),
    )
    .orderBy(asc(invoices.dueDate))
    .limit(50);
  return rows.map((row) => ({
    id: row.id,
    label: row.invoiceNumber,
    balance: Number(row.balance),
    dueDate: row.dueDate,
  }));
}

export interface GenerateInvoiceResult {
  invoiceId: string;
  invoiceNumber: string;
  alreadyExisted: boolean;
}

/** Generate a single invoice from an authoritative payment-schedule installment. */
export async function generateInvoiceAction(scheduleId: string): Promise<ActionResult<GenerateInvoiceResult>> {
  try {
    if (!isUuid(scheduleId)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Schedule not found.' } };
    const user = await requirePermission('collections:create');
    const result = await generateInvoiceFromSchedule(user, scheduleId);
    revalidatePath('/collections/invoices/generate');
    revalidatePath('/collections');
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

/** Bulk-generate invoices for all due installments in the caller's scope. */
export async function generateDueInvoicesAction(): Promise<ActionResult<{ generated: number }>> {
  try {
    const user = await requirePermission('collections:create');
    const allowedPropertyIds = user.scopedPropertyIds.length ? user.scopedPropertyIds : null;
    const result = await generateDueInvoices(user, { allowedPropertyIds });
    revalidatePath('/collections/invoices/generate');
    revalidatePath('/collections');
    return actionSuccess({ generated: result.generated });
  } catch (error) {
    return actionFailure(error);
  }
}

const collectionActionSchema = z.object({
  tenantId: z.string().uuid('Select a tenant.'),
  invoiceId: z.string().uuid().optional(),
  actionType: z.enum(['reminder', 'follow_up', 'escalation', 'formal_notice', 'legal_review', 'payment_plan', 'resolved']),
  outstandingAmount: z.coerce.number().nonnegative(),
  daysOverdue: z.coerce.number().int().nonnegative(),
  notes: z.string().max(2000).optional(),
  outcome: z.string().max(160).optional(),
  nextActionDate: z.string().optional(),
});

/** Log a dunning / collection workflow action against a tenant. */
export async function recordCollectionActionAction(
  input: z.input<typeof collectionActionSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission('collections:edit');
    const parsed = collectionActionSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Check the collection action details.' } };
    }
    // Confirm the tenant belongs to the caller's organization before writing.
    const db = await getDb();
    const [tenant] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.id, parsed.data.tenantId), eq(tenants.organizationId, user.organizationId), isNull(tenants.deletedAt)))
      .limit(1);
    if (!tenant) return { ok: false, error: { code: 'NOT_FOUND', message: 'Tenant not found.' } };

    const result = await recordCollectionAction(user, parsed.data);
    revalidatePath('/collections/dunning');
    if (parsed.data.invoiceId) revalidatePath(`/collections/invoices/${parsed.data.invoiceId}`);
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

/** In-app trigger for the idempotent overdue-notification run (also available
 *  as POST /api/v1/collections/notifications/run for scheduled invocation). */
export async function runOverdueNotificationsAction(): Promise<
  ActionResult<{ scanned: number; markedOverdue: number; notificationsCreated: number }>
> {
  try {
    const user = await requirePermission('collections:edit');
    const result = await generateOverdueNotifications({
      id: user.id,
      organizationId: user.organizationId,
      fullName: user.fullName,
    });
    revalidatePath('/collections/dunning');
    revalidatePath('/collections');
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}
