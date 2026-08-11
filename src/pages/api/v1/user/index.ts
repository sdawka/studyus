import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { updateUserSchema } from '../../../../lib/schemas/user';
import { updateUser } from '../../../../lib/services/user';

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user!;
  return apiOk({
    id: user.id,
    email: user.email,
    name: user.name,
    current_term: user.currentTerm,
    onboarded_at: user.onboardedAt ? new Date(user.onboardedAt).toISOString() : null,
  });
};

export const PATCH: APIRoute = async ({ request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const input = updateUserSchema.parse(body);
    const db = getDb(env.DB);
    const updated = await updateUser(db, locals.user!.id, input);
    return apiOk({
      id: updated.id,
      email: updated.email,
      name: updated.name,
      current_term: updated.currentTerm,
      onboarded_at: updated.onboardedAt ? new Date(updated.onboardedAt).toISOString() : null,
    });
  });
