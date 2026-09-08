import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../../db/client';
import { apiOk } from '../../../../../../lib/api';
import { withServiceErrors } from '../../../../../../lib/apiErrors';
import { copyGroupFileSchema } from '../../../../../../lib/schemas/groups';
import { copyAttachmentToGroup, publicGroupFile } from '../../../../../../lib/services/groupFiles';
import { toApi } from '../../../../../../lib/serialize';

export const POST: APIRoute = async ({ params, request, locals }) => withServiceErrors(async () => {
  const { attachment_id } = copyGroupFileSchema.parse(await request.json().catch(() => ({})));
  const file = await copyAttachmentToGroup(getDb(env.DB), env.UPLOADS, locals.user!.id, params.id!, attachment_id);
  return apiOk(toApi(publicGroupFile(file)), { status: 201 });
});
