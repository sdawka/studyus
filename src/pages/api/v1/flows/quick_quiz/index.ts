import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiError, apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { toApi } from '../../../../../lib/serialize';
import { createQuickQuizSchema } from '../../../../../lib/schemas/quickQuiz';
import { generateQuickQuiz, QuizGenerationError } from '../../../../../lib/flows/quick_quiz';

export const POST: APIRoute = ({ request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const input = createQuickQuizSchema.parse(body);
    const db = getDb(env.DB);
    try {
      const quiz = await generateQuickQuiz(db, locals.user!.id, input, {
        AI_FEATURES_ENABLED: env.AI_FEATURES_ENABLED,
        OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
        OPENROUTER_MODEL: env.OPENROUTER_MODEL,
      });
      return apiOk(toApi(quiz), { status: 201 });
    } catch (err) {
      if (err instanceof QuizGenerationError) {
        return apiError('quiz_generation_failed', err.message, 502);
      }
      throw err;
    }
  });
