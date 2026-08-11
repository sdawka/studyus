import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { deleteAttachment, getAttachmentObject } from '../../../../lib/services/attachments';

export const GET: APIRoute = async ({ params, locals }) =>
  withServiceErrors(async () => {
    const db = getDb(env.DB);
    const { attachment, object } = await getAttachmentObject(db, env.UPLOADS, locals.user!.id, params.id!);
    return new Response(object.body, {
      status: 200,
      headers: {
        'Content-Type': attachment.contentType ?? 'application/octet-stream',
        'Content-Disposition': `inline; filename="${attachment.filename}"`,
      },
    });
  });

export const DELETE: APIRoute = async ({ params, locals }) =>
  withServiceErrors(async () => {
    const db = getDb(env.DB);
    await deleteAttachment(db, env.UPLOADS, locals.user!.id, params.id!);
    return apiOk({});
  });
