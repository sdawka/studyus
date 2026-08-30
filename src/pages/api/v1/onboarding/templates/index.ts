import type { APIRoute } from 'astro';
import { apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { getReviewedTemplateRevision, listReviewedTemplates } from '../../../../../lib/content/templateCatalog';

export const GET: APIRoute = async () =>
  withServiceErrors(async () =>
    apiOk(
      await Promise.all(
        listReviewedTemplates().map(async (template) => ({
          ...template,
          template_revision: await getReviewedTemplateRevision(template.template_id),
        })),
      ),
    ),
  );
