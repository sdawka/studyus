export const AI_FEATURES = ['tutor', 'quiz_generation'] as const;

export type AiFeature = (typeof AI_FEATURES)[number];
export type AiUnavailableReason = 'disabled' | 'provider_not_configured';

export type AiEnv = {
  AI_FEATURES_ENABLED?: string;
  OPENROUTER_API_KEY?: string;
};

export type AiCapabilities = {
  enabled: boolean;
  provider: 'openrouter';
  reason: AiUnavailableReason | null;
  features: Record<AiFeature, boolean>;
};

const FEATURE_LABELS: Record<AiFeature, string> = {
  tutor: 'AI tutoring',
  quiz_generation: 'AI-generated quiz questions',
};

/**
 * Public-safe capability projection. This intentionally exposes only policy
 * and provider readiness, never a secret value or identifying fragment.
 */
export function getAiCapabilities(env: AiEnv): AiCapabilities {
  const enabledByPolicy = env.AI_FEATURES_ENABLED === 'true';
  const providerConfigured = typeof env.OPENROUTER_API_KEY === 'string' && env.OPENROUTER_API_KEY.trim().length > 0;
  const enabled = enabledByPolicy && providerConfigured;
  const reason: AiUnavailableReason | null = enabled
    ? null
    : enabledByPolicy
      ? 'provider_not_configured'
      : 'disabled';

  return {
    enabled,
    provider: 'openrouter',
    reason,
    features: {
      tutor: enabled,
      quiz_generation: enabled,
    },
  };
}

export class AiFeatureUnavailableError extends Error {
  readonly feature: AiFeature;
  readonly reason: AiUnavailableReason;

  constructor(feature: AiFeature, reason: AiUnavailableReason) {
    super(`${FEATURE_LABELS[feature]} ${reason === 'disabled' ? 'is disabled in this environment' : 'is not configured'}.`);
    this.name = 'AiFeatureUnavailableError';
    this.feature = feature;
    this.reason = reason;
  }
}

/** Server-authoritative gate. Call this before any provider request or write. */
export function requireAiFeature<TEnv extends AiEnv>(
  env: TEnv,
  feature: AiFeature,
): asserts env is TEnv & { OPENROUTER_API_KEY: string } {
  const capabilities = getAiCapabilities(env);
  if (!capabilities.features[feature]) {
    throw new AiFeatureUnavailableError(feature, capabilities.reason ?? 'disabled');
  }
}
