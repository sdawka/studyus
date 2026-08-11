import { describe, expect, it } from 'vitest';
import { foldMastery, MASTERY_CONSTANTS } from '../src/lib/services/mastery';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-08-11T00:00:00Z');

describe('foldMastery', () => {
  it('returns not-started for a KC with no events', () => {
    expect(foldMastery([], NOW)).toEqual({ mastery: 0, status: 'not-started', lastEventAt: null });
  });

  it('rises with recent AE successes', () => {
    const events = [
      { ts: NOW - 1 * DAY_MS, isInstructional: false, isAssessment: true, payload: { correct: true } },
      { ts: NOW - 2 * DAY_MS, isInstructional: false, isAssessment: true, payload: { correct: true } },
      { ts: NOW - 3 * DAY_MS, isInstructional: false, isAssessment: true, payload: { correct: true } },
    ];
    const result = foldMastery(events, NOW);
    expect(result.status).toBe('mastered');
    expect(result.mastery).toBeGreaterThanOrEqual(MASTERY_CONSTANTS.MASTERED_THRESHOLD);
  });

  it('falls with recent AE failures', () => {
    const events = [
      { ts: NOW - 1 * DAY_MS, isInstructional: false, isAssessment: true, payload: { correct: false } },
      { ts: NOW - 2 * DAY_MS, isInstructional: false, isAssessment: true, payload: { correct: false } },
    ];
    const result = foldMastery(events, NOW);
    expect(result.mastery).toBeLessThan(MASTERY_CONSTANTS.REVIEW_THRESHOLD);
    expect(result.status).toBe('learning');
  });

  it('mixed history: successes outweighed by recency-weighted failures land lower than an all-success run', () => {
    const allSuccess = foldMastery(
      [
        { ts: NOW - 1 * DAY_MS, isInstructional: false, isAssessment: true, payload: { correct: true } },
        { ts: NOW - 5 * DAY_MS, isInstructional: false, isAssessment: true, payload: { correct: true } },
      ],
      NOW,
    );
    const recentFailure = foldMastery(
      [
        { ts: NOW - 30 * DAY_MS, isInstructional: false, isAssessment: true, payload: { correct: true } },
        { ts: NOW - 1 * DAY_MS, isInstructional: false, isAssessment: true, payload: { correct: false } },
      ],
      NOW,
    );
    expect(recentFailure.mastery).toBeLessThan(allSuccess.mastery);
  });

  it('decays a previously-mastered KC toward review when idle', () => {
    // Mastered a long time ago, no events since.
    const events = [
      { ts: NOW - 400 * DAY_MS, isInstructional: false, isAssessment: true, payload: { correct: true } },
      { ts: NOW - 401 * DAY_MS, isInstructional: false, isAssessment: true, payload: { correct: true } },
      { ts: NOW - 402 * DAY_MS, isInstructional: false, isAssessment: true, payload: { correct: true } },
    ];
    const result = foldMastery(events, NOW);
    expect(result.status).toBe('review');
    expect(result.mastery).toBeLessThan(MASTERY_CONSTANTS.MASTERED_THRESHOLD);
    expect(result.mastery).toBeGreaterThan(0);
  });

  it('IE-only events give a small exposure bump, not enough to reach mastered', () => {
    const events = [
      { ts: NOW - 1 * DAY_MS, isInstructional: true, isAssessment: false, payload: {} },
      { ts: NOW - 2 * DAY_MS, isInstructional: true, isAssessment: false, payload: {} },
    ];
    const result = foldMastery(events, NOW);
    expect(result.mastery).toBeGreaterThan(0);
    expect(result.mastery).toBeLessThanOrEqual(MASTERY_CONSTANTS.IE_BUMP_CAP);
    expect(result.status).toBe('learning');
  });

  it('dual-role events (practice_done-shaped) count toward both AE and IE contributions', () => {
    const events = [
      { ts: NOW - 1 * DAY_MS, isInstructional: true, isAssessment: true, payload: { correct: true } },
      { ts: NOW - 2 * DAY_MS, isInstructional: true, isAssessment: true, payload: { correct: true } },
    ];
    const result = foldMastery(events, NOW);
    expect(result.mastery).toBeGreaterThan(80);
  });
});
