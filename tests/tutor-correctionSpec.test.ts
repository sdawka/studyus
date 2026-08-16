import { describe, expect, it } from 'vitest';
import { extractCorrectionProposal } from '../src/lib/services/tutor/correctionSpec';

describe('extractCorrectionProposal', () => {
  it('extracts a valid correction_proposal block', () => {
    const text = [
      "That makes sense given what you said, but let's look closer.",
      '```json',
      JSON.stringify({
        type: 'correction_proposal',
        misconception_slug: 'pressure-vs-force',
        prior_belief: 'Pressure and force are the same thing.',
        correction: 'Pressure is force distributed over an area — the same force can produce very different pressures.',
      }),
      '```',
    ].join('\n');

    const result = extractCorrectionProposal(text);
    expect(result).toEqual({
      type: 'correction_proposal',
      misconception_slug: 'pressure-vs-force',
      prior_belief: 'Pressure and force are the same thing.',
      correction: 'Pressure is force distributed over an area — the same force can produce very different pressures.',
    });
  });

  it('omits misconception_slug for a freeform correction', () => {
    const text = [
      '```json',
      JSON.stringify({
        type: 'correction_proposal',
        prior_belief: 'Heavier objects always fall faster.',
        correction: 'In a vacuum, all objects fall at the same rate regardless of mass.',
      }),
      '```',
    ].join('\n');

    const result = extractCorrectionProposal(text);
    expect(result?.misconception_slug).toBeUndefined();
    expect(result?.prior_belief).toBe('Heavier objects always fall faster.');
  });

  it('returns null when there is no fenced json block', () => {
    expect(extractCorrectionProposal('Just plain prose, no blocks here.')).toBeNull();
  });

  it('returns null when the block is invalid JSON', () => {
    const text = '```json\n{ not valid json\n```';
    expect(extractCorrectionProposal(text)).toBeNull();
  });

  it('returns null when the block is valid JSON but the wrong shape (e.g. an interactive_model spec)', () => {
    const text = [
      '```json',
      JSON.stringify({
        title: 'Pressure vs velocity',
        parameters: [{ id: 'v', min: 0, max: 10, default: 1 }],
      }),
      '```',
    ].join('\n');

    expect(extractCorrectionProposal(text)).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    const text = '```json\n{"type": "correction_proposal", "correction": "The correct model."}\n```';
    expect(extractCorrectionProposal(text)).toBeNull();
  });

  it('finds a correction_proposal block even when an interactive_model block appears first in the same message', () => {
    const text = [
      'Here is a model to explore:',
      '```json',
      JSON.stringify({ title: 'Model', parameters: [{ id: 'x', min: 0, max: 1, default: 0.5 }] }),
      '```',
      'And here is a correction based on what you said:',
      '```json',
      JSON.stringify({
        type: 'correction_proposal',
        prior_belief: 'A vacuum has no air resistance because it has no gravity.',
        correction: 'A vacuum has no air resistance because there is no air/gas to resist motion — gravity is unrelated.',
      }),
      '```',
    ].join('\n');

    const result = extractCorrectionProposal(text);
    expect(result?.type).toBe('correction_proposal');
    expect(result?.prior_belief).toContain('vacuum has no air resistance');
  });

  it('returns null when extra prose surrounds a block that is not a correction_proposal', () => {
    const text = 'Some prose.\n```json\n{"foo": "bar"}\n```\nMore prose.';
    expect(extractCorrectionProposal(text)).toBeNull();
  });
});
