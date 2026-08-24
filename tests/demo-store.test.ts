import { describe, expect, it } from 'vitest';
import { manualProposal } from '../src/lib/demo/catalog';
import {
  DEMO_STORAGE_KEY,
  DEMO_TTL_MS,
  freshDemoDraft,
  loadDemoDraft,
  realDemoImport,
  saveDemoDraft,
} from '../src/lib/demo/store';

function memoryStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next; },
    removeItem: () => { value = null; },
    value: () => value,
  };
}

describe('public demo storage', () => {
  it('round-trips a validated draft and expires it after seven days', () => {
    const now = Date.now();
    const storage = memoryStorage();
    const draft = freshDemoDraft(now);

    expect(saveDemoDraft(draft, storage)).toBe(true);
    expect(loadDemoDraft(storage, now).draft_id).toBe(draft.draft_id);
    expect(loadDemoDraft(storage, now + DEMO_TTL_MS + 10_000).draft_id).not.toBe(draft.draft_id);
    expect(storage.value()).toBeNull();
  });

  it('discards malformed state instead of trusting localStorage', () => {
    const storage = memoryStorage('{"schema_version":99,"courses":"unsafe"}');
    const loaded = loadDemoDraft(storage);

    expect(loaded.schema_version).toBe(1);
    expect(loaded.courses).toEqual([]);
    expect(storage.value()).toBeNull();
  });

  it('fails closed when code tries to persist an invalid draft', () => {
    const storage = memoryStorage();
    const invalid = { ...freshDemoDraft(), demo_mastery: 101 };

    expect(saveDemoDraft(invalid, storage)).toBe(false);
    expect(storage.value()).toBeNull();
  });

  it('never includes simulated courses in the account import payload', () => {
    const real = manualProposal('CHEE 314', 'Fluid Mechanics', ['Bernoulli equation']);
    const simulated = { ...manualProposal('DEMO 101', 'Demo', ['Sample topic']), source: { kind: 'simulated' as const } };
    const payload = realDemoImport({ ...freshDemoDraft(), courses: [simulated, real], simulated: true });

    expect(payload.courses).toHaveLength(1);
    expect(payload.courses[0].course.code).toBe('CHEE 314');
    expect(DEMO_STORAGE_KEY).toBe('studyus:demo:v1');
  });
});
