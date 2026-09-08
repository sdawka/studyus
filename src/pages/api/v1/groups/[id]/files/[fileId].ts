import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../../db/client';
import { apiOk } from '../../../../../../lib/api';
import { withServiceErrors } from '../../../../../../lib/apiErrors';
import { downloadHeaders } from '../../../../../../lib/downloadHeaders';
import { deleteGroupFile, getGroupFileObject } from '../../../../../../lib/services/groupFiles';

export const GET: APIRoute = async ({ params, locals }) => withServiceErrors(async () => {
  const { file, object } = await getGroupFileObject(getDb(env.DB), env.UPLOADS, locals.user!.id, params.id!, params.fileId!);
  return new Response(object.body, { status: 200, headers: downloadHeaders(file.filename) });
});

export const DELETE: APIRoute = async ({ params, locals }) => withServiceErrors(async () => {
  await deleteGroupFile(getDb(env.DB), env.UPLOADS, locals.user!.id, params.id!, params.fileId!);
  return apiOk({});
});
