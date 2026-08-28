import { describe, expect, it } from 'vitest';
import type { CaptureResult } from 'posthog-js';
import { manualProposal } from '../src/lib/demo/catalog';
import { sanitizeAnalyticsCapture } from '../src/lib/analytics/client';
import { analyticsIdentityBootstrap, analyticsPersonProperties, resolveSignupMethod } from '../src/lib/analytics/identity';
import {
  buildOnboardingBehavioralEvents,
  createOnboardingStartedToken,
  readOnboardingStartedAt,
  summarizeOnboardingReview,
} from '../src/lib/analytics/onboarding';

const trialId = '11111111-1111-4111-8111-111111111111';

describe('signup identity and privacy', () => {
  it('uses the coarse signup method without provider or identity values', () => {
    expect(resolveSignupMethod({ external_account_count: 1, has_phone: true, has_email: true })).toBe('oauth');
    expect(resolveSignupMethod({ external_account_count: 0, has_phone: true, has_email: true })).toBe('phone');
    expect(resolveSignupMethod({ external_account_count: 0, has_phone: false, has_email: true })).toBe('email');
    expect(resolveSignupMethod({ external_account_count: 0, has_phone: false, has_email: false })).toBe('unknown');
  });

  it('defines the pre-auth anonymous identity and permits only a validated trial join property', () => {
    expect(analyticsIdentityBootstrap('device-1')).toEqual({ distinctID: 'device-1', isIdentifiedID: false });
    expect(analyticsPersonProperties(trialId)).toEqual({ trial_session_id: trialId });
    expect(analyticsPersonProperties('not-a-uuid')).toBeUndefined();

    const sanitized = sanitizeAnalyticsCapture({
      uuid: trialId,
      event: '$identify',
      properties: { token: 'phc_test', distinct_id: 'local-user', $anon_distinct_id: 'device-1', email: 'private@example.test' },
      $set: { trial_session_id: trialId, email: 'private@example.test', provider: 'google' },
      $set_once: { name: 'Private' },
    } satisfies CaptureResult);
    expect(sanitized?.properties).toEqual({ token: 'phc_test', distinct_id: 'local-user', $anon_distinct_id: 'device-1', $geoip_disable: true });
    expect(sanitized?.$set).toEqual({ trial_session_id: trialId });
    expect(sanitized?.$set_once).toBeUndefined();
  });
});

describe('authenticated onboarding analytics', () => {
  it('counts review edits without retaining edited text', () => {
    const initial = manualProposal('TEST 101', 'Test course', ['First topic', 'Second topic']);
    const submitted = structuredClone(initial);
    submitted.branches[0].name = 'Renamed branch';
    submitted.branches[0].kcs[0].sort_order = 1;
    submitted.branches[0].kcs[1].included = false;
    expect(summarizeOnboardingReview(initial, submitted)).toEqual({ renamed: 1, reordered: 1, excluded: 1 });
  });

  it('derives bounded duration from the opaque first-render token', () => {
    const startedAt = 1_800_000_000_000;
    const token = createOnboardingStartedToken(startedAt, () => trialId);
    expect(token).not.toContain(String(startedAt));
    expect(readOnboardingStartedAt(token, startedAt + 5_000)).toBe(startedAt);
    expect(readOnboardingStartedAt('tampered', startedAt + 5_000)).toBeUndefined();
  });

  it('builds the three server events in canonical order with no arbitrary properties', () => {
    const events = buildOnboardingBehavioralEvents({
      user_id: 'local-user',
      session_id: 'app-session',
      trial_session_id: trialId,
      draft_id: trialId,
      started_at: 1_800_000_000_000,
      review_metrics: { renamed: 2, reordered: 1, excluded: 3 },
      summary: {
        completed_at: 1_800_000_012_000,
        path: 'document',
        course_count: 1,
        kc_count: 7,
      },
    });
    expect(events.map((event) => event.name)).toEqual([
      'onboarding_path_chosen',
      'onboarding_map_reviewed',
      'onboarding_completed_auth',
    ]);
    expect(events[0]).toMatchObject({ path: 'document', import_from_trial: true });
    expect(events[1]).toMatchObject({ renamed: 2, reordered: 1, excluded: 3 });
    expect(events[2]).toMatchObject({ course_count: 1, kc_count: 7, duration_ms: 12_000 });
    expect(JSON.stringify(events)).not.toContain('filename');
  });
});
