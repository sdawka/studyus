import { z } from 'zod';

export const AVAILABLE_MINUTES = [15, 25, 50] as const;
export type AvailableMinutes = (typeof AVAILABLE_MINUTES)[number];

export const nextMoveQuerySchema = z.strictObject({
  available_minutes: z.coerce.number().pipe(z.union([z.literal(15), z.literal(25), z.literal(50)])).default(25),
});

export type NextMoveKind = 'assessment_practice' | 'prerequisite_repair' | 'stale_review' | 'frontier_understand';
export type NextMoveMethod = 'understand' | 'quick_quiz';
export type NextMoveReasonCode =
  | 'assessment_urgency'
  | 'mastery_need'
  | 'prerequisite_repair'
  | 'prerequisite_ready'
  | 'stale_evidence'
  | 'new_concept'
  | 'time_fit';

export type NextMoveReason = { code: NextMoveReasonCode; label: string };

export type NextMove = {
  action_id: string;
  kind: NextMoveKind;
  method: NextMoveMethod;
  title: string;
  course: { course_id: string; course_slug: string; course_code: string; course_title: string; color: string | null };
  kc: { kc_id: string; name: string; mastery: number; status: string };
  assessment: { assessment_id: string; title: string; due_at: string; weight_pct: number | null } | null;
  planned_minutes: AvailableMinutes;
  question_count: number | null;
  action_href: string;
  reasons: NextMoveReason[];
};

export type NextMoveResponse = {
  generated_at: string;
  available_minutes: AvailableMinutes;
  recommendation: NextMove | null;
  alternatives: NextMove[];
};
