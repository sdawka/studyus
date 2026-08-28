import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiError, apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { changedSettingsKeys, retentionEventSurface, settingsChangedEvent } from '../../../../lib/analytics/retention';
import { analyticsRequestCorrelation, queueBehavioralEvent } from '../../../../lib/analytics/server';
import { updateUserSchema } from '../../../../lib/schemas/user';
import { resolveSettings, updateUser } from '../../../../lib/services/user';
import { getOnboardingState } from '../../../../lib/services/onboarding';

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user!;
  return apiOk({
    id: user.id,
    email: user.email,
    name: user.name,
    current_term: user.currentTerm,
    timezone: user.timezone,
    onboarded_at: user.onboardedAt ? new Date(user.onboardedAt).toISOString() : null,
    settings: resolveSettings(user.settings),
  });
};

export const PATCH: APIRoute = async ({ request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const input = updateUserSchema.parse(body);
    const db = getDb(env.DB);
    if (input.onboarded) {
      const state = await getOnboardingState(db, locals.user!.id);
      if (!state.has_usable_course) {
        return apiError('onboarding_incomplete', 'Add a course with at least one knowledge component first', 409);
      }
    }
    const settingsBefore = resolveSettings(locals.user!.settings);
    const updated = await updateUser(db, locals.user!.id, input);
    const settingsAfter = resolveSettings(updated.settings);
    const changedKeys = changedSettingsKeys(input.settings, settingsBefore, settingsAfter)
      // This key is emitted only by the successful opt-in control. Opt-out
      // must clear analytics before any event can be captured.
      .filter((key) => key !== 'analytics_opt_out');
    try {
      const correlation = analyticsRequestCorrelation(request);
      if (correlation.session_id) {
        const event = settingsChangedEvent({
          user_id: locals.user!.id,
          session_id: correlation.session_id,
          surface: retentionEventSurface(request, 'settings'),
          ts: Date.now(),
        }, changedKeys, settingsAfter.analytics_opt_out);
        if (event) {
          queueBehavioralEvent({
            env,
            request,
            execution: locals.cfContext,
            user_id: locals.user!.id,
            analytics_opt_out: settingsAfter.analytics_opt_out,
          }, event);
        }
      }
    } catch {
      console.warn(JSON.stringify({ message: 'settings analytics queue failed' }));
    }
    return apiOk({
      id: updated.id,
      email: updated.email,
      name: updated.name,
      current_term: updated.currentTerm,
      timezone: updated.timezone,
      onboarded_at: updated.onboardedAt ? new Date(updated.onboardedAt).toISOString() : null,
      settings: settingsAfter,
    });
  });
