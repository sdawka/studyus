// Maps thrown service-layer errors to the frozen API envelope. Every route
// handler wraps its service call with `withServiceErrors` so error shape
// stays consistent without repeating try/catch boilerplate per route.
import { ZodError } from 'zod';
import { apiError } from './api';
import { NotFoundError, ForbiddenError, ConflictError } from './services/util';
import { IdempotencyConflictError, NotManualEventError } from './services/events';
import { AiFeatureUnavailableError } from './ai/capabilities';

export function serviceErrorResponse(err: unknown): Response {
  if (err instanceof ZodError) {
    return apiError('invalid_input', err.issues.map((i) => i.message).join('; '), 400);
  }
  if (err instanceof NotFoundError) {
    return apiError('not_found', err.message, 404);
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
  console.error(err);
  return apiError('internal_error', 'Something went wrong', 500);
}

export async function withServiceErrors(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
