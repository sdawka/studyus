import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { users } from '../../db/schema';
import type { SettingsInput, UpdateUserInput } from '../schemas/user';

export const DEFAULT_SETTINGS: Required<SettingsInput> = {
  theme: 'compass',
  scheme: 'system',
  sidebar_collapsed: false,
};

// users.settings is stored as a JSON blob that may be partial (or, pre-P1,
// `{}`) — every read resolves it against DEFAULT_SETTINGS so callers never
// see undefined fields.
export function resolveSettings(raw: unknown): Required<SettingsInput> {
  const parsed = (raw && typeof raw === 'object' ? (raw as SettingsInput) : {}) as SettingsInput;
  return { ...DEFAULT_SETTINGS, ...parsed };
}

export async function updateUser(db: Db, userId: string, input: UpdateUserInput) {
  const patch: Partial<typeof users.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.current_term !== undefined) patch.currentTerm = input.current_term;
  if (input.onboarded) patch.onboardedAt = Date.now();

  if (input.settings !== undefined) {
    const rows = await db.select({ settings: users.settings }).from(users).where(eq(users.id, userId)).limit(1);
    const current = (rows[0]?.settings ?? {}) as SettingsInput;
    patch.settings = { ...current, ...input.settings };
  }

  if (Object.keys(patch).length > 0) {
    await db.update(users).set(patch).where(eq(users.id, userId));
  }

  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0];
}
