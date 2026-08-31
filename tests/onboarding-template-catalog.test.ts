import { describe, expect, it } from 'vitest';
import { listReviewedTemplates, proposalFromReviewedTemplate, searchReviewedTemplates } from '../src/lib/content/templateCatalog';

describe('reviewed onboarding template catalog', () => {
  it('lists the authored catalog and returns only browser-safe review data', () => {
    // The catalog is discovered from courses/*/content.json. Keep a floor for
    // the authored baseline without coupling this test to future course waves.
    expect(listReviewedTemplates().length).toBeGreaterThanOrEqual(9);
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

  it('includes the full McGill catalog with generated, editable KC outlines', () => {
    expect(listReviewedTemplates().length).toBeGreaterThan(9_000);
    const comp202 = proposalFromReviewedTemplate('mcgill-comp-202')!;
    expect(comp202.course).toMatchObject({ code: 'COMP 202', title: 'Foundations of Programming' });
    expect(comp202.branches.flatMap((branch) => branch.kcs).map((kc) => kc.name)).toContain('Variables');
    expect(comp202.branches.flatMap((branch) => branch.kcs).every((kc) => kc.source_refs[0]?.includes('McGill catalogue'))).toBe(true);
    expect(proposalFromReviewedTemplate('mcgill-acct-626')?.course.credits).toBe(1.5);
  });

  it('searches metadata and KC names without exposing authored answer data', () => {
    const results = searchReviewedTemplates('fluid properties');
    expect(results.map((course) => course.template_id)).toContain('chee-314-fluid-mechanics');
    expect(searchReviewedTemplates('CHEE 314')[0]?.code).toBe('CHEE 314');
    expect(searchReviewedTemplates('comp202')[0]?.template_id).toBe('mcgill-comp-202');
    expect(searchReviewedTemplates('programming variables').map((course) => course.template_id)).toContain('mcgill-comp-202');
    expect(searchReviewedTemplates('computer science', { level: 'graduate', limit: 25 }).every((course) => course.levels?.includes('graduate') || course.level === 'graduate')).toBe(true);
  });
});
