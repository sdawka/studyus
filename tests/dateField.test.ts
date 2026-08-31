import { describe, expect, it } from 'vitest';
import { dateOnlyInputToIso, toSafeIsoString } from '../src/lib/dateField';

// The trap this helper exists for: `new Date(x).toISOString()` throws a
// RangeError ("Invalid time value") whenever `x` doesn't parse to a real
// instant — an empty or cleared <input>, free text, or a corrupted
// API/DB value all produce an Invalid Date silently, and only the
// `.toISOString()` call blows up. Several call sites did this inside a bare
// `try { ... } finally { busy = false }` with no `catch`, so the click/submit
// handler just died with nothing visible to the user.
describe('toSafeIsoString', () => {
  it('converts a valid Date, epoch ms, and ISO string to the same instant', () => {
    const ms = 1700000000000;
    const iso = new Date(ms).toISOString();
    expect(toSafeIsoString(new Date(ms))).toBe(iso);
    expect(toSafeIsoString(ms)).toBe(iso);
    expect(toSafeIsoString(iso)).toBe(iso);
  });

  it('converts a datetime-local input value to its ISO instant', () => {
    expect(toSafeIsoString('2026-08-29T14:30')).toBe(new Date('2026-08-29T14:30').toISOString());
  });

  it('returns null for empty, null, or undefined input rather than throwing', () => {
    expect(toSafeIsoString('')).toBeNull();
    expect(toSafeIsoString(null)).toBeNull();
    expect(toSafeIsoString(undefined)).toBeNull();
  });

  it('returns null for unparseable text instead of throwing', () => {
    expect(toSafeIsoString('garbage')).toBeNull();
    expect(toSafeIsoString('not-a-date')).toBeNull();
  });

  it('returns null for a Date/number that is already invalid (e.g. NaN)', () => {
    expect(toSafeIsoString(new Date('garbage'))).toBeNull();
    expect(toSafeIsoString(NaN)).toBeNull();
  });

  it('never throws on any input', () => {
    for (const raw of [null, undefined, '', 'garbage', 0, NaN, Infinity, new Date(NaN), new Date()]) {
      expect(() => toSafeIsoString(raw as never)).not.toThrow();
    }
  });
});

describe('dateOnlyInputToIso', () => {
  it('anchors a day-only value at local noon, not local midnight', () => {
    const iso = dateOnlyInputToIso('2026-08-29');
    expect(iso).toBe(new Date('2026-08-29T12:00:00').toISOString());
  });

  it('returns null for an empty value rather than an empty-anchored garbage string', () => {
    expect(dateOnlyInputToIso('')).toBeNull();
  });

  it('returns null for an unparseable value instead of throwing', () => {
    expect(dateOnlyInputToIso('garbage')).toBeNull();
  });

  it('never throws on any input', () => {
    for (const raw of ['', 'garbage', '2026-08-29', '0000-00-00']) {
      expect(() => dateOnlyInputToIso(raw)).not.toThrow();
    }
  });
});
