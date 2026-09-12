import { describe, expect, it } from 'vitest';
import { deriveKcState } from '../src/lib/domain/kcState';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 8, 12);

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    ts: now - DAY,
    type: 'quiz_taken',
    isInstructional: false,
    isAssessment: true,
    payload: { correct: true },
    ...overrides,
  };
}

describe('deriveKcState', () => {
  it('excludes context facts from evidence IDs, freshness, and the mastery estimate', () => {
    const assessed = evidence({ id: 'assessed', ts: now - 2 * DAY });
    const state = deriveKcState([
      assessed,
      evidence({ id: 'context', ts: now, type: 'correction_accepted', isAssessment: false }),
    ], {}, now);

    expect(state.evidenceIds).toEqual(['assessed']);
    expect(state.lastUpdatedAt).toBe(now - 2 * DAY);
    expect(state.masteryEstimate).toBeGreaterThan(0);
  });

  it('derives bounded confidence from evidence count, type diversity, and recency', () => {
    const sparse = deriveKcState([evidence({ id: 'old', ts: now - 120 * DAY })], {}, now);
    const varied = deriveKcState([
      evidence({ id: 'quiz', ts: now - DAY }),
      evidence({ id: 'practice', type: 'practice_done', isInstructional: true, ts: now - DAY / 2 }),
      evidence({ id: 'project', type: 'assignment_graded', ts: now }),
    ], {}, now);

    expect(sparse.confidence).toBeGreaterThanOrEqual(0);
    expect(varied.confidence).toBeLessThanOrEqual(1);
    expect(varied.confidence).toBeGreaterThan(sparse.confidence);
    expect(varied.evidenceIds).toEqual(['quiz', 'practice', 'project']);
  });

  it('requires tagged later retention and transfer observations when the rule calls for them', () => {
    const first = evidence({ id: 'first', ts: now - 3 * DAY });
    const tooSoon = evidence({ id: 'too-soon', ts: now - 3 * DAY + 60_000, payload: { correct: true, evidence_tags: ['retention', 'transfer'] } });
    const untaggedLater = evidence({ id: 'untagged', ts: now });
    const incomplete = deriveKcState([first, tooSoon, untaggedLater], {
      threshold: 0.5, minimum_evidence: 2, requires_retention: true, requires_transfer: true,
    }, now);

    expect(incomplete.hasRetentionEvidence).toBe(false);
    expect(incomplete.hasTransferEvidence).toBe(true);
    expect(incomplete.meetsMasteryRule).toBe(false);

    const complete = deriveKcState([...incomplete.evidence, evidence({
      id: 'delayed', ts: now, payload: { correct: true, evidence_tags: ['retention', 'transfer'] },
    })], { threshold: 0.5, minimum_evidence: 2, requires_retention: true, requires_transfer: true }, now);
    expect(complete.hasRetentionEvidence).toBe(true);
    expect(complete.hasTransferEvidence).toBe(true);
    expect(complete.meetsMasteryRule).toBe(true);
  });

  it('does not satisfy retention or transfer with a failed later tagged attempt', () => {
    const state = deriveKcState([
      evidence({ id: 'first', ts: now - 3 * DAY }),
      evidence({ id: 'failed-later', ts: now, payload: { correct: false, evidence_tags: ['retention', 'transfer'] } }),
    ], { requires_retention: true, requires_transfer: true }, now);

    expect(state.hasRetentionEvidence).toBe(false);
    expect(state.hasTransferEvidence).toBe(false);
    expect(state.meetsMasteryRule).toBe(false);
  });

  it('requires positive success for retention and transfer even when the mastery threshold is zero', () => {
    const first = evidence({ id: 'first-zero-threshold', ts: now - 3 * DAY });
    const failed = evidence({
      id: 'failed-zero-threshold',
      ts: now,
      payload: { correct: false, evidence_tags: ['retention', 'transfer'] },
    });
    const rule = { threshold: 0, requires_retention: true, requires_transfer: true };

    const failedState = deriveKcState([first, failed], rule, now);
    expect(failedState.hasRetentionEvidence).toBe(false);
    expect(failedState.hasTransferEvidence).toBe(false);

    const successfulState = deriveKcState([first, failed, evidence({
      id: 'successful-zero-threshold',
      ts: now + 1,
      payload: { correct: true, evidence_tags: ['retention', 'transfer'] },
    })], rule, now + 1);
    expect(successfulState.hasRetentionEvidence).toBe(true);
    expect(successfulState.hasTransferEvidence).toBe(true);
  });
});
