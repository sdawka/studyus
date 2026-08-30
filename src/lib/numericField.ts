// Reading a Svelte `bind:value` on an <input type="number">.
//
// The binding does NOT store the raw string the user typed. Svelte stores a
// `number` when the field parses, and `null` when it is empty — and the browser
// sanitises unparseable input like "abc" to empty before Svelte ever sees it.
// A pristine field that was seeded with a string still holds that string, so a
// draft object can hold all three types over its lifetime.
//
// Components here declared these drafts as `string` and then either guarded
// with `=== ''` (which silently fails open once the field is touched, so a
// cleared grade was sent as Number(null) === 0 rather than null) or called
// `.trim()` on them (which throws, because the value is a number or null).
// Route every read through this helper instead of re-deriving the rules.

/**
 * What a `bind:value` on <input type="number"> can actually hold: the seeded
 * string while pristine, a number once it parses, null once it is emptied.
 * Declare numeric draft fields with this rather than `string`, so that calling
 * a string method on one is a compile error instead of a runtime crash.
 */
export type NumericFieldBinding = string | number | null;

/**
 * The usable number in a numeric input binding, or null when the field is
 * empty or holds nothing parseable. Never throws, whatever the binding holds.
 */
export function numericFieldValue(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const trimmed = String(raw).trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** True when a numeric input binding holds no usable value. */
export function isNumericFieldEmpty(raw: unknown): boolean {
  return numericFieldValue(raw) === null;
}

/** What a numeric input binding should be reset to so it renders empty. */
export const EMPTY_NUMERIC_FIELD = '';
