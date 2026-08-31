import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiError, apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { getReviewedTemplateRevision, proposalFromReviewedTemplate } from '../../../../../lib/content/templateCatalog';

export const GET: APIRoute = async ({ params }) =>
  withServiceErrors(async () => {
    const db = getDb(env.DB);
    const proposal = await proposalFromReviewedTemplate(db, params.id ?? '');
    return proposal
      ? apiOk({ ...proposal, template_revision: await getReviewedTemplateRevision(db, params.id ?? '') })
      : apiError('not_found', 'Course template not found', 404);
  });
