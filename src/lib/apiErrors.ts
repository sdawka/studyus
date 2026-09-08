// Maps thrown service-layer errors to the frozen API envelope. Every route
// handler wraps its service call with `withServiceErrors` so error shape
// stays consistent without repeating try/catch boilerplate per route.
import { ZodError } from 'zod';
import { apiError } from './api';
import { NotFoundError, ForbiddenError, ConflictError, ExerciseAttemptMismatchError } from './services/util';
import { IdempotencyConflictError, NotManualEventError } from './services/events';
import { AiFeatureUnavailableError } from './ai/capabilities';
import { AccountInactiveError } from './services/accountLifecycle';
import { AiBudgetExceededError } from './ai/errors';

function isInactiveAccountFailure(error: unknown): boolean {
  let value = error;
  for (let depth = 0; depth < 5 && value instanceof Error; depth += 1) {
    if (value instanceof AccountInactiveError || /(?:^|: )inactive account(?:: SQLITE_CONSTRAINT(?: \(extended: SQLITE_CONSTRAINT_TRIGGER\))?)?$/.test(value.message)) return true;
    value = value.cause;
  }
  return false;
}

export function serviceErrorResponse(err: unknown): Response {
  if (err instanceof AiBudgetExceededError) return apiError(err.code, err.message, err.status);
  if (isInactiveAccountFailure(err)) return apiError('not_found', 'Account not found', 404);
  if (err instanceof ZodError) {
    return apiError('invalid_input', err.issues.map((i) => i.message).join('; '), 400);
  }
  if (err instanceof NotFoundError) {
    return apiError('not_found', err.message, 404);
  }
  if (err instanceof ExerciseAttemptMismatchError) {
    return apiError('invalid_input', err.message, 400);
  }
  if (err instanceof NotManualEventError) {
    return apiError('not_manual_event', err.message, 400);
  }
  if (err instanceof IdempotencyConflictError) {
    return apiError('idempotency_conflict', err.message, 409);
  }
  if (err instanceof ConflictError) {
    return apiError('invalid_input', err.message, 409);
  }
  if (err instanceof ForbiddenError) {
    return apiError('forbidden', err.message, 403);
  }
  if (err instanceof AiFeatureUnavailableError) {
    return apiError('ai_unavailable', err.message, 503);
  }
  // Database/provider errors can contain bound private input or bearer URLs.
  // Keep the operational signal without serializing those error objects.
  console.error('service_request_failed', { code: 'internal_error' });
  return apiError('internal_error', 'Something went wrong', 500);
}

export async function withServiceErrors(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
