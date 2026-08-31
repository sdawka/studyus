import { describe, expect, it } from 'vitest';
import { createCourseSearchIndex, searchCourseCatalog } from '../src/lib/courseSearch';
import { searchReviewedTemplates } from '../src/lib/content/templateCatalog';

// Concept search is the reason the catalog carries KC outlines at all: a learner
// who cannot remember "COMP 202" can still find it by typing "programming
// variables". The server indexes KC names to make that work.
describe('catalog search finds courses by concept', () => {
  it('matches KC names, not just code and title', () => {
    for (const query of ['programming variables', 'photosynthesis', 'supply and demand']) {
      expect(searchReviewedTemplates(query, { limit: 100 }).results.length).toBeGreaterThan(0);
    }
  });

  it('ranks an exact code match first even when other terms are broad', () => {
    expect(searchReviewedTemplates('comp 202', { limit: 100 }).results[0]?.code).toBe('COMP 202');
  });
});

describe('search reports an honest total', () => {
  it('counts every match, not just the returned window', () => {
    const narrow = searchReviewedTemplates('comp', { limit: 5 });
    expect(narrow.results).toHaveLength(5);
    expect(narrow.total).toBeGreaterThan(5);
    expect(narrow.truncated).toBe(true);

    // The total must equal what an unbounded search would return, so the UI can
    // say "1724 matching courses" rather than capping at the page size.
    expect(narrow.total).toBe(searchReviewedTemplates('comp').results.length);
  });

  it('is not truncated when everything fits', () => {
    const all = searchReviewedTemplates('comp 202', { limit: 100 });
    expect(all.truncated).toBe(all.total > all.results.length);
  });
});

// OnboardingSetup previously ran the server's ranked results back through the
// client index before rendering them. These two searches index different
// fields, so that seam silently discarded every concept match. The client index
// exists only to filter the small bundled fallback catalog offline; it must
// never be applied to server results.
describe('the client index cannot stand in for server search', () => {
  it('drops concept matches, which is why server results pass through untouched', () => {
    const query = 'programming variables';
    const fromServer = searchReviewedTemplates(query, { limit: 100 }).results;
    expect(fromServer.length).toBeGreaterThan(0);

    const reFiltered = searchCourseCatalog(
      createCourseSearchIndex(fromServer.map((course) => ({ ...course, slug: course.template_id, credits: course.credits ?? undefined }))),
      query,
    );
    expect(reFiltered.results).toHaveLength(0);
  });
});

// Ordering ~10,000 codes through localeCompare(numeric) cost ~38ms of worker
// CPU per request; a precomputed zero-padded key does it in ~1ms. That is only
// a win if it sorts identically, so pin the numeric ordering it must preserve.
describe('course codes sort numerically, not lexically', () => {
  it('puts COMP 202 before COMP 1006', () => {
    const numbers = searchReviewedTemplates('comp', { limit: 100 }).results
      .filter((course) => course.code.startsWith('COMP '))
      .map((course) => Number(course.code.slice(5)));

    expect(numbers.length).toBeGreaterThan(10);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });
});
