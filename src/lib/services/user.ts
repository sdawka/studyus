import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { users } from '../../db/schema';
import type { SettingsInput, TaskGeneratorsInput, UpdateUserInput } from '../schemas/user';

// `task_generators` is nested — Required<SettingsInput> alone would only
// require the object to be present, not require every key inside it. This
// is the shape resolveSettings actually guarantees callers.
export type ResolvedSettings = Required<Omit<SettingsInput, 'task_generators'>> & {
  task_generators: Required<TaskGeneratorsInput>;
};

export const DEFAULT_SETTINGS: ResolvedSettings = {
  theme: 'compass',
  scheme: 'light',
  sidebar_collapsed: false,
  learning_preferences: {
    weekly_hours: 7,
    guidance: 'balanced',
    depth: 'understand',
  },
  // Spam-prone families (stale_kc, prep_before_class) ship opt-in; the rest
  // default on.
  task_generators: {
    attend_class: true,
    prep_before_class: false,
    review_after_class: true,
    practice_kc: true,
    stale_kc: false,
    grade_entry: true,
    ritual: true,
  },
};

// users.settings is stored as a JSON blob that may be partial (or, pre-P1,
// `{}`) — every read resolves it against DEFAULT_SETTINGS so callers never
// see undefined fields. `task_generators` is merged key-wise (not
// shallow-replaced) so a partially-stored settings blob doesn't drop
// sibling generator toggles back to their defaults.
export function resolveSettings(raw: unknown): ResolvedSettings {
  const parsed = (raw && typeof raw === 'object' ? (raw as SettingsInput) : {}) as SettingsInput;
  return {
    ...DEFAULT_SETTINGS,
    ...parsed,
    task_generators: { ...DEFAULT_SETTINGS.task_generators, ...parsed.task_generators },
  };
}

export async function updateUser(db: Db, userId: string, input: UpdateUserInput) {
  const patch: Partial<typeof users.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.current_term !== undefined) patch.currentTerm = input.current_term;
  if (input.timezone !== undefined) patch.timezone = input.timezone;
  if (input.onboarded) patch.onboardedAt = Date.now();

  if (input.settings !== undefined) {
    const rows = await db.select({ settings: users.settings }).from(users).where(eq(users.id, userId)).limit(1);
    const current = (rows[0]?.settings ?? {}) as SettingsInput;
    const merged: SettingsInput = { ...current, ...input.settings };
    // Shallow `{...current, ...input.settings}` would let a PATCH touching
    // any one generator toggle clobber every sibling toggle wholesale —
    // merge task_generators key-wise instead, same rationale as
    // resolveSettings above.
    if (current.task_generators || input.settings.task_generators) {
      merged.task_generators = { ...current.task_generators, ...input.settings.task_generators };
    }
    patch.settings = merged;
  }

  if (Object.keys(patch).length > 0) {
    await db.update(users).set(patch).where(eq(users.id, userId));
  }

  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0];
}
