import { z } from 'zod';
import { idSchema } from './common';

export const RITUAL_KINDS = ['recurring', 'session_shape', 'both'] as const;
export type RitualKind = (typeof RITUAL_KINDS)[number];

export const RITUAL_CADENCES = ['daily', 'weekly', 'after_class', 'before_class'] as const;
export type RitualCadence = (typeof RITUAL_CADENCES)[number];

// Guidance step rail for session_shape/both rituals — not enforced gates,
// see StudyFlow.svelte ('retrieval' -> QuickQuiz, 'new_material' -> /learn,
// 'game' -> course /play, 'reflect' -> existing reflection field, 'warmup'
// and 'break' are display-only pauses in the rail).
export const RITUAL_STEP_KINDS = ['game', 'warmup', 'retrieval', 'new_material', 'reflect', 'break'] as const;
export type RitualStepKind = (typeof RITUAL_STEP_KINDS)[number];

export const ritualStepSchema = z.strictObject({
  kind: z.enum(RITUAL_STEP_KINDS),
  label: z.string().max(200).optional(),
  minutes: z.number().int().positive().optional(),
});
export type RitualStep = z.infer<typeof ritualStepSchema>;

// `by_weekday` follows the same JSON-array-string convention as
// courses.meetingDays (e.g. "[1,3,5]", ISO weekday numbers Mon=1..Sun=7,
// parsed with parseMeetingDays — see src/lib/services/classSessions.ts).
// Zod validates it as a JSON-encoded array of 1-7 here rather than as a raw
// comma string.
export const ritualByWeekdaySchema = z
  .string()
  .transform((s, ctx) => {
    try {
      const parsed = JSON.parse(s);
      if (!Array.isArray(parsed) || !parsed.every((n) => Number.isInteger(n) && n >= 1 && n <= 7)) {
        ctx.addIssue({ code: 'custom', message: 'by_weekday must be a JSON array of ISO weekday numbers 1-7' });
        return z.NEVER;
      }
      return s;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'by_weekday must be a JSON array string, e.g. "[1,3,5]"' });
      return z.NEVER;
    }
  });

export const createRitualSchema = z.strictObject({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  kind: z.enum(RITUAL_KINDS),
  cadence: z.enum(RITUAL_CADENCES).optional(),
  by_weekday: ritualByWeekdaySchema.optional(),
  course_id: idSchema.optional(),
  steps: z.array(ritualStepSchema).optional(),
  active: z.boolean().optional(),
});
export type CreateRitualInput = z.infer<typeof createRitualSchema>;

export const updateRitualSchema = z.strictObject({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  kind: z.enum(RITUAL_KINDS).optional(),
  cadence: z.enum(RITUAL_CADENCES).nullable().optional(),
  by_weekday: ritualByWeekdaySchema.nullable().optional(),
  course_id: idSchema.nullable().optional(),
  steps: z.array(ritualStepSchema).nullable().optional(),
  active: z.boolean().optional(),
});
export type UpdateRitualInput = z.infer<typeof updateRitualSchema>;

// One 28-day-window occurrence dot for the adherence row (see
// services/rituals.ts::listRitualsWithAdherence) — 'skipped' not 'missed',
// no streaks/badges/broken-chain metaphors (anti-gamification, vision.md).
export const ritualOccurrenceSchema = z.object({
  date: z.string(),
  state: z.enum(['done', 'skipped', 'upcoming']),
});
export type RitualOccurrence = z.infer<typeof ritualOccurrenceSchema>;

// Adherence shape returned alongside each ritual on GET /rituals.
// - `done_28d` / `generated_28d`: recurring adherence, sweep-minted tasks
//   over the trailing 28 days (dedupe key `ritual:<ritualId>:<yyyymmdd>`).
// - `session_uses_28d`: session-shape usage count from
//   study_sessions.ritualId over the trailing 28 days.
export const ritualAdherenceSchema = z.object({
  done_28d: z.number().int().nonnegative(),
  generated_28d: z.number().int().nonnegative(),
  session_uses_28d: z.number().int().nonnegative(),
  occurrences: z.array(ritualOccurrenceSchema),
});
export type RitualAdherence = z.infer<typeof ritualAdherenceSchema>;

// Full GET /rituals row shape (all `rituals` table columns in snake_case,
// per docs/api.md convention, plus the adherence block above).
export const ritualResponseSchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  kind: z.enum(RITUAL_KINDS),
  cadence: z.enum(RITUAL_CADENCES).nullable(),
  by_weekday: z.string().nullable(),
  course_id: idSchema.nullable(),
  steps: z.array(ritualStepSchema).nullable(),
  active: z.boolean(),
  created_at: z.string(),
  adherence: ritualAdherenceSchema,
});
export type RitualResponse = z.infer<typeof ritualResponseSchema>;
