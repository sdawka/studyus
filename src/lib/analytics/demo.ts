import type { DemoFunnelBatchInput, DemoScenarioId } from '../schemas/onboarding';
import { loadDemoDraft, saveDemoDraft } from '../demo/store';
import {
  persistAnalyticsCookies,
  persistTrialHandoffCookie,
  resolveAnalyticsSession,
} from './session';

export type DemoFunnelEventInput = {
  name:
    | 'landing_try_clicked'
    | 'setup_step_completed'
    | 'setup_step_skipped'
    | 'demo_entered'
    | 'scenario_started'
    | 'scenario_completed'
    | 'signup_clicked'
    | 'import_offered'
    | 'import_accepted'
    | 'import_declined'
    | 'onboarding_completed';
  trial_session_id: string;
  step?: 'context' | 'preferences' | 'course';
  scenario_id?: DemoScenarioId;
};

type BrowserDemoAnalytics = {
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  surface: '/try' | '/onboarding';
  now?: number;
  create_id?: () => string;
  secure: boolean;
  write_cookie: (value: string) => void;
  dnt: boolean;
};

export function ensureDemoTrialSession(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  now = Date.now(),
): string | undefined {
  try {
    const draft = loadDemoDraft(storage, now);
    return saveDemoDraft(draft, storage, now) ? draft.draft_id : undefined;
  } catch {
    return undefined;
  }
}

export function buildDemoFunnelEventBatch(
  inputs: readonly DemoFunnelEventInput[],
  browser: BrowserDemoAnalytics,
): DemoFunnelBatchInput | undefined {
  if (inputs.length === 0) return undefined;
  if (browser.dnt) return undefined;
  const session = resolveAnalyticsSession(browser.storage, browser.surface, browser.now, browser.create_id);
  persistAnalyticsCookies(session, browser.secure, browser.write_cookie);
  const signup = inputs.find((input) => input.name === 'signup_clicked');
  if (signup) {
    persistTrialHandoffCookie(signup.trial_session_id, browser.secure, browser.write_cookie);
  }
  const occurredAt = browser.now ?? Date.now();
  return {
    anonymous_id: session.anonymous_id,
    app_session_id: session.session_id,
    events: inputs.map((input, index) => ({
      session_id: input.trial_session_id,
      event_id: (browser.create_id ?? (() => crypto.randomUUID()))(),
      name: input.name,
      // Related transitions share one request, and a one-millisecond logical
      // offset keeps their event-time ordering explicit in D1 and PostHog.
      occurred_at: occurredAt + index,
      ...(input.step ? { step: input.step } : {}),
      ...(input.scenario_id ? { scenario_id: input.scenario_id } : {}),
    })),
  };
}

export function buildDemoFunnelBatch(input: DemoFunnelEventInput, browser: BrowserDemoAnalytics): DemoFunnelBatchInput | undefined {
  return buildDemoFunnelEventBatch([input], browser);
}

export async function trackDemoFunnelEvents(
  inputs: readonly DemoFunnelEventInput[],
  surface: '/try' | '/onboarding',
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  let storage: Storage;
  try {
    storage = localStorage;
  } catch {
    return false;
  }
  const body = buildDemoFunnelEventBatch(inputs, {
    storage,
    surface,
    secure: location.protocol === 'https:',
    write_cookie: (value) => { document.cookie = value; },
    dnt: navigator.doNotTrack === '1',
  });
  if (!body) return false;
  try {
    await fetcher('/api/public/demo-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    });
    return true;
  } catch {
    return false;
  }
}

export function trackDemoFunnelEvent(
  input: DemoFunnelEventInput,
  surface: '/try' | '/onboarding',
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  return trackDemoFunnelEvents([input], surface, fetcher);
}

export async function trackLandingTryClick(fetcher: typeof fetch = fetch): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  let storage: Storage;
  try {
    storage = localStorage;
  } catch {
    return false;
  }
  // This write deliberately happens before the first await so ordinary anchor
  // navigation cannot separate the click from its trial correlation id.
  const trialSessionId = ensureDemoTrialSession(storage);
  if (!trialSessionId) return false;
  return trackDemoFunnelEvent(
    { name: 'landing_try_clicked', trial_session_id: trialSessionId },
    '/try',
    fetcher,
  );
}
