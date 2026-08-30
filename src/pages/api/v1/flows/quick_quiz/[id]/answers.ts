import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../../db/client';
import { apiError, apiOk } from '../../../../../../lib/api';
import { withServiceErrors } from '../../../../../../lib/apiErrors';
import { toApi } from '../../../../../../lib/serialize';
import { submitQuickQuizAnswersSchema } from '../../../../../../lib/schemas/quickQuiz';
import { QuizNotGradableError, submitQuickQuizAnswers } from '../../../../../../lib/flows/quick_quiz';

export const POST: APIRoute = ({ params, request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const input = submitQuickQuizAnswersSchema.parse(body);
    const db = getDb(env.DB);
    try {
      const result = await submitQuickQuizAnswers(db, locals.user!.id, params.id!, input);
      return apiOk(toApi(result));
    } catch (err) {
      if (err instanceof QuizNotGradableError) {
        return apiError('quiz_not_gradable', err.message, 400);
      }
      throw err;
    }
  });
