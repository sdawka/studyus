import { z } from 'zod';

// v1.4 addition: per-family opt in/out for the task sweep generators
// (services/taskSweep.ts). All optional — PATCH merges onto whatever's
// already stored (key-wise, not shallow — see services/user.ts), and reads
// resolve missing keys to DEFAULT_SETTINGS.task_generators.
export const taskGeneratorsSchema = z.strictObject({
  attend_class: z.boolean().optional(),
  prep_before_class: z.boolean().optional(),
  review_after_class: z.boolean().optional(),
  practice_kc: z.boolean().optional(),
  stale_kc: z.boolean().optional(),
  grade_entry: z.boolean().optional(),
  // v1.9: master toggle for the ritual sweep collector (services/taskSweep.ts::collectRituals);
  // per-ritual on/off is the separate rituals.active flag.
  ritual: z.boolean().optional(),
});
export type TaskGeneratorsInput = z.infer<typeof taskGeneratorsSchema>;

// v1.1 addition: appearance + shell prefs, stored as JSON on users.settings.
// All fields optional — PATCH merges onto whatever's already stored, and
// reads resolve missing fields to DEFAULT_SETTINGS (see services/user.ts).
export const settingsSchema = z.strictObject({
  theme: z.enum(['compass', 'focus', 'campus']).optional(),
  scheme: z.enum(['light', 'dark', 'system']).optional(),
  sidebar_collapsed: z.boolean().optional(),
  task_generators: taskGeneratorsSchema.optional(),
  learning_preferences: z
    .strictObject({
      weekly_hours: z.number().int().min(2).max(15),
      guidance: z.enum(['self_directed', 'balanced', 'tell_me_next']),
      depth: z.enum(['keep_up', 'understand', 'master']),
    })
    .optional(),
});
export type SettingsInput = z.infer<typeof settingsSchema>;

export const updateUserSchema = z.strictObject({
  name: z.string().min(1).optional(),
  current_term: z.string().nullable().optional(),
  timezone: z.string().min(1).refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
      return value === 'UTC' || value.includes('/');
    } catch {
      return false;
    }
  }, 'timezone must be an IANA time zone').optional(),
  // Additive (post-freeze): marks the onboarding stepper complete. One-way —
  // there's no unset; the onboarding page is skippable but not re-enterable.
  onboarded: z.literal(true).optional(),
  settings: settingsSchema.optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
