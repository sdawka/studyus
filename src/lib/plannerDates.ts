// Local-date helpers shared by the planner views. The previous month/agenda
// views keyed days with `iso.slice(0, 10)` / `date.toISOString().slice(0,10)`,
// which reads the UTC calendar day — wrong for any user west of UTC in the
// evening. Everything here keys/derives against the *local* calendar day.

export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function localDateKeyFromIso(iso: string): string {
  return localDateKey(new Date(iso));
}

export function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

// Monday of the week containing `d` (ISO week start), local time.
export function mondayOf(d: Date): Date {
  const r = startOfDay(d);
  const dow = r.getDay(); // 0 = Sun .. 6 = Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  return addDays(r, diff);
}

export function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function weekRangeLabel(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  const sameMonth = weekStart.getMonth() === end.getMonth() && weekStart.getFullYear() === end.getFullYear();
  const optsStart: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const optsEnd: Intl.DateTimeFormatOptions = sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' };
  const startLabel = weekStart.toLocaleDateString(undefined, optsStart);
  const endLabel = end.toLocaleDateString(undefined, optsEnd);
  const year = end.getFullYear();
  return `${startLabel} – ${endLabel}, ${year}`;
}

export function timeRangeLabel(start: Date, end: Date | null): string {
  const fmt = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(' ', '');
  if (!end) return fmt(start);
  return `${fmt(start)} – ${fmt(end)}`;
}

// Snap a Date down to the nearest 15-minute increment.
export function snap15(d: Date): Date {
  const r = new Date(d);
  const m = r.getMinutes();
  r.setMinutes(m - (m % 15), 0, 0);
  return r;
}

// Offset a Date by `n` minutes (negative moves earlier). Shared by the
// planner's drag-create range math and EventPopover's reschedule nudges.
export function addMinutes(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 60_000);
}

// ---------------------------------------------------------------------------
// "Due in N days" — shared day-math plus the per-surface label wording that
// grew independently in TaskItem, dashboard/DeadlinesList, and
// planner/PlannerRail. The three surfaces render genuinely different
// strings/shapes (not just a shared string with a tweaked threshold), so
// each keeps its own function below — only the day-count arithmetic is
// centralized.
// ---------------------------------------------------------------------------

// Whole calendar days between `now`'s local day and `date`'s local day
// (negative = in the past). Every "due in N days" surface computed this
// exact thing independently via its own pair of setHours(0,0,0,0) calls.
export function daysUntil(date: string | number | Date, now: Date = new Date()): number {
  const target = startOfDay(date instanceof Date ? date : new Date(date));
  const today = startOfDay(now);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

// TaskItem's due pill: {label, danger}. `isAttendClass` sinks an overdue
// attend_class task to a non-danger "catch up" — missing a class isn't a
// broken commitment the way a missed assignment is (mirrors
// stores/tasks.ts's bucketByDue, which special-cases the same type).
export function taskDueMeta(days: number, isAttendClass = false): { label: string; danger: boolean } {
  if (days < 0) {
    if (isAttendClass) return { label: 'catch up', danger: false };
    return { label: 'overdue', danger: true };
  }
  if (days === 0) return { label: 'Today', danger: false };
  if (days === 1) return { label: 'Tomorrow', danger: false };
  return { label: `in ${days}d`, danger: false };
}

// dashboard/DeadlinesList's due pill: {cls, label}. Same "Today"/"Tomorrow"/
// "in Nd" wording as taskDueMeta, plus an extra ≤3-day "closing in" warn
// tier this surface alone renders (the label text is identical across the
// 2-3 day and >3 day cases — only the pill class changes).
export function deadlineUrgency(days: number): { cls: string; label: string } {
  if (days < 0) return { cls: 'pill-danger', label: 'overdue' };
  if (days === 0) return { cls: 'pill-danger', label: 'Today' };
  if (days === 1) return { cls: 'pill-warn', label: 'Tomorrow' };
  if (days <= 3) return { cls: 'pill-warn', label: `in ${days}d` };
  return { cls: 'pill-idle', label: `in ${days}d` };
}

// PlannerRail's due label: a plain string, "Nd overdue" wording (not just
// "overdue") once past due, and a real calendar date (not "in Nd") once
// past tomorrow.
export function railDueLabel(days: number, date: string | number | Date): string {
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// Plain date/time formatters — the ~7 hand-rolled toLocaleDateString/
// relative-time formatters scattered across the standing cards, the
// notifications bell, and the dashboard deadlines list.
// ---------------------------------------------------------------------------

// "Aug 15" — DeadlinesCard, RecentActivityCard, dashboard/DeadlinesList.
export function formatShortDate(date: string | number | Date): string {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// "Aug 15, 2026" with a 'No due date' fallback for null — standing/AssessmentsCard.
export function formatDueDate(iso: string | null): string {
  if (!iso) return 'No due date';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// today / yesterday / "N days ago" / "Nw ago" / falls back to formatShortDate
// past 30 days — standing/PracticeCard's "last practiced" line.
export function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return formatShortDate(iso);
}

// "just now" / "Nm ago" / "Nh ago" / "Nd ago" (minute-grained, no absolute-
// date fallback) — shell/NotificationsBell.
export function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

// {weekday, date} — standing/AttendanceCard's per-session row.
export function formatWeekdayAndDate(date: string | number | Date): { weekday: string; date: string } {
  const d = date instanceof Date ? date : new Date(date);
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
    date: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  };
}
