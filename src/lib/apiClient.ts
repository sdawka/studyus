// Shared API client. Every /api/v1 call site across ~17 components (plus
// src/lib/stores/tasks.ts's own private parseJson/errorMessage helpers) hand
// rolled the same four-step dance: fetch -> parse the {data}/{error} envelope
// (src/lib/api.ts) -> check res.ok -> fall back to a call-site-specific
// message when the body has none, all wrapped in a try/catch for the case
// where the request never reaches a route handler at all (offline, backend
// redeploying, a body that isn't JSON). `apiFetch` centralizes those four
// steps into one call; each call site still supplies its own "the request
// reached the server but it said no" wording via `fallback`; so the caller's
// existing user-visible message text is unchanged.
export interface ApiEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string };
}

// `reason` distinguishes "the request never reached a route handler" from
// "it did, and the server said no" — most call sites don't care and just
// read `error`, but a few pre-existing call sites show a different message
// for each (e.g. always show a fixed string for a non-ok response, but the
// generic network message when the fetch itself failed), so the two are
// kept distinguishable rather than collapsed into one string.
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; reason: 'network' | 'http' };

// The wording almost every call site converged on for "the request never
// made it" (fetch() itself rejecting, or a response body that isn't JSON).
// Preserved verbatim — several call sites depend on this exact string.
export const NETWORK_ERROR_MESSAGE = 'Network error, please try again.';

// `fallback` covers a non-ok response whose body has no (or no parseable)
// error message. `networkFallback` covers fetch()/json() throwing outright —
// most call sites use NETWORK_ERROR_MESSAGE for this, but a few pre-existing
// sites show different wording (e.g. 'Network error.' with no "please try
// again"), so it's a separate, overridable parameter rather than reusing
// `fallback` for both.
export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
  fallback = 'Something went wrong',
  networkFallback: string = NETWORK_ERROR_MESSAGE,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    return { ok: false, error: networkFallback, reason: 'network' };
  }
  // `Response#json()` rejects on a non-JSON body — a request that never made
  // it to a route handler can still land here with an ok-shaped Response in
  // some environments, so this is guarded the same as the network catch above.
  const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok) return { ok: false, error: json?.error?.message ?? fallback, reason: 'http' };
  return { ok: true, data: (json?.data as T) ?? (json as unknown as T) };
}
