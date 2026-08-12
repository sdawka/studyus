// Shared CalendarItem shape — FROZEN, built against by other agents/islands.
// getCalendar (src/lib/services/calendar.ts) is the only producer; do not
// duplicate this shape elsewhere.
export type CalendarItemType = 'assessment_due' | 'task_due' | 'study_session' | 'event_logged';

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
