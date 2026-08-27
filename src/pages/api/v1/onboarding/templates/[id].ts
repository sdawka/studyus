import type { APIRoute } from 'astro';
import { apiError, apiOk } from '../../../../../lib/api';
import { getReviewedTemplateRevision, proposalFromReviewedTemplate } from '../../../../../lib/content/templateCatalog';

export const GET: APIRoute = async ({ params }) => {
  const proposal = proposalFromReviewedTemplate(params.id ?? '');
  return proposal
    ? apiOk({ ...proposal, template_revision: await getReviewedTemplateRevision(params.id ?? '') })
    : apiError('not_found', 'Course template not found', 404);
};
