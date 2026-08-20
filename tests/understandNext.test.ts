// Pure-function coverage for src/lib/understandNext.ts — the course home's
// "Understand next" KC selection. No fetch/DOM involved, so this runs fine
// in the workers test pool alongside the DB-backed suites.
import { describe, expect, it } from 'vitest';
import {
  selectUnderstandNext,
  UNDERSTAND_NEXT_LIMIT,
  UNDERSTAND_STALE_DAYS,
  type UnderstandNextKc,
} from '../src/lib/understandNext';

const DAY_MS = 86_400_000;
const NOW = Date.parse('2026-08-15T12:00:00Z');

function kc(overrides: Partial<UnderstandNextKc> & { id: string }): UnderstandNextKc {
  return {
    name: `KC ${overrides.id}`,
    mastery: 0,
    status: 'not-started',
    lastEventAt: null,
    ...overrides,
  };
}

describe('selectUnderstandNext', () => {
  it('returns nothing for an empty course', () => {
    expect(selectUnderstandNext([], NOW)).toEqual([]);
  });

  it('excludes mastered KCs entirely', () => {
    const picks = selectUnderstandNext(
      [kc({ id: 'a', mastery: 95, status: 'mastered' }), kc({ id: 'b', mastery: 100, status: 'mastered' })],
      NOW,
    );
    expect(picks).toEqual([]);
  });

  it('orders started KCs weakest-first, staleness breaking ties', () => {
    const picks = selectUnderstandNext(
      [
        kc({ id: 'strong', mastery: 70, status: 'review', lastEventAt: NOW - DAY_MS }),
        kc({ id: 'weak-fresh', mastery: 30, status: 'learning', lastEventAt: NOW - DAY_MS }),
        kc({ id: 'weak-stale', mastery: 30, status: 'learning', lastEventAt: NOW - 20 * DAY_MS }),
      ],
      NOW,
    );
    expect(picks.map((p) => p.kc.id)).toEqual(['weak-stale', 'weak-fresh', 'strong']);
    expect(picks.every((p) => p.reason === 'weak')).toBe(true);
  });

  it('reserves one slot for the next untouched KC, in curriculum order', () => {
    const weak = [1, 2, 3, 4, 5].map((n) =>
      kc({ id: `w${n}`, mastery: n * 10, status: 'learning', lastEventAt: NOW - DAY_MS }),
    );
    const picks = selectUnderstandNext([...weak, kc({ id: 'new-1' }), kc({ id: 'new-2' })], NOW);
    expect(picks).toHaveLength(UNDERSTAND_NEXT_LIMIT);
    expect(picks.map((p) => p.kc.id)).toEqual(['w1', 'w2', 'w3', 'new-1']);
    expect(picks[3].reason).toBe('new');
  });

  it('fills the whole list from one pool when the other is empty', () => {
    const weakOnly = [1, 2, 3, 4, 5].map((n) =>
      kc({ id: `w${n}`, mastery: n * 10, status: 'learning', lastEventAt: NOW - DAY_MS }),
    );
    expect(selectUnderstandNext(weakOnly, NOW).map((p) => p.kc.id)).toEqual(['w1', 'w2', 'w3', 'w4']);

    const freshOnly = [1, 2, 3, 4, 5].map((n) => kc({ id: `n${n}` }));
    expect(selectUnderstandNext(freshOnly, NOW).map((p) => p.kc.id)).toEqual(['n1', 'n2', 'n3', 'n4']);
  });

  it('annotates idleDays only at/past the stale threshold', () => {
    const picks = selectUnderstandNext(
      [
        kc({ id: 'stale', mastery: 40, status: 'learning', lastEventAt: NOW - 12 * DAY_MS }),
        kc({ id: 'recent', mastery: 50, status: 'learning', lastEventAt: NOW - (UNDERSTAND_STALE_DAYS - 1) * DAY_MS }),
      ],
      NOW,
    );
    expect(picks.find((p) => p.kc.id === 'stale')?.idleDays).toBe(12);
    expect(picks.find((p) => p.kc.id === 'recent')?.idleDays).toBeNull();
  });

  it('leaves behavior unchanged when unreadyPrereqNames is absent (pre-ZPD callers)', () => {
    // Same fixture as the "reserves one slot" test, but with no readiness
    // field on any KC at all — must select identically.
    const weak = [1, 2, 3, 4, 5].map((n) =>
      kc({ id: `w${n}`, mastery: n * 10, status: 'learning', lastEventAt: NOW - DAY_MS }),
    );
    const picks = selectUnderstandNext([...weak, kc({ id: 'new-1' }), kc({ id: 'new-2' })], NOW);
    expect(picks.map((p) => p.kc.id)).toEqual(['w1', 'w2', 'w3', 'new-1']);
    expect(picks.every((p) => p.blockedBy.length === 0)).toBe(true);
  });

  it('weak pool: sinks blocked KCs below unblocked ones without dropping them, preserving order within each group', () => {
    const picks = selectUnderstandNext(
      [
        kc({ id: 'blocked-strongest', mastery: 90, status: 'review', lastEventAt: NOW - DAY_MS, unreadyPrereqNames: ['Limits'] }),
        kc({ id: 'unblocked-weak', mastery: 10, status: 'learning', lastEventAt: NOW - DAY_MS }),
        kc({ id: 'unblocked-mid', mastery: 30, status: 'learning', lastEventAt: NOW - DAY_MS }),
        kc({ id: 'blocked-weakest', mastery: 5, status: 'learning', lastEventAt: NOW - DAY_MS, unreadyPrereqNames: ['Derivatives'] }),
      ],
      NOW,
      2, // limit
    );
    // Both unblocked picks come out ahead of either blocked KC, even though
    // 'blocked-weakest' has lower mastery than both unblocked ones.
    expect(picks.map((p) => p.kc.id)).toEqual(['unblocked-weak', 'unblocked-mid']);
    expect(picks.every((p) => p.blockedBy.length === 0)).toBe(true);
  });

  it('"new" slot picks the first unblocked untouched KC, falling back to blocked only when all fresh KCs are blocked', () => {
    const unblockedFallthrough = selectUnderstandNext(
      [
        kc({ id: 'fresh-blocked', unreadyPrereqNames: ['Vectors'] }),
        kc({ id: 'fresh-unblocked' }),
      ],
      NOW,
      1, // limit — isolates the single reserved "new" slot
    );
    expect(unblockedFallthrough.map((p) => p.kc.id)).toEqual(['fresh-unblocked']);
    expect(unblockedFallthrough[0].blockedBy).toEqual([]);

    const allBlocked = selectUnderstandNext([kc({ id: 'fresh-blocked', unreadyPrereqNames: ['Vectors'] })], NOW, 1);
    expect(allBlocked.map((p) => p.kc.id)).toEqual(['fresh-blocked']);
    expect(allBlocked[0].blockedBy).toEqual(['Vectors']);
  });
});
