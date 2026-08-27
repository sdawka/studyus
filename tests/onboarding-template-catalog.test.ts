import { describe, expect, it } from 'vitest';
import { listReviewedTemplates, proposalFromReviewedTemplate } from '../src/lib/content/templateCatalog';

describe('reviewed onboarding template catalog', () => {
  it('lists the authored catalog and returns only browser-safe review data', () => {
    expect(listReviewedTemplates()).toHaveLength(9);
    const proposal = proposalFromReviewedTemplate('chee-310-physical-chemistry-for-engineers')!;
    expect(proposal.branches.flatMap((branch) => branch.kcs)).not.toHaveLength(0);
    expect(proposal.assessments.some((assessment) => assessment.kind === 'official' && assessment.date_status === 'unset')).toBe(true);

    const keys = new Set<string>();
    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) return value.forEach(visit);
      Object.entries(value).forEach(([key, child]) => { keys.add(key); visit(child); });
    };
    visit(proposal);
    expect(keys).not.toContain('correct_index');
    expect(keys).not.toContain('solution');
    expect(keys).not.toContain('diagnostic_probe');
    expect(keys).not.toContain('scaffolds');
  });
});
