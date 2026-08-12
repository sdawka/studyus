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
