// Validates the courses/<slug>/exercises.json Zod schema (courses/exercise-schema.md,
// schema_version 1) against inline fixtures for each kind — pure contract
// tests, no D1/workerd involved (see tests/exercises.test.ts for the
// D1-backed service tests).
import { describe, expect, it } from 'vitest';
import { exerciseFileSchema, exerciseSchema } from '../src/lib/content/exercises';

const mcqFixture = {
  kc: 'bernoulli-equation',
  slug: 'bernoulli-basic-mcq',
  kind: 'mcq',
  difficulty: 1,
  prompt: 'A fluid flows steadily along a streamline. As velocity increases, pressure...',
  source: 'Bird, Stewart & Lightfoot, Transport Phenomena 2e, style',
  options: ['decreases', 'increases', 'stays constant', 'depends on viscosity only'],
  correct_index: 0,
  explanation: 'Bernoulli trades velocity head for pressure head along a streamline; the others misapply the relation.',
};

const numericFixture = {
  kc: 'bernoulli-equation',
  slug: 'bernoulli-pipe-numeric',
  kind: 'numeric',
  difficulty: 2,
  prompt: 'Given v1 = 2 m/s, v2 = 4 m/s, rho = 1000 kg/m^3, find dP = P1 - P2 in Pa.',
  source: 'Course-material style problem',
  answer: { value: 6000, unit: 'Pa', tolerance_pct: 2 },
  solution: 'dP = 0.5*rho*(v2^2 - v1^2) = 0.5*1000*(16-4) = 6000 Pa.',
};

const workedFixture = {
  kc: 'bernoulli-equation',
  slug: 'bernoulli-venturi-worked',
  kind: 'worked',
  difficulty: 3,
  prompt: 'Derive the throat velocity of a venturi meter given the area ratio and pressure drop.',
  source: 'OCW-style derivation',
  solution: 'Starting from Bernoulli and continuity: ... (full derivation).',
};

describe('exerciseSchema', () => {
  it('accepts a valid mcq exercise', () => {
    expect(() => exerciseSchema.parse(mcqFixture)).not.toThrow();
  });

  it('accepts a valid numeric exercise', () => {
    expect(() => exerciseSchema.parse(numericFixture)).not.toThrow();
  });

  it('accepts a valid worked exercise', () => {
    expect(() => exerciseSchema.parse(workedFixture)).not.toThrow();
  });

  it('defaults numeric tolerance_pct to 2 when omitted', () => {
    const { tolerance_pct: _drop, ...answerWithoutTolerance } = numericFixture.answer;
    const fixture = { ...numericFixture, answer: answerWithoutTolerance };
    const parsed = exerciseSchema.parse(fixture);
    expect(parsed.kind).toBe('numeric');
    if (parsed.kind === 'numeric') expect(parsed.answer.tolerance_pct).toBe(2);
  });

  it('accepts a null unit on a numeric answer (dimensionless)', () => {
    const fixture = { ...numericFixture, answer: { ...numericFixture.answer, unit: null } };
    expect(() => exerciseSchema.parse(fixture)).not.toThrow();
  });

  it('rejects an invalid kind', () => {
    expect(() => exerciseSchema.parse({ ...mcqFixture, kind: 'flashcard' })).toThrow();
  });

  it('rejects a non-kebab-case kc slug', () => {
    expect(() => exerciseSchema.parse({ ...mcqFixture, kc: 'Bernoulli_Equation' })).toThrow();
  });

  it('rejects a non-kebab-case exercise slug', () => {
    expect(() => exerciseSchema.parse({ ...mcqFixture, slug: 'Not Kebab' })).toThrow();
  });

  it('rejects difficulty outside 1|2|3', () => {
    expect(() => exerciseSchema.parse({ ...mcqFixture, difficulty: 4 })).toThrow();
  });

  it('rejects mcq missing required fields (options/correct_index/explanation)', () => {
    const { options: _o, correct_index: _c, explanation: _e, ...bad } = mcqFixture;
    expect(() => exerciseSchema.parse(bad)).toThrow();
  });

  it('rejects mcq with fewer than 3 options', () => {
    expect(() => exerciseSchema.parse({ ...mcqFixture, options: ['a', 'b'] })).toThrow();
  });

  it('rejects mcq with more than 5 options', () => {
    expect(() => exerciseSchema.parse({ ...mcqFixture, options: ['a', 'b', 'c', 'd', 'e', 'f'] })).toThrow();
  });

  it('rejects mcq with correct_index >= options.length', () => {
    expect(() => exerciseSchema.parse({ ...mcqFixture, correct_index: 4 })).toThrow();
  });

  it('rejects numeric missing required fields (answer/solution)', () => {
    const { answer: _a, solution: _s, ...bad } = numericFixture;
    expect(() => exerciseSchema.parse(bad)).toThrow();
  });

  it('rejects worked missing solution', () => {
    const { solution: _s, ...bad } = workedFixture;
    expect(() => exerciseSchema.parse(bad)).toThrow();
  });

  it('rejects mcq carrying numeric-only fields (strict cross-kind leakage)', () => {
    expect(() => exerciseSchema.parse({ ...mcqFixture, answer: numericFixture.answer })).toThrow();
  });

  it('rejects unknown keys (strict object)', () => {
    expect(() => exerciseSchema.parse({ ...mcqFixture, unexpected: true })).toThrow();
  });
});

describe('exerciseFileSchema', () => {
  it('accepts a minimal valid file with all three kinds', () => {
    const file = { schema_version: 1, exercises: [mcqFixture, numericFixture, workedFixture] };
    expect(() => exerciseFileSchema.parse(file)).not.toThrow();
  });

  it('rejects a schema_version other than 1', () => {
    const file = { schema_version: 2, exercises: [mcqFixture] };
    expect(() => exerciseFileSchema.parse(file)).toThrow();
  });

  it('rejects a duplicate (kc, slug) pair within the file', () => {
    const file = { schema_version: 1, exercises: [mcqFixture, { ...workedFixture, kc: mcqFixture.kc, slug: mcqFixture.slug }] };
    expect(() => exerciseFileSchema.parse(file)).toThrow();
  });

  it('allows the same slug across two different kcs', () => {
    const file = {
      schema_version: 1,
      exercises: [mcqFixture, { ...mcqFixture, kc: 'unit-conversion' }],
    };
    expect(() => exerciseFileSchema.parse(file)).not.toThrow();
  });
});
