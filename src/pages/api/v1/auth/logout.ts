import type { APIRoute } from 'astro';
import { apiError } from '../../../../lib/api';

// Clerk's frontend API clears its own session. See AvatarMenu and Settings.
export const POST: APIRoute = async () => {
  return apiError('auth_retired', 'Sign out through Clerk.', 410);
};
