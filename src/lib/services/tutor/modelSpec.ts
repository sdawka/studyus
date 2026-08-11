// Interactive-model spec: parser + a SAFE arithmetic evaluator for the
// fenced ```json block a `principle`-mode tutor turn may emit. No eval/
// Function anywhere — the evaluator is a hand-rolled recursive-descent
// parser over a fixed, deliberately small grammar (see EXPRESSION_GRAMMAR
// below), so a formula can never do anything but arithmetic on the
// parameters it's given.
//
// This module has no server-only imports (no drizzle/cloudflare) so it can
// be imported directly by the browser bundle — ScaffoldChat.svelte uses
// `extractModelSpec` to detect a spec in a streamed reply, and
// InteractiveModel.svelte uses `evaluateModelSpec` to recompute outputs
// live as sliders move.
import { z } from 'zod';

export const modelSpecParameterSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  min: z.number(),
  max: z.number(),
  step: z.number().optional(),
  default: z.number(),
  unit: z.string().optional(),
});

export const modelSpecExpressionSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  formula: z.string().min(1),
});

export const modelSpecSchema = z.object({
  title: z.string().optional(),
  parameters: z.array(modelSpecParameterSchema).min(1),
  expressions: z.array(modelSpecExpressionSchema).optional(),
  notes: z.string().optional(),
});

export type ModelSpec = z.infer<typeof modelSpecSchema>;

// EXPRESSION_GRAMMAR: numbers, identifiers (parameter ids or the constants
// pi/e), the operators + - * / ^, parens, and single-argument function
// calls limited to sqrt/sin/cos/tan/log/exp/abs. Nothing else parses.
export const EXPRESSION_GRAMMAR = '+ - * / ^ ( ) sqrt sin cos tan log exp abs pi e';

export const MODEL_SPEC_INSTRUCTIONS = `When this KC's rationale can be explored interactively, you MAY (at most once per message, after your prose) emit a single fenced json block the UI will render as sliders with live-computed outputs. Format exactly:

\`\`\`json
{
  "title": "Short title",
  "parameters": [
    { "id": "velocity", "label": "Velocity", "min": 0, "max": 50, "step": 1, "default": 10, "unit": "m/s" }
  ],
  "expressions": [
    { "id": "pressure", "label": "Pressure", "formula": "101325 - 0.5 * 1000 * velocity^2" }
  ],
  "notes": "Optional short note about what to look at."
}
\`\`\`

Rules: every "id" is a short identifier with no spaces; a "formula" may reference only the parameter ids you defined plus numbers and the operators/functions ${EXPRESSION_GRAMMAR} — nothing else parses (no other syntax, no assignments, no comparisons). Emit at most one such block. If you don't have a good interactive model to offer yet, don't emit the block — plain conversation is always a valid fallback.`;

/** Looks for exactly one fenced \`\`\`json block and validates it against
 *  modelSpecSchema. Any failure (no block, invalid JSON, schema mismatch)
 *  degrades to `null` — callers treat the whole message as prose. */
export function extractModelSpec(text: string): ModelSpec | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (!fenced) return null;
  try {
    const raw = JSON.parse(fenced[1]);
    const parsed = modelSpecSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpressionError';
  }
}

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };
const FUNCTIONS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  log: Math.log,
  exp: Math.exp,
  abs: Math.abs,
};

type Token = { type: 'num' | 'ident' | 'op' | 'lparen' | 'rparen'; value: string };

function tokenize(formula: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < formula.length && /[0-9.]/.test(formula[j])) j++;
      const numStr = formula.slice(i, j);
      if (!/^\d*\.?\d+$/.test(numStr)) throw new ExpressionError(`Invalid number "${numStr}"`);
      tokens.push({ type: 'num', value: numStr });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < formula.length && /[a-zA-Z0-9_]/.test(formula[j])) j++;
      tokens.push({ type: 'ident', value: formula.slice(i, j) });
      i = j;
      continue;
    }
    if ('+-*/^'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen', value: ch });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', value: ch });
      i++;
      continue;
    }
    throw new ExpressionError(`Unexpected character "${ch}" in formula "${formula}"`);
  }
  return tokens;
}

