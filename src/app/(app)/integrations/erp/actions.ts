'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/guard';
import { actionFailure, actionSuccess, type ActionResult } from '@/lib/errors';
import { processPendingEvents, reconcile, retryEvent, type ReconciliationReport } from '@/integrations/erp/erp-service';

export async function processErpEventsAction(): Promise<ActionResult<{ processed: number; succeeded: number; failed: number }>> {
  try {
    const user = await requirePermission('erp_integration:manage');
    const result = await processPendingEvents({ id: user.id, organizationId: user.organizationId, fullName: user.fullName });
    revalidatePath('/integrations/erp');
    return actionSuccess(result);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function retryErpEventAction(eventId: string): Promise<ActionResult<null>> {
  try {
    const user = await requirePermission('erp_integration:retry');
    await retryEvent({ id: user.id, organizationId: user.organizationId, fullName: user.fullName }, eventId);
    revalidatePath('/integrations/erp');
    return actionSuccess(null);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function reconcileErpAction(): Promise<ActionResult<ReconciliationReport>> {
  try {
    const user = await requirePermission('erp_integration:reconcile');
    const report = await reconcile({ id: user.id, organizationId: user.organizationId, fullName: user.fullName });
    revalidatePath('/integrations/erp');
    return actionSuccess(report);
  } catch (error) {
    return actionFailure(error);
  }
}
