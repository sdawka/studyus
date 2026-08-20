// Pure fold: (a capability's member KCs) -> { mastery, coverage, status }.
// Mirrors the shape of src/lib/services/mastery.ts::foldMastery, but folds
// already-derived KC mastery/status rows (weighted by capability_kcs.weight)
// rather than raw events — a capability's mastery is a rollup of its
// members' own event-sourced mastery, not a second independent fold over
// events.
import { MASTERY_CONSTANTS, type KcStatus } from './services/mastery';

export type CapabilityFoldMember = {
  mastery: number;
  status: KcStatus;
  weight: number;
};

export type CapabilityFoldResult = {
  mastery: number;
  coverage: number;
  status: KcStatus;
};

/**
 * Weighted mean of member mastery (rounded, same convention as
 * foldMastery), coverage = fraction of members that have started (status
 * !== 'not-started'), and status uses the same MASTERY_CONSTANTS thresholds
 * as a plain KC — except 'mastered' additionally requires coverage === 1,
 * so a competency can't read "mastered" off a fraction of its members.
 * 'not-started' when no member has any events yet (coverage === 0).
 */
export function foldCapabilityMastery(members: CapabilityFoldMember[]): CapabilityFoldResult {
  if (members.length === 0) {
    return { mastery: 0, coverage: 0, status: 'not-started' };
  }

  const weightSum = members.reduce((sum, m) => sum + m.weight, 0);
  const weightedMasterySum = members.reduce((sum, m) => sum + m.mastery * m.weight, 0);
  const mastery = weightSum > 0 ? Math.round(weightedMasterySum / weightSum) : 0;

  const startedCount = members.filter((m) => m.status !== 'not-started').length;
  const coverage = startedCount / members.length;

  const hasEvents = startedCount > 0;
  let status: KcStatus;
  if (!hasEvents) {
    status = 'not-started';
  } else if (mastery >= MASTERY_CONSTANTS.MASTERED_THRESHOLD && coverage === 1) {
    status = 'mastered';
  } else if (mastery >= MASTERY_CONSTANTS.REVIEW_THRESHOLD) {
    status = 'review';
  } else {
    status = 'learning';
  }

  return { mastery, coverage, status };
}
