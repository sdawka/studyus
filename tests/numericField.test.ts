import { describe, expect, it } from 'vitest';
import { isNumericFieldEmpty, numericFieldValue } from '../src/lib/numericField';

// The three types a `bind:value` on <input type="number"> actually produces:
// the seeded string (pristine), a number (parsed), and null (emptied, or the
// browser sanitised unparseable input away).
describe('numericFieldValue', () => {
  it('reads a pristine seeded string', () => {
    expect(numericFieldValue('85')).toBe(85);
    expect(numericFieldValue('87.5')).toBe(87.5);
    expect(numericFieldValue('-5')).toBe(-5);
  });

  it('reads the number Svelte writes once the field parses', () => {
    expect(numericFieldValue(85)).toBe(85);
    expect(numericFieldValue(0)).toBe(0);
  });

  it('treats a field the user cleared as empty rather than zero', () => {
    // The bug this helper exists for: Svelte writes null, `null === ''` is
    // false, and Number(null) is 0 — so a cleared grade was saved as a real 0.
    expect(numericFieldValue(null)).toBeNull();
    expect(numericFieldValue(undefined)).toBeNull();
    expect(numericFieldValue('')).toBeNull();
    expect(numericFieldValue('   ')).toBeNull();
  });

  it('distinguishes a deliberate zero from an empty field', () => {
    expect(numericFieldValue('0')).toBe(0);
    expect(numericFieldValue(0)).toBe(0);
    expect(numericFieldValue(null)).toBeNull();
  });

  it('rejects values that are not finite numbers', () => {
    // "1e400" is syntactically valid input that overflows to Infinity, which
    // JSON.stringify would then serialise as null.
    expect(numericFieldValue('1e400')).toBeNull();
    expect(numericFieldValue(Infinity)).toBeNull();
    expect(numericFieldValue(-Infinity)).toBeNull();
    expect(numericFieldValue(NaN)).toBeNull();
    expect(numericFieldValue('abc')).toBeNull();
  });

  it('never throws on any binding value', () => {
    for (const raw of [null, undefined, '', 'abc', 0, NaN, Infinity, {}, [], true]) {
      expect(() => numericFieldValue(raw)).not.toThrow();
    }
  });
});

describe('isNumericFieldEmpty', () => {
  it('is true only when there is no usable number', () => {
    expect(isNumericFieldEmpty(null)).toBe(true);
    expect(isNumericFieldEmpty('')).toBe(true);
    expect(isNumericFieldEmpty('abc')).toBe(true);
    expect(isNumericFieldEmpty(0)).toBe(false);
    expect(isNumericFieldEmpty('0')).toBe(false);
    expect(isNumericFieldEmpty(42)).toBe(false);
  });
});
