import { round2 } from '@/lib/utils';

/**
 * Availability engine (BRD 14, BR-011).
 *
 * Unit availability is NEVER taken from the manually selected status alone.
 * It is derived from the contract, notice, reservation, maintenance and
 * administrative facts about the unit, and yields both an availability class
 * and an "available from" date.
 */

export type AvailabilityClass = 'available' | 'reserved' | 'leased' | 'not_available';

export interface AvailabilityFacts {
  /** Status taxonomy flags for the unit's currently selected status. */
  status: {
    key: string;
    availabilityClass: AvailabilityClass;
    blocksLeasing: boolean;
    publishable: boolean;
  };
  /** Live contract, if any. */
  activeContract: {
    endDate: Date;
    noticeDate: Date | null;
    expectedVacateDate: Date | null;
    terminated: boolean;
  } | null;
  /** Active reservation, if any. */
  activeReservation: { expiryDate: Date } | null;
  /** Open work order that takes the unit out of service. */
  blockingMaintenance: { expectedCompletionDate: Date | null } | null;
  /** Administrative block set by a manager. */
  administrativeBlockUntil: Date | null;
  /** Manually declared availability date, used when nothing else applies. */
  declaredAvailabilityDate: Date | null;
}

export interface AvailabilitySettings {
  /** Preparation days added after a tenant vacates. */
  turnaroundDays: number;
  /** Days before availability at which the unit is marketed as Available Soon. */
  availableSoonWindowDays: number;
}

