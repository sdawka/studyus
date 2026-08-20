import { describe, expect, it } from 'vitest';
import { foldCapabilityMastery, type CapabilityFoldMember } from '../src/lib/capabilityMastery';

function member(mastery: number, status: CapabilityFoldMember['status'], weight = 1): CapabilityFoldMember {
  return { mastery, status, weight };
}

describe('foldCapabilityMastery', () => {
  it('returns zero/not-started for no members', () => {
    expect(foldCapabilityMastery([])).toEqual({ mastery: 0, coverage: 0, status: 'not-started' });
  });

  it('is not-started when every member has zero events (all not-started)', () => {
    const result = foldCapabilityMastery([member(0, 'not-started'), member(0, 'not-started')]);
    expect(result).toEqual({ mastery: 0, coverage: 0, status: 'not-started' });
  });

  it('computes a weighted mean of member mastery', () => {
    // weight 3 and 1 -> (90*3 + 10*1) / 4 = 70
    const result = foldCapabilityMastery([member(90, 'mastered', 3), member(10, 'learning', 1)]);
    expect(result.mastery).toBe(70);
    expect(result.coverage).toBe(1);
  });

  it('computes coverage as the fraction of members that have started', () => {
    const result = foldCapabilityMastery([
      member(50, 'review'),
      member(0, 'not-started'),
      member(0, 'not-started'),
      member(100, 'mastered'),
    ]);
    expect(result.coverage).toBe(0.5);
  });

  it('blocks "mastered" when coverage < 1, even if the weighted mastery mean clears the threshold', () => {
    // A dominant, fully-mastered member (weight 10) plus one barely-started
    // low-weight member -> mean clears 80, but only half the members have
    // started, so status must fall back to 'review', not 'mastered'.
    const result = foldCapabilityMastery([member(100, 'mastered', 10), member(0, 'not-started', 1)]);
    expect(result.mastery).toBeGreaterThanOrEqual(80);
    expect(result.coverage).toBeLessThan(1);
    expect(result.status).toBe('review');
  });

  it('reaches "mastered" only when mastery >= 80 AND coverage === 1', () => {
    const result = foldCapabilityMastery([member(85, 'mastered'), member(90, 'mastered')]);
    expect(result.status).toBe('mastered');
  });

  it('applies the review threshold at mastery >= 40', () => {
    const atThreshold = foldCapabilityMastery([member(40, 'review')]);
    expect(atThreshold.status).toBe('review');

    const belowThreshold = foldCapabilityMastery([member(39, 'learning')]);
    expect(belowThreshold.status).toBe('learning');
  });

  it('applies the mastered threshold at mastery >= 80 with full coverage', () => {
    const atThreshold = foldCapabilityMastery([member(80, 'mastered')]);
    expect(atThreshold.status).toBe('mastered');

    const belowThreshold = foldCapabilityMastery([member(79, 'review')]);
    expect(belowThreshold.status).toBe('review');
  });
});
