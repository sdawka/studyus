import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { createCourseSearchIndex, searchCourseCatalog } from '../src/lib/courseSearch';
import { searchReviewedTemplates } from '../src/lib/content/templateCatalog';
import { seedCatalogSample } from './setup/seed-catalog';
import { GET as templatesRoute } from '../src/pages/api/v1/onboarding/templates/index';

const db = getDb(env.DB);

// The generated catalogue lives in D1; see tests/setup/seed-catalog.ts for why
// this seeds a slice rather than all 9,994 rows.
beforeAll(() => seedCatalogSample(env.DB), 60_000);

// Concept search is the reason the catalog carries KC outlines at all: a learner
// who cannot remember "COMP 202" can still find it by typing "programming
// variables". The server indexes KC names into catalog_courses_fts to make that
// work.
describe('catalog search finds courses by concept', () => {
  it('matches KC names, not just code and title', async () => {
    for (const query of ['programming variables', 'photosynthesis', 'supply and demand']) {
      expect((await searchReviewedTemplates(db, query, { limit: 100 })).results.length).toBeGreaterThan(0);
    }
  });

  it('ranks an exact code match first even when other terms are broad', async () => {
    expect((await searchReviewedTemplates(db, 'comp 202', { limit: 100 })).results[0]?.code).toBe('COMP 202');
  });
});

describe('search reports an honest total', () => {
  it('counts every match, not just the returned window', async () => {
    const narrow = await searchReviewedTemplates(db, 'comp', { limit: 5 });
    expect(narrow.results).toHaveLength(5);
    expect(narrow.total).toBeGreaterThan(5);
    expect(narrow.truncated).toBe(true);

    // The total must equal what an unbounded search would return, so the UI can
    // say "1724 matching courses" rather than capping at the page size.
    expect(narrow.total).toBe((await searchReviewedTemplates(db, 'comp')).results.length);
  });

  it('is not truncated when everything fits', async () => {
    const all = await searchReviewedTemplates(db, 'comp 202', { limit: 100 });
    expect(all.truncated).toBe(all.total > all.results.length);
  });
});

// OnboardingSetup previously ran the server's ranked results back through the
// client index before rendering them. These two searches index different
// fields, so that seam silently discarded every concept match. The client index
// exists only to filter the small bundled fallback catalog offline; it must
// never be applied to server results.
describe('the client index cannot stand in for server search', () => {
  it('drops concept matches, which is why server results pass through untouched', async () => {
    const query = 'programming variables';
    const fromServer = (await searchReviewedTemplates(db, query, { limit: 100 })).results;
    expect(fromServer.length).toBeGreaterThan(0);

    const reFiltered = searchCourseCatalog(
      createCourseSearchIndex(fromServer.map((course) => ({ ...course, slug: course.template_id, credits: course.credits ?? undefined }))),
      query,
    );
    expect(reFiltered.results).toHaveLength(0);
  });
});

// Ordering ~10,000 codes through localeCompare(numeric) cost ~38ms of worker
// CPU per request; a precomputed zero-padded key does it in ~1ms. The key is
// now a stored column SQLite orders by, so pin the numeric ordering it must
// preserve.
describe('course codes sort numerically, not lexically', () => {
  it('puts COMP 202 before COMP 1006', async () => {
    const numbers = (await searchReviewedTemplates(db, 'comp', { limit: 100 })).results
      .filter((course) => course.code.startsWith('COMP '))
      .map((course) => Number(course.code.slice(5)));

    expect(numbers.length).toBeGreaterThan(10);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });
});

// The catalogue is seeded, not migrated, so "the rows just appeared" is a
// normal event for this endpoint. It once sent
// `public, max-age=300, stale-while-revalidate=86400`, which let a browser
// serve a day-old answer instantly — seeding D1 in production then reached
// nobody who had searched in the preceding 24 hours, with no error to show for
// it. It is also an authenticated route, so `public` invited shared caches to
// store a response the middleware had gated on a Clerk session.
describe('template search caching does not outlive a reseed', () => {
  it('is private and short-lived, with no stale-while-revalidate window', async () => {
    const res = await templatesRoute({
      url: new URL('http://local.test/api/v1/onboarding/templates?q=comp'),
      locals: { user: { id: 'user_cache_probe' } },
    } as any);

    const cacheControl = res.headers.get('Cache-Control') ?? '';
    expect(res.status).toBe(200);
    expect(cacheControl).toContain('private');
    expect(cacheControl).not.toContain('public');
    expect(cacheControl).not.toContain('stale-while-revalidate');

    const maxAge = Number(/max-age=(\d+)/.exec(cacheControl)?.[1] ?? NaN);
    expect(maxAge).toBeLessThanOrEqual(300);
  });
});
