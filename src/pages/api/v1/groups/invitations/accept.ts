import type { APIRoute } from 'astro';
import { clerkClient } from '@clerk/astro/server';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { acceptGroupInvitationSchema } from '../../../../../lib/schemas/groups';
import { acceptGroupInvitation } from '../../../../../lib/services/groups';
import { ForbiddenError } from '../../../../../lib/services/util';
import { toApi } from '../../../../../lib/serialize';

export const POST: APIRoute = async (context) => withServiceErrors(async () => {
  const { token } = acceptGroupInvitationSchema.parse(await context.request.json().catch(() => ({})));
  const secret = env.GROUP_INVITE_HMAC_SECRET;
  if (!secret) throw new TypeError('Group invitation secret is unavailable');
  const clerkUserId = context.locals.user!.clerkUserId;
  if (!clerkUserId) throw new ForbiddenError('A verified primary email is required');
  const clerkUser = await clerkClient(context).users.getUser(clerkUserId);
  const primary = clerkUser.primaryEmailAddress;
  if (!primary || primary.verification?.status !== 'verified') throw new ForbiddenError('A verified primary email is required');
  const membership = await acceptGroupInvitation(getDb(env.DB), context.locals.user!.id, primary.emailAddress, token, secret);
  return apiOk(toApi(membership));
});
