import type { DemoFunnelBatchInput, DemoScenarioId } from '../schemas/onboarding';
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

export function buildDemoFunnelBatch(input: DemoFunnelEventInput, browser: BrowserDemoAnalytics): DemoFunnelBatchInput | undefined {
  if (browser.dnt) return undefined;
  const session = resolveAnalyticsSession(browser.storage, browser.surface, browser.now, browser.create_id);
  persistAnalyticsCookies(session, browser.secure, browser.write_cookie);
  if (input.name === 'signup_clicked') {
    persistTrialHandoffCookie(input.trial_session_id, browser.secure, browser.write_cookie);
  }
  return {
    anonymous_id: session.anonymous_id,
    app_session_id: session.session_id,
    events: [{
      session_id: input.trial_session_id,
      event_id: (browser.create_id ?? (() => crypto.randomUUID()))(),
      name: input.name,
      occurred_at: browser.now ?? Date.now(),
      ...(input.step ? { step: input.step } : {}),
      ...(input.scenario_id ? { scenario_id: input.scenario_id } : {}),
    }],
  };
}

export async function trackDemoFunnelEvent(
  input: DemoFunnelEventInput,
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
  const body = buildDemoFunnelBatch(input, {
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
