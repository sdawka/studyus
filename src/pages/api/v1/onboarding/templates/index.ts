import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { searchReviewedTemplates } from '../../../../../lib/content/templateCatalog';

export const GET: APIRoute = async ({ url }) =>
  withServiceErrors(async () => {
    const level = url.searchParams.get('level');
    const { results, total, truncated } = await searchReviewedTemplates(
      getDb(env.DB),
      (url.searchParams.get('q') ?? '').slice(0, 100),
      {
        level: level === 'undergraduate' || level === 'graduate' ? level : undefined,
        // Keep the browser payload bounded; onboarding searches the full
        // catalog server-side as the learner types.
        limit: Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 100),
      },
    );
    // `total` counts every match, not just the returned window, so the picker
    // can say how many courses matched instead of capping at the page size.
    // `private`, because this is an authenticated endpoint: the body is the
    // same for every learner, but a shared cache has no business storing a
    // response that middleware gated on a Clerk session.
    //
    // The short window is deliberate. This previously carried
    // `stale-while-revalidate=86400`, which let a browser serve a day-old
    // answer instantly — so seeding the catalogue into D1 did not reach anyone
    // who had searched in the preceding 24 hours. The catalogue is seeded, not
    // migrated, so "the data just appeared" is a normal event here and the
    // cache must not outlive it by much.
    return apiOk({ courses: results, total, truncated }, {
      headers: { 'Cache-Control': 'private, max-age=60' },
    });
  });
