export class CalendarProviderHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Calendar provider request failed with status ${status}`);
    this.name = 'CalendarProviderHttpError';
    this.status = status;
    this.body = body;
  }
}

export function bearerHeaders(accessToken: string, headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  result.set('authorization', `Bearer ${accessToken}`);
  result.set('accept', 'application/json');
  return result;
}

export async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new CalendarProviderHttpError(response.status, await response.text());
  return (await response.json()) as T;
}

export async function expectSuccess(response: Response): Promise<void> {
  if (!response.ok) throw new CalendarProviderHttpError(response.status, await response.text());
}
