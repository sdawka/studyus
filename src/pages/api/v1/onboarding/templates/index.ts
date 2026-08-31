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
    return apiOk({ courses: results, total, truncated }, {
      headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400' },
    });
  });
