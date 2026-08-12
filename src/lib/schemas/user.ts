import { z } from 'zod';

// v1.1 addition: appearance + shell prefs, stored as JSON on users.settings.
// All fields optional — PATCH merges onto whatever's already stored, and
// reads resolve missing fields to DEFAULT_SETTINGS (see services/user.ts).
export const settingsSchema = z.strictObject({
  theme: z.enum(['compass', 'focus', 'campus']).optional(),
  scheme: z.enum(['light', 'dark', 'system']).optional(),
  sidebar_collapsed: z.boolean().optional(),
});
export type SettingsInput = z.infer<typeof settingsSchema>;

export const updateUserSchema = z.strictObject({
  name: z.string().min(1).optional(),
  current_term: z.string().nullable().optional(),
  // Additive (post-freeze): marks the onboarding stepper complete. One-way —
  // there's no unset; the onboarding page is skippable but not re-enterable.
  onboarded: z.literal(true).optional(),
  settings: settingsSchema.optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
