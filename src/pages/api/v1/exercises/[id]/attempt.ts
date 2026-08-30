import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { toApi } from '../../../../../lib/serialize';
import { exerciseAttemptSchema } from '../../../../../lib/schemas/exercises';
import { gradeExerciseAttempt } from '../../../../../lib/flows/exercise_attempt';

export const POST: APIRoute = ({ params, request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const input = exerciseAttemptSchema.parse(body);
    const db = getDb(env.DB);
    return apiOk(toApi(await gradeExerciseAttempt(db, locals.user!.id, params.id!, input)));
  });
