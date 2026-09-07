'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { and, desc, eq, ilike, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { requirePermission } from '@/lib/auth/guard';
import { actionFailure, actionSuccess, type ActionResult } from '@/lib/errors';
import { recordPayment } from '@/services/collection-service';

const schema = z.object({
  tenantId: z.string().uuid('Select a tenant.'),
  amount: z.coerce.number().positive('Enter an amount greater than zero.'),
  paymentDate: z.string().min(1, 'Select a payment date.'),
  method: z.string().min(1),
  referenceNumber: z.string().optional(),
  bankName: z.string().optional(),
  notes: z.string().optional(),
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
