import { describe, expect, it } from 'vitest';
import { evaluateExpression, evaluateModelSpec, extractModelSpec, ExpressionError } from '../src/lib/services/tutor/modelSpec';

describe('extractModelSpec', () => {
  it('parses a valid fenced json model spec', () => {
    const text = `Here's a model to explore.

\`\`\`json
{
  "title": "Bernoulli",
  "parameters": [{ "id": "v", "label": "Velocity", "min": 0, "max": 50, "default": 10, "unit": "m/s" }],
  "expressions": [{ "id": "p", "label": "Pressure", "formula": "101325 - 0.5 * 1000 * v^2" }],
  "notes": "Try increasing velocity."
}
\`\`\`

What do you predict happens to pressure as velocity increases?`;

    const spec = extractModelSpec(text);
    expect(spec).not.toBeNull();
    expect(spec?.title).toBe('Bernoulli');
    expect(spec?.parameters[0].id).toBe('v');
    expect(spec?.expressions?.[0].formula).toContain('v^2');
  });

  it('degrades to null when there is no fenced block', () => {
    expect(extractModelSpec('Just plain prose, no spec here.')).toBeNull();
  });

  it('degrades to null on invalid JSON inside the fence', () => {
    expect(extractModelSpec('```json\n{not valid json\n```')).toBeNull();
  });

  it('degrades to null when the JSON does not match the schema (missing parameters)', () => {
    expect(extractModelSpec('```json\n{"title": "x"}\n```')).toBeNull();
  });
});

describe('evaluateExpression (safe evaluator)', () => {
  it('evaluates basic arithmetic with operator precedence', () => {
    expect(evaluateExpression('2 + 3 * 4', {})).toBe(14);
    expect(evaluateExpression('(2 + 3) * 4', {})).toBe(20);
  });

  it('supports parameter variables', () => {
    expect(evaluateExpression('101325 - 0.5 * 1000 * v^2', { v: 10 })).toBeCloseTo(101325 - 0.5 * 1000 * 100);
  });

  it('supports functions and constants', () => {
    expect(evaluateExpression('sqrt(16)', {})).toBe(4);
    expect(evaluateExpression('abs(-5)', {})).toBe(5);
    expect(evaluateExpression('cos(0)', {})).toBe(1);
    expect(evaluateExpression('pi', {})).toBeCloseTo(Math.PI);
    expect(evaluateExpression('e', {})).toBeCloseTo(Math.E);
  });

  it('supports unary minus and right-associative power', () => {
    expect(evaluateExpression('-2^2', {})).toBe(-4); // unary applies after power: -(2^2)
    expect(evaluateExpression('2^3^2', {})).toBe(512); // right-assoc: 2^(3^2)
  });

  it('rejects unknown identifiers', () => {
    expect(() => evaluateExpression('nonsense_var + 1', {})).toThrow(ExpressionError);
  });

  it('rejects unknown functions and malformed syntax', () => {
    expect(() => evaluateExpression('evalHack(1)', {})).toThrow(ExpressionError);
    expect(() => evaluateExpression('1 +', {})).toThrow(ExpressionError);
    expect(() => evaluateExpression('(1 + 2', {})).toThrow(ExpressionError);
  });

  it('rejects division by zero', () => {
    expect(() => evaluateExpression('1 / 0', {})).toThrow(ExpressionError);
  });

  it('never uses eval or Function under the hood (no access to globals)', () => {
    // If this were `eval`-based, referencing a global like `process` or
    // `globalThis` would silently succeed instead of throwing "unknown identifier".
    expect(() => evaluateExpression('globalThis', {})).toThrow(ExpressionError);
  });
});

describe('evaluateModelSpec', () => {
  it('evaluates all expressions against default parameter values', () => {
    const spec = {
      parameters: [{ id: 'v', min: 0, max: 50, default: 10 }],
      expressions: [{ id: 'p', formula: '2 * v' }],
    };
    const outputs = evaluateModelSpec(spec, {});
    expect(outputs).toEqual([{ id: 'p', label: undefined, value: 20 }]);
  });

  it('degrades a single bad formula to a per-output error without throwing', () => {
    const spec = {
      parameters: [{ id: 'v', min: 0, max: 50, default: 10 }],
      expressions: [
        { id: 'good', formula: 'v + 1' },
        { id: 'bad', formula: 'unknownVar + 1' },
      ],
    };
    const outputs = evaluateModelSpec(spec, { v: 5 });
    expect(outputs[0]).toEqual({ id: 'good', label: undefined, value: 6 });
    expect(outputs[1].value).toBeNull();
    expect(outputs[1].error).toBeTruthy();
  });
});