export interface AvailabilityResult {
  availabilityClass: AvailabilityClass;
  /** Earliest date the unit can be handed to a new tenant. */
  availableFrom: Date | null;
  /** True when the unit becomes available inside the "soon" window. */
  isAvailableSoon: boolean;
  /** Human-readable driver of the result, shown in the UI. */
  reason: string;
  /** Whether publication is permitted (BR-001). */
  publishable: boolean;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Resolves availability from facts. Precedence, highest first:
 *   1. Administrative block
 *   2. Blocking maintenance / renovation
 *   3. Active reservation
 *   4. Active contract (with notice handling)
 *   5. Declared status
 */
export function resolveAvailability(
  facts: AvailabilityFacts,
  settings: AvailabilitySettings,
  now = new Date(),
): AvailabilityResult {
  const today = startOfDay(now);

  if (facts.administrativeBlockUntil && facts.administrativeBlockUntil > today) {
    return {
      availabilityClass: 'not_available',
      availableFrom: addDays(facts.administrativeBlockUntil, 1),
      isAvailableSoon: false,
      reason: 'Administratively blocked',
      publishable: false,
    };
  }

  if (facts.blockingMaintenance) {
    const completion = facts.blockingMaintenance.expectedCompletionDate;
    const availableFrom = completion ? addDays(completion, settings.turnaroundDays) : null;
    return {
      availabilityClass: 'not_available',
      availableFrom,
      isAvailableSoon: false,
      reason: 'Out of service for maintenance or renovation',
      publishable: false,
    };
  }

  if (facts.activeReservation) {
    if (facts.activeReservation.expiryDate >= today) {
      return {
        availabilityClass: 'reserved',
        availableFrom: addDays(facts.activeReservation.expiryDate, 1),
        isAvailableSoon: false,
        reason: 'Reserved pending contract execution',
        publishable: false,
      };
    }
    // BR-011: an expired reservation no longer holds the unit.
    return {
      availabilityClass: 'available',
      availableFrom: today,
      isAvailableSoon: false,
      reason: 'Reservation expired — unit released',
      publishable: true,
    };
  }

  if (facts.activeContract && !facts.activeContract.terminated) {
    const { endDate, noticeDate, expectedVacateDate } = facts.activeContract;
    const vacateDate = expectedVacateDate ?? endDate;

    if (vacateDate >= today) {
      const availableFrom = addDays(vacateDate, settings.turnaroundDays + 1);
      const daysUntilAvailable = Math.ceil(
        (availableFrom.getTime() - today.getTime()) / 86_400_000,
      );
      const isAvailableSoon = daysUntilAvailable <= settings.availableSoonWindowDays;

      return {
        availabilityClass: 'leased',
        availableFrom,
        isAvailableSoon,
        reason: noticeDate
          ? `Notice received — tenant vacates ${vacateDate.toISOString().slice(0, 10)}`
          : `Leased until ${endDate.toISOString().slice(0, 10)}`,
        // A unit inside the notice window may be marketed ahead of vacancy.
        publishable: isAvailableSoon,
      };
    }

    // The contract has ended without being closed off; the unit is in turnaround.
    const availableFrom = addDays(vacateDate, settings.turnaroundDays + 1);
    return {
      availabilityClass: availableFrom <= today ? 'available' : 'not_available',
      availableFrom,
      isAvailableSoon: availableFrom > today,
      reason: 'Contract ended — unit in turnaround',
      publishable: availableFrom <= today,
    };
  }

  const declared = facts.declaredAvailabilityDate;
  if (declared && declared > today) {
    const daysUntilAvailable = Math.ceil((declared.getTime() - today.getTime()) / 86_400_000);
    const isAvailableSoon = daysUntilAvailable <= settings.availableSoonWindowDays;
    return {
      availabilityClass: isAvailableSoon ? 'available' : 'not_available',
      availableFrom: declared,
      isAvailableSoon,
      reason: `Available from ${declared.toISOString().slice(0, 10)}`,
      publishable: isAvailableSoon && facts.status.publishable,
    };
  }

  return {
    availabilityClass: facts.status.availabilityClass,
    availableFrom: facts.status.availabilityClass === 'available' ? today : null,
    isAvailableSoon: false,
    reason: `Status: ${facts.status.key.replace(/_/g, ' ')}`,
    publishable: facts.status.publishable && !facts.status.blocksLeasing,
  };
}

/**
 * Alternative unit matching (BRD 30). Scores candidate units against a
 * requirement so agents can offer substitutes when the requested unit is gone.
 */
export interface MatchRequirement {
  propertyId?: string | null;
  districtId?: string | null;
  cityId?: string | null;
  unitTypeId?: string | null;
  usageType?: string | null;
  requiredArea?: number | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  availableBy?: Date | null;
}

export interface MatchCandidate {
  unitId: string;
  propertyId: string;
  districtId: string | null;
  cityId: string;
  unitTypeId: string;
  usageType: string;
  leasableArea: number;
  askingRent: number;
  availableFrom: Date | null;
}

export interface MatchResult extends MatchCandidate {
  score: number;
  reasons: string[];
}

const MATCH_WEIGHTS = {
  property: 25,
  district: 18,
  city: 12,
  unitType: 15,
  usage: 10,
  area: 20,
  budget: 20,
  availability: 10,
} as const;

export function matchAlternativeUnits(
  requirement: MatchRequirement,
  candidates: MatchCandidate[],
  limit = 8,
): MatchResult[] {
  const maxScore = Object.values(MATCH_WEIGHTS).reduce((sum, w) => sum + w, 0);

  const scored = candidates.map((candidate) => {
    let score = 0;
    const reasons: string[] = [];

    if (requirement.propertyId && candidate.propertyId === requirement.propertyId) {
      score += MATCH_WEIGHTS.property;
      reasons.push('Same property');
    }
    if (requirement.districtId && candidate.districtId === requirement.districtId) {
      score += MATCH_WEIGHTS.district;
      reasons.push('Same district');
    }
    if (requirement.cityId && candidate.cityId === requirement.cityId) {
      score += MATCH_WEIGHTS.city;
      reasons.push('Same city');
    }
    if (requirement.unitTypeId && candidate.unitTypeId === requirement.unitTypeId) {
      score += MATCH_WEIGHTS.unitType;
      reasons.push('Matching unit type');
    }
    if (requirement.usageType && candidate.usageType === requirement.usageType) {
      score += MATCH_WEIGHTS.usage;
    }

    if (requirement.requiredArea && requirement.requiredArea > 0) {
      const deviation = Math.abs(candidate.leasableArea - requirement.requiredArea) / requirement.requiredArea;
      if (deviation <= 0.3) {
        const areaScore = MATCH_WEIGHTS.area * (1 - deviation / 0.3);
        score += areaScore;
        if (deviation <= 0.1) reasons.push('Area closely matches the requirement');
      }
    } else {
      score += MATCH_WEIGHTS.area * 0.5;
    }

    const { budgetMin, budgetMax } = requirement;
    if (budgetMax && budgetMax > 0) {
      if (candidate.askingRent <= budgetMax && (!budgetMin || candidate.askingRent >= budgetMin)) {
        score += MATCH_WEIGHTS.budget;
        reasons.push('Within budget');
      } else if (candidate.askingRent <= budgetMax * 1.1) {
        score += MATCH_WEIGHTS.budget * 0.5;
        reasons.push('Slightly above budget');
      }
    } else {
      score += MATCH_WEIGHTS.budget * 0.5;
    }

    if (requirement.availableBy && candidate.availableFrom) {
      if (candidate.availableFrom <= requirement.availableBy) {
        score += MATCH_WEIGHTS.availability;
        reasons.push('Available before the required move-in date');
      }
    } else {
      score += MATCH_WEIGHTS.availability * 0.5;
    }

    return {
      ...candidate,
      score: round2((score / maxScore) * 100),
      reasons,
    };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
