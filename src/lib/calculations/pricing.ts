import { round2 } from '@/lib/utils';

/**
 * Pricing approval engine (BRD 18, BR-004).
 *
 * Tiers are read from the `pricing.approval_tiers` setting, so an
 * administrator changes approval authority without a code change.
 */

export interface ApprovalTier {
  maxDiscountPercent: number;
  roleKey: string;
  label: string;
}

export interface PricingRequest {
  askingRent: number;
  requestedRent: number;
  contractTermMonths: number;
}

export interface PricingEvaluation {
  askingRent: number;
  requestedRent: number;
  discountAmount: number;
  discountPercent: number;
  annualImpact: number;
  totalContractValue: number;
  requiresApproval: boolean;
  requiredRoleKey: string | null;
  requiredRoleLabel: string | null;
  /** True when the request is below the hard rent floor. */
  belowFloor: boolean;
}

export function evaluatePricing(
  request: PricingRequest,
  tiers: ApprovalTier[],
  minimumRentFloorPercent: number,
): PricingEvaluation {
  const { askingRent, requestedRent, contractTermMonths } = request;

  const discountAmount = round2(Math.max(0, askingRent - requestedRent));
  const discountPercent = askingRent > 0 ? round2((discountAmount / askingRent) * 100) : 0;
  const totalContractValue = round2((requestedRent * contractTermMonths) / 12);
  const belowFloor = askingRent > 0 && requestedRent < askingRent * (minimumRentFloorPercent / 100);

  if (discountAmount <= 0) {
    return {
      askingRent,
      requestedRent,
      discountAmount: 0,
      discountPercent: 0,
      annualImpact: 0,
      totalContractValue,
      requiresApproval: false,
      requiredRoleKey: null,
      requiredRoleLabel: null,
      belowFloor: false,
    };
  }

  const ordered = [...tiers].sort((a, b) => a.maxDiscountPercent - b.maxDiscountPercent);
  const tier = ordered.find((t) => discountPercent <= t.maxDiscountPercent) ?? ordered[ordered.length - 1];

  // A request below the rent floor always escalates to the highest tier.
  const effectiveTier = belowFloor ? ordered[ordered.length - 1] : tier;

  return {
    askingRent,
    requestedRent,
    discountAmount,
    discountPercent,
    annualImpact: discountAmount,
    totalContractValue,
    requiresApproval: true,
    requiredRoleKey: effectiveTier?.roleKey ?? null,
    requiredRoleLabel: effectiveTier?.label ?? null,
    belowFloor,
  };
}

/** Can this user approve the evaluated request? */
export function canApprovePricing(
  evaluation: PricingEvaluation,
  userRoleKeys: string[],
): boolean {
  if (!evaluation.requiresApproval) return true;
  if (userRoleKeys.includes('super_admin')) return true;
  if (!evaluation.requiredRoleKey) return false;
  return userRoleKeys.includes(evaluation.requiredRoleKey);
}

export interface PriceChange {
  field: string;
  previousValue: number | null;
  newValue: number;
}

/**
 * Diffs a pricing update against the current record so that only genuine
 * changes are written to the append-only price history (BR-005).
 */
export function diffPricing(
  current: Record<string, number | null | undefined>,
  next: Record<string, number | null | undefined>,
  fields: string[],
): PriceChange[] {
  const changes: PriceChange[] = [];
  for (const field of fields) {
    const previousValue = current[field] ?? null;
    const newValue = next[field];
    if (newValue === undefined || newValue === null) continue;
    if (previousValue !== null && round2(previousValue) === round2(newValue)) continue;
    changes.push({ field, previousValue, newValue: round2(newValue) });
  }
  return changes;
}
