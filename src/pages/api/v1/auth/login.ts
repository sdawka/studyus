import type { APIRoute } from 'astro';
import { apiError } from '../../../../lib/api';

// Kept as an explicit retirement response so stale clients get a clear error
// instead of silently receiving a D1-backed session after the Clerk cutover.
export const POST: APIRoute = async () => {
  return apiError('auth_retired', 'Password sign-in moved to /sign-in.', 410);
};
