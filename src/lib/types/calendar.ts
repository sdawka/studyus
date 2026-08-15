// Shared CalendarItem shape — FROZEN, built against by other agents/islands.
// getCalendar (src/lib/services/calendar.ts) is the only producer; do not
// duplicate this shape elsewhere.
//
// `class_session` (v1.6): emitted only for a class_sessions row with a
// concrete meeting time (start_min/end_min both non-null); `details` is
// `{ status, note, source, task_id }` (task_id: the linked attend_class
// task's id, or null). When emitted, it suppresses that session's linked
// attend_class task_due item — see getCalendar's dedupe rule.
export type CalendarItemType = 'assessment_due' | 'task_due' | 'study_session' | 'event_logged' | 'class_session';

export interface CalendarItem {
  id: string;
  type: CalendarItemType;
  title: string;
  date: string; // ISO
  end_date: string | null; // ISO, timed items only
  all_day: boolean;
  course_id: string | null;
  href: string | null; // in-app deep link to the source page
  details: Record<string, unknown>;
}
