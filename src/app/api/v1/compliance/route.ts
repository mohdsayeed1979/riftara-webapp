import type { NextRequest } from 'next/server';
import { authenticateRequest, enforceRateLimit } from '@/lib/api/guard';
import { apiError, apiSuccess } from '@/lib/api/response';
import { AppError } from '@/lib/errors';
import {
  getComplianceItems,
  isComplianceCategory,
  COMPLIANCE_STATUSES,
  MAX_WINDOW_DAYS,
  type ComplianceStatusFilter,
} from '@/services/compliance-service';
import type { PermissionKey } from '@/lib/permissions/catalog';

export const dynamic = 'force-dynamic';

const COMPLIANCE_PERMISSIONS: PermissionKey[] = ['documents:view', 'assets:view', 'contracts:view'];

/**
 * GET /api/v1/compliance?type=&window=&page=&limit=&filter=
 *
 * Normalized compliance items (expiring/expired documents, asset warranties and
 * contracts). Every row is authorized server-side (organization, RBAC, property
 * scope, and document confidentiality). Access requires at least one of
 * documents:view / assets:view / contracts:view; each category is then filtered
 * to the permissions the caller actually holds.
 */
export async function GET(request: NextRequest) {
  try {
    const principal = await authenticateRequest();
    await enforceRateLimit(principal);

    if (!COMPLIANCE_PERMISSIONS.some((p) => principal.permissions.includes(p))) {
      throw new AppError('FORBIDDEN', 'You do not have access to the compliance center.');
    }

    const params = request.nextUrl.searchParams;
    const typeParam = params.get('type');
    if (typeParam && !isComplianceCategory(typeParam)) {
      throw new AppError('VALIDATION', 'Unknown compliance category.', { status: 400 });
    }
    const filterParam = params.get('filter');
    if (filterParam && !(COMPLIANCE_STATUSES as readonly string[]).includes(filterParam)) {
      throw new AppError('VALIDATION', 'Invalid status filter.', { status: 400 });
    }
    const windowRaw = params.get('window');
    if (windowRaw !== null && (!/^\d+$/.test(windowRaw) || Number(windowRaw) < 1 || Number(windowRaw) > MAX_WINDOW_DAYS)) {
      throw new AppError('VALIDATION', `window must be between 1 and ${MAX_WINDOW_DAYS} days.`, { status: 400 });
    }

    const result = await getComplianceItems(
      {
        organizationId: principal.organizationId,
        permissions: principal.permissions,
        allowedPropertyIds: principal.scopedPropertyIds.length > 0 ? principal.scopedPropertyIds : null,
      },
      {
        type: typeParam && isComplianceCategory(typeParam) ? typeParam : null,
        filter: (filterParam as ComplianceStatusFilter | null) ?? 'all',
        windowDays: windowRaw ? Number(windowRaw) : undefined,
        page: Number(params.get('page')) || 1,
        pageSize: Number(params.get('limit')) || 20,
      },
    );

    return apiSuccess(result);
  } catch (error) {
    return apiError(error);
  }
}
