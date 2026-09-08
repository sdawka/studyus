import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { createGroupInvitationSchema } from '../../../../../lib/schemas/groups';
import { createGroupInvitation } from '../../../../../lib/services/groups';
import { toApi } from '../../../../../lib/serialize';

export const POST: APIRoute = async ({ params, request, locals }) => withServiceErrors(async () => {
  const { email } = createGroupInvitationSchema.parse(await request.json().catch(() => ({})));
  const secret = env.GROUP_INVITE_HMAC_SECRET;
  if (!secret) throw new TypeError('Group invitation secret is unavailable');
  const created = await createGroupInvitation(getDb(env.DB), locals.user!.id, params.id!, email, secret);
  return apiOk(toApi({
    invitationId: created.invitation.id,
    expiresAt: created.invitation.expiresAt,
    invitePath: `/groups/invitations/accept?token=${encodeURIComponent(created.token)}`,
  }), { status: 201 });
});
