// Response envelope shared by every /api/v1 route: { data } on success,
// { error: { code, message } } on failure. Frozen shape for native clients.

export function apiOk<T>(data: T, init?: ResponseInit): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
}

export function apiError(code: string, message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
