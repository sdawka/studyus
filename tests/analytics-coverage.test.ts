import { describe, expect, it } from 'vitest';
import { behavioralEventCoverage } from '../src/lib/analytics/coverage';
import { behavioralEventNames, type BehavioralEventName } from '../src/lib/analytics/events';

describe('behavioral analytics coverage registry', () => {
  it('classifies exactly the schema vocabulary', () => {
    expect(Object.keys(behavioralEventCoverage).sort()).toEqual([...behavioralEventNames].sort());
  });

  it('gives every live event at least one named emitter contract', () => {
    for (const entry of Object.values(behavioralEventCoverage)) {
      if (entry.status !== 'live') continue;
      expect(entry.emitters.length).toBeGreaterThan(0);
      for (const emitter of entry.emitters) {
        expect(emitter.id.trim()).not.toBe('');
        expect(emitter.description.trim()).not.toBe('');
      }
    }
  });

  it('keeps reserved events explicit and emitter-free', () => {
    const reserved = Object.entries(behavioralEventCoverage)
      .filter(([, entry]) => entry.status === 'reserved')
      .map(([name, entry]) => ({ name, entry }));

    expect(reserved.map(({ name }) => name)).toEqual(['resource_saved']);
    for (const { entry } of reserved) {
      if (entry.status !== 'reserved') throw new Error('Expected a reserved coverage entry');
      expect(entry.reason.trim()).not.toBe('');
      expect(entry.decision.trim()).not.toBe('');
      expect(entry.emitters).toEqual([]);
    }
  });

  it('records the deliberate API-only and tutor classifications', () => {
    expect(behavioralEventCoverage.course_archived).toMatchObject({ status: 'live', reachability: 'api_only' });
    for (const name of ['tutor_opened', 'tutor_message_sent', 'tutor_abandoned'] satisfies BehavioralEventName[]) {
      expect(behavioralEventCoverage[name].status).toBe('live');
    }
  });
});
