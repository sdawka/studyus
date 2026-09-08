import { describe, expect, it } from 'vitest';
import { planDemo, type DemoCourse } from '../../src/lib/demo/planner';

const now = Date.parse('2026-09-07T08:00:00.000Z');
const morning = [{ day: 1, startMinute: 540, endMinute: 720 }];

function course(names: string[]): DemoCourse {
  return {
    code: 'DEMO 101',
    title: 'A grounded course',
    branches: [{
      name: 'Supplied outline',
      kcs: names.map((name) => ({ name, prereq_refs: [] })),
    }],
  };
}

describe('grounded public demo planner', () => {
  it('keeps long supplied topic names intact without inventing learning evidence', () => {
    const longTopic = 'A very long topic name that must remain the learner supplied label at every preview width';
    const result = planDemo({ course: course([longTopic]), weeklyHours: 2, availability: morning, now });

    expect(result.recommendation?.title).toBe(longTopic);
    expect(result.rationale).toContain('supplied course map');
    expect(result.rationale.toLowerCase()).not.toContain('mastery');
    expect(result.rationale.toLowerCase()).not.toContain('weak');
  });

  it('returns a truthful empty recommendation when no availability exists', () => {
    const result = planDemo({ course: course(['Vectors']), weeklyHours: 2, availability: [], now });

    expect(result.recommendation).toBeNull();
    expect(result.unplaced[0]).toMatchObject({ title: 'Vectors' });
    expect(result.rationale).toContain('availability');
  });

  it('reports unmatched deadline references and still previews known topics', () => {
    const result = planDemo({
      course: course(['Known topic']),
      weeklyHours: 2,
      availability: morning,
      deadlines: [{ id: 'midterm', title: 'Midterm', dueAt: now + 2 * 86_400_000, topicRefs: ['not-in-map'] }],
      now,
    });

    expect(result.unmatchedRefs).toEqual(['not-in-map']);
    expect(result.recommendation?.title).toBe('Known topic');
  });

  it('lets an explicit deadline change the recommendation order', () => {
    const withoutDeadline = planDemo({ course: course(['First topic', 'Second topic']), weeklyHours: 2, availability: morning, now });
    const withDeadline = planDemo({
      course: course(['First topic', 'Second topic']),
      weeklyHours: 2,
      availability: morning,
      deadlines: [{ id: 'quiz', title: 'Quiz', dueAt: now + 86_400_000, topicRefs: ['Second topic'] }],
      now,
    });

    expect(withoutDeadline.recommendation?.title).toBe('First topic');
    expect(withDeadline.recommendation?.title).toBe('Second topic');
    expect(withDeadline.rationale).toContain('Quiz');
  });

  it('starts with an explicitly listed prerequisite without inferring one', () => {
    const result = planDemo({
      course: {
        ...course(['Target topic', 'Foundation']),
        branches: [{ name: 'Supplied outline', kcs: [
          { name: 'Target topic', prereq_refs: ['#Foundation'] },
          { name: 'Foundation', prereq_refs: [] },
        ] }],
      },
      weeklyHours: 2,
      availability: morning,
      now,
    });

    expect(result.recommendation?.title).toBe('Foundation');
    expect(result.rationale).toContain('explicitly');
  });
});
