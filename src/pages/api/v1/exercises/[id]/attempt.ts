import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiError, apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { toApi } from '../../../../../lib/serialize';
import { exerciseAttemptSchema } from '../../../../../lib/schemas/exercises';
import { ExerciseAttemptMismatchError, gradeExerciseAttempt } from '../../../../../lib/flows/exercise_attempt';

export const POST: APIRoute = ({ params, request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const input = exerciseAttemptSchema.parse(body);
    const db = getDb(env.DB);
    try {
      const result = await gradeExerciseAttempt(db, locals.user!.id, params.id!, input);
      return apiOk(toApi(result));
    } catch (err) {
      if (err instanceof ExerciseAttemptMismatchError) {
        return apiError('invalid_input', err.message, 400);
      }
      throw err;
    }
  });
