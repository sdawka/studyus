import type { APIRoute } from 'astro';
import { apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { searchReviewedTemplates } from '../../../../../lib/content/templateCatalog';

export const GET: APIRoute = async ({ url }) =>
  withServiceErrors(async () =>
    apiOk(searchReviewedTemplates((url.searchParams.get('q') ?? '').slice(0, 100), {
      level: url.searchParams.get('level') === 'undergraduate' || url.searchParams.get('level') === 'graduate'
        ? url.searchParams.get('level') as 'undergraduate' | 'graduate'
        : undefined,
      // Keep the browser payload bounded; onboarding searches the full
      // catalog server-side as the learner types.
      limit: Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 100),
    }), {
      headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400' },
    }),
  );
