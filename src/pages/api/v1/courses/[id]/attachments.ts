import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiError, apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { createAttachment } from '../../../../../lib/services/attachments';

export const POST: APIRoute = async ({ params, request, locals }) =>
  withServiceErrors(async () => {
    const formData = await request.formData().catch(() => null);
    const file = formData?.get('file');
    if (!file || !(file instanceof File)) {
      return apiError('invalid_input', 'A `file` field is required', 400);
    }

    const db = getDb(env.DB);
    const attachment = await createAttachment(db, env.UPLOADS, locals.user!.id, params.id!, file);
    return apiOk(
      {
        attachment_id: attachment.id,
        r2_key: attachment.r2Key,
        filename: attachment.filename,
        mime_type: attachment.contentType,
      },
      { status: 201 },
    );
  });
