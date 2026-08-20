import { describe, expect, it } from 'vitest';
import { foldMetaSkills, type MetaSkillSignal } from '../src/lib/metaSkills';
import { META_SKILL_KEYS } from '../src/lib/schemas/capabilities';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 0, 28); // arbitrary fixed "now"

describe('foldMetaSkills', () => {
  it('returns all 3 catalog skills at zero for empty signals', () => {
    const result = foldMetaSkills([], NOW);
    expect(result.map((r) => r.key).sort()).toEqual([...META_SKILL_KEYS].sort());
    for (const skill of result) {
      expect(skill).toMatchObject({ count_28d: 0, count_prior_28d: 0, trend: 'flat', last_at: null });
    }
  });

  it('buckets signals into the trailing 28d window vs. the prior 28d window', () => {
    const signals: MetaSkillSignal[] = [
      { key: 'retrieval_practice', ts: NOW - 1 * DAY_MS }, // in current window
      { key: 'retrieval_practice', ts: NOW - 27 * DAY_MS }, // in current window
      { key: 'retrieval_practice', ts: NOW - 29 * DAY_MS }, // in prior window
      { key: 'retrieval_practice', ts: NOW - 55 * DAY_MS }, // in prior window
      { key: 'retrieval_practice', ts: NOW - 57 * DAY_MS }, // outside both windows
    ];
    const result = foldMetaSkills(signals, NOW);
    const rp = result.find((r) => r.key === 'retrieval_practice')!;
    expect(rp.count_28d).toBe(2);
    expect(rp.count_prior_28d).toBe(2);
  });

  it('respects exact window boundaries (age === 0 counts in current, age === WINDOW_MS rolls to prior)', () => {
    const signals: MetaSkillSignal[] = [
      { key: 'self_explanation', ts: NOW }, // age 0 -> current window
      { key: 'self_explanation', ts: NOW - 28 * DAY_MS }, // age === 28d -> prior window (current is [0, 28d))
      { key: 'self_explanation', ts: NOW - 56 * DAY_MS }, // age === 56d -> outside prior window ([28d, 56d))
    ];
    const result = foldMetaSkills(signals, NOW);
    const se = result.find((r) => r.key === 'self_explanation')!;
    expect(se.count_28d).toBe(1);
    expect(se.count_prior_28d).toBe(1);
  });

  it('classifies trend as up/down/flat with a +/-1 flat band', () => {
    const makeSignals = (key: MetaSkillSignal['key'], current: number, prior: number): MetaSkillSignal[] => {
      const signals: MetaSkillSignal[] = [];
      for (let i = 0; i < current; i++) signals.push({ key, ts: NOW - 1 * DAY_MS });
      for (let i = 0; i < prior; i++) signals.push({ key, ts: NOW - 30 * DAY_MS });
      return signals;
    };

    expect(foldMetaSkills(makeSignals('error_analysis', 5, 1), NOW).find((r) => r.key === 'error_analysis')!.trend).toBe('up');
    expect(foldMetaSkills(makeSignals('error_analysis', 1, 5), NOW).find((r) => r.key === 'error_analysis')!.trend).toBe('down');
    expect(foldMetaSkills(makeSignals('error_analysis', 4, 3), NOW).find((r) => r.key === 'error_analysis')!.trend).toBe('flat');
    expect(foldMetaSkills(makeSignals('error_analysis', 3, 4), NOW).find((r) => r.key === 'error_analysis')!.trend).toBe('flat');
    expect(foldMetaSkills(makeSignals('error_analysis', 0, 0), NOW).find((r) => r.key === 'error_analysis')!.trend).toBe('flat');
  });

  it('reports last_at as the most recent signal timestamp (ISO string), regardless of window', () => {
    const oldTs = NOW - 100 * DAY_MS;
    const recentTs = NOW - 5 * DAY_MS;
    const result = foldMetaSkills(
      [
        { key: 'retrieval_practice', ts: oldTs },
        { key: 'retrieval_practice', ts: recentTs },
      ],
      NOW,
    );
    const rp = result.find((r) => r.key === 'retrieval_practice')!;
    expect(rp.last_at).toBe(new Date(recentTs).toISOString());
  });

  it('keeps each skill independent of the others', () => {
    const signals: MetaSkillSignal[] = [
      { key: 'retrieval_practice', ts: NOW - 1 * DAY_MS },
      { key: 'retrieval_practice', ts: NOW - 2 * DAY_MS },
    ];
    const result = foldMetaSkills(signals, NOW);
    expect(result.find((r) => r.key === 'retrieval_practice')!.count_28d).toBe(2);
    expect(result.find((r) => r.key === 'self_explanation')!.count_28d).toBe(0);
    expect(result.find((r) => r.key === 'error_analysis')!.count_28d).toBe(0);
  });
});
