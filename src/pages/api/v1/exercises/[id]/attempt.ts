import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { ZodError } from 'zod';
import { getDb } from '../../../../../db/client';
import { apiError, apiOk } from '../../../../../lib/api';
import { serviceErrorResponse } from '../../../../../lib/apiErrors';
import { toApi } from '../../../../../lib/serialize';
import { exerciseAttemptSchema } from '../../../../../lib/schemas/exercises';
import { ExerciseAttemptMismatchError, gradeExerciseAttempt } from '../../../../../lib/flows/exercise_attempt';

export const POST: APIRoute = async ({ params, request, locals }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const input = exerciseAttemptSchema.parse(body);
    const db = getDb(env.DB);
    const result = await gradeExerciseAttempt(db, locals.user!.id, params.id!, input);
    return apiOk(toApi(result));
  } catch (err) {
    if (err instanceof ExerciseAttemptMismatchError) {
      return apiError('invalid_input', err.message, 400);
    }
    if (err instanceof ZodError) {
      return apiError('invalid_input', err.issues.map((i) => i.message).join('; '), 400);
    }
    return serviceErrorResponse(err);
  }
};
