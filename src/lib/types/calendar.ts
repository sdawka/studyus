// Shared CalendarItem shape — FROZEN, built against by other agents/islands.
// getCalendar (src/lib/services/calendar.ts) is the only producer; do not
// duplicate this shape elsewhere.
//
// `class_session` (v1.6): emitted only for a class_sessions row with a
// concrete meeting time (start_min/end_min both non-null); `details` is
// `{ status, note, source, task_id, start_min, end_min }` (task_id: the
// linked attend_class task's id, or null; start_min/end_min: the raw
// minute-of-day integers, duplicated here as the client's canonical
// positioning/label source). When emitted, it suppresses that session's
// linked attend_class task_due item — see getCalendar's dedupe rule.
//
// IMPORTANT — `date`/`end_date` on a `class_session` item are a best-effort
// ABSOLUTE instant (right calendar day; correct only if read back with
// getUTCHours/getUTCMinutes, matching class_sessions.date's own "UTC noon"
// convention), good enough for sorting/windowing across item types. There
// is no per-user timezone stored anywhere in this app, so start_min/end_min
// are wall-clock minutes with no fixed UTC relationship — a client MUST
// derive the displayed time-of-day (position, label) from
// `details.start_min`/`details.end_min` directly, never by reading
// hour/minute off the ISO fields via local Date getters (getHours()),
// which would apply the browser's real UTC offset and show the wrong time.
export type CalendarItemType = 'assessment_due' | 'task_due' | 'study_session' | 'event_logged' | 'class_session' | 'external_event';

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