// Recursive-descent parser: expr := term (('+'|'-') term)*
//                            term := unary (('*'|'/') unary)*
//                            unary := '-' unary | '+' unary | power
//                            power := primary ('^' unary)?   (right-assoc)
//                            primary := num | ident | ident '(' expr ')' | '(' expr ')'
function evaluateTokens(tokens: Token[], vars: Record<string, number>): number {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr(): number {
    let value = parseTerm();
    while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = next().value;
      const rhs = parseTerm();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  }

  function parseTerm(): number {
    let value = parseUnary();
    while (peek() && peek().type === 'op' && (peek().value === '*' || peek().value === '/')) {
      const op = next().value;
      const rhs = parseUnary();
      if (op === '/' && rhs === 0) throw new ExpressionError('Division by zero');
      value = op === '*' ? value * rhs : value / rhs;
    }
    return value;
  }

  function parseUnary(): number {
    if (peek() && peek().type === 'op' && peek().value === '-') {
      next();
      return -parseUnary();
    }
    if (peek() && peek().type === 'op' && peek().value === '+') {
      next();
      return parseUnary();
    }
    return parsePower();
  }

  function parsePower(): number {
    const base = parsePrimary();
    if (peek() && peek().type === 'op' && peek().value === '^') {
      next();
      const exponent = parseUnary();
      return Math.pow(base, exponent);
    }
    return base;
  }

  function parsePrimary(): number {
    const tok = peek();
    if (!tok) throw new ExpressionError('Unexpected end of formula');

    if (tok.type === 'num') {
      next();
      return Number(tok.value);
    }
    if (tok.type === 'lparen') {
      next();
      const value = parseExpr();
      if (!peek() || peek().type !== 'rparen') throw new ExpressionError('Expected closing parenthesis');
      next();
      return value;
    }
    if (tok.type === 'ident') {
      next();
      const name = tok.value;
      if (peek() && peek().type === 'lparen') {
        next();
        const arg = parseExpr();
        if (!peek() || peek().type !== 'rparen') throw new ExpressionError('Expected closing parenthesis after function argument');
        next();
        const fn = FUNCTIONS[name];
        if (!fn) throw new ExpressionError(`Unknown function "${name}"`);
        return fn(arg);
      }
      if (name in CONSTANTS) return CONSTANTS[name];
      if (name in vars) return vars[name];
      throw new ExpressionError(`Unknown identifier "${name}"`);
    }
    throw new ExpressionError(`Unexpected token "${tok.value}"`);
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new ExpressionError('Unexpected trailing tokens in formula');
  if (!Number.isFinite(result)) throw new ExpressionError('Formula evaluated to a non-finite number');
  return result;
}

export function evaluateExpression(formula: string, vars: Record<string, number>): number {
  return evaluateTokens(tokenize(formula), vars);
}

export type ModelSpecOutput = { id: string; label?: string; value: number | null; error?: string };

/** Evaluates every expression in a spec against the given (or default)
 *  parameter values. Per-expression failures degrade to `{value: null,
 *  error}` rather than throwing, so one bad formula doesn't blank the whole
 *  panel. */
export function evaluateModelSpec(spec: ModelSpec, values: Record<string, number>): ModelSpecOutput[] {
  const vars: Record<string, number> = {};
  for (const p of spec.parameters) vars[p.id] = values[p.id] ?? p.default;

  return (spec.expressions ?? []).map((expr) => {
    try {
      return { id: expr.id, label: expr.label, value: evaluateExpression(expr.formula, vars) };
    } catch (err) {
      return { id: expr.id, label: expr.label, value: null, error: err instanceof Error ? err.message : 'Evaluation error' };
    }
  });
}
