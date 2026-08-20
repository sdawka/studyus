// Pure-function coverage for src/lib/zpd.ts — the ZPD frontier selector.
import { describe, expect, it } from 'vitest';
import { computeReadiness, selectFrontier, type ZpdKc } from '../src/lib/zpd';

function kc(overrides: Partial<ZpdKc> & { id: string }): ZpdKc {
  return {
    status: 'not-started',
    mastery: 0,
    prereqIds: [],
    ...overrides,
  };
}

describe('computeReadiness', () => {
  it('is ready once started and at/above the review threshold', () => {
    const readiness = computeReadiness([
      kc({ id: 'not-started', status: 'not-started', mastery: 100 }), // never ready untouched
      kc({ id: 'below', status: 'learning', mastery: 39 }),
      kc({ id: 'at', status: 'learning', mastery: 40 }),
      kc({ id: 'mastered', status: 'mastered', mastery: 90 }),
    ]);
    expect(readiness.get('not-started')).toBe(false);
    expect(readiness.get('below')).toBe(false);
    expect(readiness.get('at')).toBe(true);
    expect(readiness.get('mastered')).toBe(true);
  });
});

describe('selectFrontier', () => {
  it('returns nothing for empty input', () => {
    expect(selectFrontier([])).toEqual({ frontier: [], blocked: [] });
  });

  it('puts a prereq-free unmastered KC on the frontier', () => {
    const { frontier, blocked } = selectFrontier([kc({ id: 'a', status: 'not-started', mastery: 0 })]);
    expect(frontier.map((k) => k.id)).toEqual(['a']);
    expect(blocked).toEqual([]);
  });

  it('excludes mastered KCs from both frontier and blocked', () => {
    const { frontier, blocked } = selectFrontier([kc({ id: 'a', status: 'mastered', mastery: 95 })]);
    expect(frontier).toEqual([]);
    expect(blocked).toEqual([]);
  });

  it('blocks a chain whose prereq is not ready, and frontiers it once the prereq becomes ready', () => {
    const notReadyPrereq = [
      kc({ id: 'root', status: 'learning', mastery: 10 }),
      kc({ id: 'child', status: 'not-started', mastery: 0, prereqIds: ['root'] }),
    ];
    let result = selectFrontier(notReadyPrereq);
    expect(result.frontier.map((k) => k.id)).toEqual(['root']);
    expect(result.blocked.map((k) => k.id)).toEqual(['child']);

    const readyPrereq = [
      kc({ id: 'root', status: 'review', mastery: 40 }),
      kc({ id: 'child', status: 'not-started', mastery: 0, prereqIds: ['root'] }),
    ];
    result = selectFrontier(readyPrereq);
    expect(result.frontier.map((k) => k.id).sort()).toEqual(['child', 'root']);
    expect(result.blocked).toEqual([]);
  });

  it('handles a diamond: child frontiers only once BOTH parents are ready', () => {
    const base = (leftReady: boolean, rightReady: boolean) => [
      kc({ id: 'left', status: leftReady ? 'review' : 'learning', mastery: leftReady ? 40 : 10 }),
      kc({ id: 'right', status: rightReady ? 'review' : 'learning', mastery: rightReady ? 40 : 10 }),
      kc({ id: 'child', status: 'not-started', mastery: 0, prereqIds: ['left', 'right'] }),
    ];

    expect(selectFrontier(base(true, false)).blocked.map((k) => k.id)).toEqual(['child']);
    expect(selectFrontier(base(false, true)).blocked.map((k) => k.id)).toEqual(['child']);

    const bothReady = selectFrontier(base(true, true));
    expect(bothReady.frontier.map((k) => k.id)).toContain('child');
    expect(bothReady.blocked).toEqual([]);
  });

  it('gates on a cross-course prereq included in the same input array', () => {
    const kcs = [
      kc({ id: 'math-101-limits', status: 'learning', mastery: 20 }),
      kc({ id: 'physics-201-kinematics', status: 'not-started', mastery: 0, prereqIds: ['math-101-limits'] }),
    ];
    expect(selectFrontier(kcs).blocked.map((k) => k.id)).toEqual(['physics-201-kinematics']);
  });

  it('treats a prereq id absent from the input array as not ready', () => {
    const { blocked, frontier } = selectFrontier([
      kc({ id: 'child', status: 'not-started', mastery: 0, prereqIds: ['missing-from-input'] }),
    ]);
    expect(blocked.map((k) => k.id)).toEqual(['child']);
    expect(frontier).toEqual([]);
  });
});
