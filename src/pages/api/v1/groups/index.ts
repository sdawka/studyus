import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { createGroupSchema } from '../../../../lib/schemas/groups';
import { createGroup, listGroups, publicGroupSummary } from '../../../../lib/services/groups';
import { toApi } from '../../../../lib/serialize';

export const GET: APIRoute = async ({ locals }) => withServiceErrors(async () => {
  const rows = await listGroups(getDb(env.DB), locals.user!.id);
  return apiOk(toApi({ groups: rows.map((row) => ({ group: publicGroupSummary(row.group), role: row.role })) }));
});

export const POST: APIRoute = async ({ request, locals }) => withServiceErrors(async () => {
  const input = createGroupSchema.parse(await request.json().catch(() => ({})));
  const group = await createGroup(getDb(env.DB), locals.user!.id, input);
  return apiOk(toApi(publicGroupSummary(group)), { status: 201 });
});
