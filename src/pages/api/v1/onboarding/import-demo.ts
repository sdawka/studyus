import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { queueBehavioralEvents, analyticsRequestCorrelation } from '../../../../lib/analytics/server';
import { buildOnboardingBehavioralEvents, ONBOARDING_STARTED_COOKIE, readOnboardingStartedAt } from '../../../../lib/analytics/onboarding';
import { ANALYTICS_TRIAL_HANDOFF_COOKIE, readTrialHandoff } from '../../../../lib/analytics/session';
import { onboardingCommitSchema } from '../../../../lib/schemas/onboarding';
import { importDemoSetup } from '../../../../lib/services/onboarding';
import { resolveSettings } from '../../../../lib/services/user';

export const POST: APIRoute = async ({ request, locals, cookies }) =>
  withServiceErrors(async () => {
    const input = onboardingCommitSchema.parse(await request.json().catch(() => ({})));
    const result = await importDemoSetup(getDb(env.DB), locals.user!.id, input);
    const { behavioral, ...response } = result;
    if (behavioral && result.complete) {
      const correlation = analyticsRequestCorrelation(request);
      const trialSessionId = readTrialHandoff(request.headers.get('cookie'));
      if (correlation.session_id) {
        queueBehavioralEvents({
          env,
          request,
          execution: locals.cfContext,
          user_id: locals.user!.id,
          analytics_opt_out: resolveSettings(locals.user!.settings).analytics_opt_out,
        }, buildOnboardingBehavioralEvents({
          user_id: locals.user!.id,
          session_id: correlation.session_id,
          trial_session_id: trialSessionId,
          draft_id: input.draft_id,
          started_at: readOnboardingStartedAt(cookies.get(ONBOARDING_STARTED_COOKIE)?.value, behavioral.completed_at),
          review_metrics: input.review_metrics,
          summary: behavioral,
        }));
      }
      cookies.delete(ONBOARDING_STARTED_COOKIE, { path: '/' });
      cookies.delete(ANALYTICS_TRIAL_HANDOFF_COOKIE, { path: '/' });
    }
    return apiOk(response);
  });
