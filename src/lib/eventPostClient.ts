import { apiFetch, type ApiResult } from './apiClient';

export type EventPostAttempt = {
  serializedBody: string;
  idempotencyKey: string;
};

export type EventPostOutcome<T> = {
  result: ApiResult<T>;
  pendingAttempt: EventPostAttempt | null;
  attempt: EventPostAttempt;
};

/**
 * Posts one logical manual event with a stable key across ambiguous retries.
 * A changed serialized body is a new command and therefore receives a new
 * key; a successful response retires the local attempt. HTTP/network errors
 * keep it so retrying unchanged input cannot duplicate mastery evidence.
 */
export async function postManualEvent<T = unknown>(
  body: Record<string, unknown>,
  previousAttempt: EventPostAttempt | null,
  fallback: string,
): Promise<EventPostOutcome<T>> {
  const serializedBody = JSON.stringify(body);
  const attempt =
    previousAttempt?.serializedBody === serializedBody
      ? previousAttempt
      : { serializedBody, idempotencyKey: crypto.randomUUID().toLowerCase() };
  const result = await apiFetch<T>(
    '/api/v1/events',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.idempotencyKey },
      body: serializedBody,
    },
    fallback,
  );
  return { result, pendingAttempt: result.ok ? null : attempt, attempt };
}
