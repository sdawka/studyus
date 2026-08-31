import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toApi } from '../src/lib/serialize';
import { toEpochMs, toIso } from '../src/lib/schemas/common';

describe('toApi', () => {
  it('camelCases keys and converts _at/_date-suffixed epoch-ms numbers to ISO strings, recursing to any depth', () => {
    const ms = 1700000000000;
    const input = {
      createdAt: ms,
      dueDate: ms,
      title: 'Task',
      nested: {
        updatedAt: ms,
        deep: { completedAt: ms, label: 'x' },
      },
    };

    const out = toApi(input) as any;
    expect(out.created_at).toBe(new Date(ms).toISOString());
    expect(out.due_date).toBe(new Date(ms).toISOString());
    expect(out.title).toBe('Task');
    expect(out.nested.updated_at).toBe(new Date(ms).toISOString());
    expect(out.nested.deep.completed_at).toBe(new Date(ms).toISOString());
    expect(out.nested.deep.label).toBe('x');
  });

  it('recurses into arrays of objects, converting each element', () => {
    const out = toApi({ items: [{ createdAt: 1 }, { createdAt: 2 }] }) as any;
    expect(out.items).toEqual([{ created_at: new Date(1).toISOString() }, { created_at: new Date(2).toISOString() }]);
  });

  it('key-cases OPAQUE_KEYS (settings/payload/details) but leaves their contents completely untouched, even with date-shaped inner keys', () => {
    const input = {
      payload: { correctAt: 1700000000000, sessionId: 'abc', nested: { updatedAt: 999 } },
      settings: { theme: 'dark', taskGenerators: { attendClass: true } },
      details: { ts: 123, date: 456 },
    };

    const out = toApi(input) as any;
    // Values pass through byte-for-byte: no recursion, no date conversion,
    // camelCase inner keys are NOT snake_cased.
    expect(out.payload).toEqual(input.payload);
    expect(out.settings).toEqual(input.settings);
    expect(out.details).toEqual(input.details);
  });

  it('converts bare `date`/`ts` numeric fields (DATE_KEY_PATTERN special cases) but leaves other bare numeric fields alone', () => {
    const ms = 1700000000000;
    const out = toApi({ date: ms, ts: ms, count: ms }) as any;
    expect(out.date).toBe(new Date(ms).toISOString());
    expect(out.ts).toBe(new Date(ms).toISOString());
    expect(out.count).toBe(ms);
  });

  it('leaves non-numeric _at/_date-suffixed values (e.g. already-null) alone', () => {
    const out = toApi({ completedAt: null, dueDate: undefined }) as any;
    expect(out.completed_at).toBeNull();
    expect(out.due_date).toBeUndefined();
  });

  describe('a corrupt date-shaped value (NaN/Infinity)', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    it('falls back to null instead of throwing and 500ing the whole payload', () => {
      expect(() => toApi({ createdAt: NaN })).not.toThrow();
      const out = toApi({ createdAt: NaN }) as any;
      expect(out.created_at).toBeNull();
    });

    it('logs the offending field name and value rather than swallowing it silently', () => {
      toApi({ dueDate: Infinity });
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('due_date'), Infinity);
    });

    it('does not log anything for an ordinary valid date value', () => {
      toApi({ createdAt: 1700000000000 });
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});

describe('toEpochMs', () => {
  it('falls back to `now` (default fallback) when the string is unparseable', () => {
    const before = Date.now();
    const ms = toEpochMs('not-a-real-date');
    const after = Date.now();
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(after);
  });

  it('falls back to an explicit fallback value, not `now`, when given one', () => {
    expect(toEpochMs('not-a-real-date', 42)).toBe(42);
  });

  it('parses a valid ISO string to its exact epoch ms', () => {
    const iso = '2024-01-01T00:00:00.000Z';
    expect(toEpochMs(iso)).toBe(Date.parse(iso));
  });

  it('returns the fallback for null/undefined input without attempting to parse', () => {
    expect(toEpochMs(null, 7)).toBe(7);
    expect(toEpochMs(undefined, 7)).toBe(7);
  });
});

describe('toIso', () => {
  it('converts epoch ms to an ISO string, and null/undefined to null', () => {
    const ms = 1700000000000;
    expect(toIso(ms)).toBe(new Date(ms).toISOString());
    expect(toIso(null)).toBeNull();
    expect(toIso(undefined)).toBeNull();
  });
});
