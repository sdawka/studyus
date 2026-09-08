import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../../db/client';
import { apiError, apiOk } from '../../../../../../lib/api';
import { withServiceErrors } from '../../../../../../lib/apiErrors';
import { createGroupFile, listGroupFiles, publicGroupFile } from '../../../../../../lib/services/groupFiles';
import { toApi } from '../../../../../../lib/serialize';
import { parseBoundedMultipartFile } from '../../../../../../lib/uploads/multipart';

export const GET: APIRoute = async ({ params, locals }) => withServiceErrors(async () => {
  const files = await listGroupFiles(getDb(env.DB), locals.user!.id, params.id!);
  return apiOk(toApi({ files: files.map(publicGroupFile) }));
});

export const POST: APIRoute = async ({ params, request, locals }) => withServiceErrors(async () => {
  const file = await parseBoundedMultipartFile(request);
  if (!file) return apiError('invalid_input', 'A `file` field is required', 400);
  const created = await createGroupFile(getDb(env.DB), env.UPLOADS, locals.user!.id, params.id!, file);
  return apiOk(toApi(publicGroupFile(created)), { status: 201 });
});
