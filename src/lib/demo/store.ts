import { atom } from 'nanostores';
import { demoDraftSchema, type DemoDraft, type DemoImportInput, type DemoScenarioId } from '../schemas/onboarding';

export const DEMO_STORAGE_KEY = 'studyus:demo:v1';
export const DEMO_MAX_BYTES = 500_000;
export const DEMO_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function freshDemoDraft(now = Date.now()): DemoDraft {
  return {
    schema_version: 1,
    draft_id: crypto.randomUUID(),
    created_at: now,
    updated_at: now,
    preferences: { weekly_hours: 7, guidance: 'balanced', depth: 'understand' },
    courses: [],
    simulated: false,
    completed_scenarios: [],
    demo_mastery: 34,
    demo_standing: 72,
  };
}

// This module is also evaluated during Worker SSR. Keep its global initializer
// deterministic: Workers disallow random generation and clocks at module scope.
// onMount/initializeDemoStore replaces this sentinel with a real browser draft.
export const demoDraft = atom<DemoDraft>({
  schema_version: 1,
  draft_id: '00000000-0000-4000-8000-000000000000',
  created_at: 0,
  updated_at: 0,
  preferences: { weekly_hours: 7, guidance: 'balanced', depth: 'understand' },
  courses: [],
  simulated: false,
  completed_scenarios: [],
  demo_mastery: 34,
  demo_standing: 72,
});

export function loadDemoDraft(storage: Pick<Storage, 'getItem' | 'removeItem'> = localStorage, now = Date.now()): DemoDraft {
  const raw = storage.getItem(DEMO_STORAGE_KEY);
  if (!raw) return freshDemoDraft(now);
  try {
    const parsed = demoDraftSchema.parse(JSON.parse(raw));
    if (now - parsed.updated_at > DEMO_TTL_MS) {
      storage.removeItem(DEMO_STORAGE_KEY);
      return freshDemoDraft(now);
    }
    return parsed;
  } catch {
    storage.removeItem(DEMO_STORAGE_KEY);
    return freshDemoDraft(now);
  }
}

export function initializeDemoStore(): DemoDraft {
  if (typeof localStorage === 'undefined') return demoDraft.get();
  const value = loadDemoDraft(localStorage);
  demoDraft.set(value);
  return value;
}

export function saveDemoDraft(next: DemoDraft, storage: Pick<Storage, 'setItem'> = localStorage): boolean {
  try {
    const validated = demoDraftSchema.parse({ ...next, updated_at: Date.now() });
    const raw = JSON.stringify(validated);
    if (new TextEncoder().encode(raw).byteLength > DEMO_MAX_BYTES) return false;
    storage.setItem(DEMO_STORAGE_KEY, raw);
    demoDraft.set(validated);
    return true;
  } catch {
    return false;
  }
}

export function patchDemoDraft(patch: Partial<DemoDraft>): boolean {
  return saveDemoDraft({ ...demoDraft.get(), ...patch });
}

export function completeScenario(id: DemoScenarioId, masteryDelta = 4, standingDelta = 0): boolean {
  const current = demoDraft.get();
  return patchDemoDraft({
    completed_scenarios: [...new Set([...current.completed_scenarios, id])],
    demo_mastery: Math.min(100, current.demo_mastery + masteryDelta),
    demo_standing: Math.min(100, Math.max(0, current.demo_standing + standingDelta)),
  });
}

export function realDemoImport(draft = demoDraft.get()): DemoImportInput {
  return {
    schema_version: 1,
    draft_id: draft.draft_id,
    ...(draft.context ? { context: draft.context } : {}),
    preferences: draft.preferences,
    courses: draft.courses.filter((course) => course.source.kind !== 'simulated'),
  };
}

export function clearDemoDraft(storage: Pick<Storage, 'removeItem'> = localStorage): DemoDraft {
  storage.removeItem(DEMO_STORAGE_KEY);
  const next = freshDemoDraft();
  demoDraft.set(next);
  return next;
}
