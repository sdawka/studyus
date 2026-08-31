// Reading a Svelte `bind:value` on <input type="date"> / <input
// type="datetime-local">, or re-serializing a Date/epoch/ISO value that
// already round-tripped through an API response, a fetch payload, or a DB
// column.
//
// Unlike a number input's binding (see numericField.ts), these always bind a
// plain string — never null — so an empty or cleared field is just ''. The
// trap is downstream: nearly every call site eventually does
// `new Date(x).toISOString()` to produce the ISO string a fetch body or API
// contract expects. `new Date(...)` never throws — '', 'garbage', and a
// corrupted upstream value all just produce an Invalid Date silently — but
// `.toISOString()` on an Invalid Date throws a RangeError ("Invalid time
// value"). Several call sites sat inside a bare `try { ... } finally { busy =
// false }` with no `catch`: the RangeError propagated straight out of the
// click/submit handler, so the busy flag reset but nothing else happened —
// no request sent, no error shown, nothing a user or a test could act on.
// Route every "serialize this maybe-invalid date/time as ISO" call through
// here instead of calling `.toISOString()` directly.

/**
 * The ISO instant for `value` (a Date, epoch ms, or any date-ish string —
 * including a raw `<input type="date">`/`datetime-local` binding), or null
 * when it is empty, unparseable, or otherwise not a real point in time.
 * Never throws.
 */
export function toSafeIsoString(value: Date | number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * ISO instant for a day-only `<input type="date">` binding, anchored to
 * local noon rather than local midnight — a later reparse in the browser's
 * own timezone (e.g. `setHours(0, 0, 0, 0)`) then always lands back on the
 * same calendar day (mirrors the app-wide due-date convention; see
 * dashboard/TodayTasks.svelte's `todayNoonIso`). Returns null for an empty
 * or unparseable value; never throws.
 */
export function dateOnlyInputToIso(value: string): string | null {
  return value ? toSafeIsoString(`${value}T12:00:00`) : null;
}
