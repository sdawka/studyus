import { z } from 'zod';

export const signupMethodSchema = z.enum(['oauth', 'phone', 'email', 'unknown']);
export type SignupMethod = z.infer<typeof signupMethodSchema>;

export type SignupMethodSignals = {
  external_account_count: number;
  has_phone: boolean;
  has_email: boolean;
};

export function resolveSignupMethod(signals: SignupMethodSignals): SignupMethod {
  if (signals.external_account_count > 0) return 'oauth';
  if (signals.has_phone) return 'phone';
  if (signals.has_email) return 'email';
  return 'unknown';
}

const trialSessionIdSchema = z.string().uuid();

export function analyticsPersonProperties(trialSessionId: string | undefined): { trial_session_id: string } | undefined {
  const parsed = trialSessionIdSchema.safeParse(trialSessionId);
  return parsed.success ? { trial_session_id: parsed.data } : undefined;
}

export function analyticsIdentityBootstrap(anonymousId: string): { distinctID: string; isIdentifiedID: false } {
  return { distinctID: anonymousId, isIdentifiedID: false };
}
