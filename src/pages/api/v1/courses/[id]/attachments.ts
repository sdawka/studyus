import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiError, apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { createAttachment, listAttachments } from '../../../../../lib/services/attachments';
import { parseBoundedMultipartFile } from '../../../../../lib/uploads/multipart';

export const GET: APIRoute = async ({ params, locals }) =>
  withServiceErrors(async () => {
    const rows = await listAttachments(getDb(env.DB), locals.user!.id, params.id!);
    return apiOk({
      attachments: rows.map((attachment) => ({
        attachment_id: attachment.id,
        filename: attachment.filename,
        size_bytes: attachment.sizeBytes,
        mime_type: attachment.contentType,
      })),
    });
  });

export const POST: APIRoute = async ({ params, request, locals }) =>
  withServiceErrors(async () => {
    const file = await parseBoundedMultipartFile(request);
    if (!file) {
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
