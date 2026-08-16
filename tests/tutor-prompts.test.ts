import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, modeForKcType, type TutorContext } from '../src/lib/services/tutor/prompts';

function baseCtx(overrides: Partial<TutorContext> = {}): TutorContext {
  return {
    kc: { name: 'Bernoulli Equation', type: 'principle', description: null, practiceNotes: null },
    branchName: 'Fluid Mechanics',
    course: { title: 'CHEE 310', overview: null },
    mastery: 55,
    status: 'review',
    recentEvents: [],
    linkedNotes: [],
    mode: 'interactive_model',
    ...overrides,
  };
}

describe('modeForKcType', () => {
  it('defaults principle to interactive_model (absorb is always explicit, never derived)', () => {
    expect(modeForKcType('principle')).toBe('interactive_model');
    expect(modeForKcType('fact')).toBe('recall');
    expect(modeForKcType('association')).toBe('recall');
    expect(modeForKcType('concept')).toBe('classify');
    expect(modeForKcType('rule')).toBe('worked_example');
  });
});

describe('buildSystemPrompt — absorb mode', () => {
  it('omits the absorb context block entirely for non-absorb modes', () => {
    const prompt = buildSystemPrompt(baseCtx({ mode: 'interactive_model' }));
    expect(prompt).not.toContain('Focus order');
    expect(prompt).not.toContain('Prerequisite readiness');
  });

  it('includes the staged absorb instructions with all four stages', () => {
    const prompt = buildSystemPrompt(
      baseCtx({
        mode: 'absorb',
        absorb: { focusOrder: [], prereqs: [], misconceptions: [], scaffolds: [] },
      }),
    );
    expect(prompt).toContain('Stage A');
    expect(prompt).toContain('Stage B');
    expect(prompt).toContain('Stage C');
    expect(prompt).toContain('Stage D');
    expect(prompt).toContain('correction_proposal');
  });

  it('renders prereqs, focus_order, misconceptions, and scaffolds with the fading-level rule', () => {
    const prompt = buildSystemPrompt(
      baseCtx({
        mode: 'absorb',
        mastery: 55,
        absorb: {
          focusOrder: ['kc-pressure', 'kc-velocity'],
          prereqs: [
            { kcId: 'kc-velocity', slug: 'velocity', name: 'Velocity', kcType: 'concept', mastery: 30, status: 'learning', ready: false, depth: 1 },
            { kcId: 'kc-pressure', slug: 'pressure', name: 'Pressure', kcType: 'concept', mastery: 60, status: 'review', ready: true, depth: 1 },
          ],
          misconceptions: [
            {
              slug: 'pressure-vs-force',
              name: 'Pressure/force conflation',
              description: 'Students conflate pressure and force.',
              rootCause: 'Everyday language uses "pressure" and "force" interchangeably.',
              diagnosticProbe: 'If you double the area but keep the force the same, does the pressure change?',
              correction: 'Pressure is force per unit area, not force itself.',
            },
          ],
          scaffolds: [{ kind: 'worked_example', level: 2, title: 'Venturi worked example', body: 'Step-by-step Venturi tube derivation.' }],
        },
      }),
    );

    // focus_order ordering
    expect(prompt).toContain('Focus order');
    expect(prompt).toContain('kc-pressure, kc-velocity');

    // prereq readiness
    expect(prompt).toContain('Velocity');
    expect(prompt).toContain('NOT ready');
    expect(prompt).toContain('Pressure');

    // misconceptions with root cause + diagnostic probe
    expect(prompt).toContain('pressure-vs-force');
    expect(prompt).toContain('Root cause');
    expect(prompt).toContain('Diagnostic probe');

    // scaffolds + fading-level rule
    expect(prompt).toContain('Venturi worked example');
    expect(prompt).toContain('level 1 = high support for mastery below 40%');
    expect(prompt).toContain('level 2 = medium support for 40-79%');
    expect(prompt).toContain('level 3 = low/independent support at 80%+');
  });

  it('states "no prerequisites" and falls back to depth order when focus_order is empty', () => {
    const prompt = buildSystemPrompt(
      baseCtx({
        mode: 'absorb',
        absorb: { focusOrder: [], prereqs: [], misconceptions: [], scaffolds: [] },
      }),
    );
    expect(prompt).toContain('no recorded prerequisites');
    expect(prompt).toContain('none declared');
    expect(prompt).toContain('depth order');
  });
});
