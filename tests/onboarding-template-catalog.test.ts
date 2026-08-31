import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { listReviewedTemplates, proposalFromReviewedTemplate, searchReviewedTemplates } from '../src/lib/content/templateCatalog';
import { CATALOG_SAMPLE_SIZE, CATALOG_SOURCE_TOTAL, seedCatalogSample } from './setup/seed-catalog';

const db = getDb(env.DB);

// The generated catalogue lives in D1 now, so it has to be seeded. Every test
// file gets its own database and the suite runs in ~30s, so this seeds a
// deterministic slice of the real catalogue rather than all 9,994 rows — see
// tests/setup/seed-catalog.ts.
beforeAll(() => seedCatalogSample(env.DB));

describe('reviewed onboarding template catalog', () => {
  it('lists the authored catalog and returns only browser-safe review data', async () => {
    // The catalog is discovered from courses/*/content.json. Keep a floor for
    // the authored baseline without coupling this test to future course waves.
    expect((await listReviewedTemplates(db)).length).toBeGreaterThanOrEqual(9);
    const proposal = (await proposalFromReviewedTemplate(db, 'chee-310-physical-chemistry-for-engineers'))!;
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

  it('includes the McGill catalog with generated, editable KC outlines', async () => {
    // The floor this used to assert against the bundled catalog (>9,000
    // courses) now lives in the fixture's record of the catalogue it was drawn
    // from; scripts/seed-catalog.ts loads all of them into D1 for real.
    expect(CATALOG_SOURCE_TOTAL).toBeGreaterThan(9_000);
    const listed = await listReviewedTemplates(db);
    expect(listed.filter((course) => course.template_id.startsWith('mcgill-'))).toHaveLength(CATALOG_SAMPLE_SIZE);

    const comp202 = (await proposalFromReviewedTemplate(db, 'mcgill-comp-202'))!;
    expect(comp202.course).toMatchObject({ code: 'COMP 202', title: 'Foundations of Programming' });
    expect(comp202.branches.flatMap((branch) => branch.kcs).map((kc) => kc.name)).toContain('Variables');
    expect(comp202.branches.flatMap((branch) => branch.kcs).every((kc) => kc.source_refs[0]?.includes('McGill catalogue'))).toBe(true);
    expect((await proposalFromReviewedTemplate(db, 'mcgill-acct-626'))?.course.credits).toBe(1.5);
    expect(await proposalFromReviewedTemplate(db, 'mcgill-not-a-course')).toBeNull();
  });

  it('searches metadata and KC names without exposing authored answer data', async () => {
    const { results } = await searchReviewedTemplates(db, 'fluid properties');
    expect(results.map((course) => course.template_id)).toContain('chee-314-fluid-mechanics');
    expect((await searchReviewedTemplates(db, 'CHEE 314')).results[0]?.code).toBe('CHEE 314');
    expect((await searchReviewedTemplates(db, 'comp202')).results[0]?.template_id).toBe('mcgill-comp-202');
    expect((await searchReviewedTemplates(db, 'programming variables')).results.map((course) => course.template_id)).toContain('mcgill-comp-202');
    expect((await searchReviewedTemplates(db, 'computer science', { level: 'graduate', limit: 25 })).results.every((course) => course.levels?.includes('graduate') || course.level === 'graduate')).toBe(true);
  });
});
