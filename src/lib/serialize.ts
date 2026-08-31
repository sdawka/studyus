// Converts service-layer values (Drizzle rows: camelCase keys, epoch-ms
// timestamps) into the frozen API shape (snake_case keys, ISO datetime
// strings) documented in docs/api.md. Every route wraps its `apiOk` payload
// with `toApi` so this conversion happens in exactly one place.
import { toSafeIsoString } from './dateField';

const DATE_KEY_PATTERN = /(_at|_date)$/;

// Bare-named epoch-ms fields that don't fit DATE_KEY_PATTERN's `_at`/`_date`
// suffix (alongside the existing `ts` special-case below): class_sessions'
// `date` column is a bare epoch-ms noon-of-day value, not `_date`-suffixed.

// Freeform/opaque fields whose *contents* are not part of the frozen
// contract (client-supplied JSON) — key-cased but never recursed into or
// date-converted.
const OPAQUE_KEYS = new Set(['payload', 'settings', 'details']);

function camelToSnake(key: string): string {
  return key.replace(/([A-Z])/g, '_$1').toLowerCase();
}

function transform(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(transform);

  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const snakeKey = camelToSnake(key);

      if (OPAQUE_KEYS.has(key) || OPAQUE_KEYS.has(snakeKey)) {
        out[snakeKey] = v;
        continue;
      }

      if (typeof v === 'number' && (DATE_KEY_PATTERN.test(snakeKey) || snakeKey === 'ts' || snakeKey === 'date')) {
        // Every date-shaped column here is a NOT NULL epoch-ms integer the
        // app itself wrote, so this is normally always a valid instant —
        // but this one function sits behind every API route's response, so
        // a single corrupt row (bad migration, manual DB edit) must not
        // 500 the whole payload. Fall back to null rather than throw.
        out[snakeKey] = toSafeIsoString(v);
      } else if (v !== null && typeof v === 'object') {
        out[snakeKey] = transform(v);
      } else {
        out[snakeKey] = v;
      }
    }
    return out;
  }

  return value;
}

// Typed as `<T>(value: T): T` (rather than `unknown`) purely so callers can
// still spread/access the result without extra casts; the actual keys and
// date fields are of course reshaped at runtime per `transform` above.
export function toApi<T>(value: T): T {
  return transform(value) as T;
}
