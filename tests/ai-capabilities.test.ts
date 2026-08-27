import { describe, expect, it } from 'vitest';
import {
  AiFeatureUnavailableError,
  getAiCapabilities,
  requireAiFeature,
} from '../src/lib/ai/capabilities';
import { serviceErrorResponse } from '../src/lib/apiErrors';

describe('AI capabilities', () => {
  it('requires both explicit policy enablement and a non-blank provider key', () => {
    expect(getAiCapabilities({ AI_FEATURES_ENABLED: 'true', OPENROUTER_API_KEY: 'secret' })).toEqual({
      enabled: true,
      provider: 'openrouter',
      reason: null,
      features: { tutor: true, quiz_generation: true },
    });

    expect(getAiCapabilities({ AI_FEATURES_ENABLED: 'false', OPENROUTER_API_KEY: 'secret' })).toMatchObject({
      enabled: false,
      reason: 'disabled',
      features: { tutor: false, quiz_generation: false },
    });

    expect(getAiCapabilities({ AI_FEATURES_ENABLED: 'true', OPENROUTER_API_KEY: '   ' })).toMatchObject({
      enabled: false,
      reason: 'provider_not_configured',
    });
  });

  it('never exposes the provider key in its public projection', () => {
    const key = 'should-never-reach-the-client';
    expect(JSON.stringify(getAiCapabilities({ AI_FEATURES_ENABLED: 'true', OPENROUTER_API_KEY: key }))).not.toContain(key);
  });

  it('fails closed with the stable API error contract', async () => {
    const gated = () => requireAiFeature({ AI_FEATURES_ENABLED: 'false', OPENROUTER_API_KEY: 'secret' }, 'tutor');
    expect(gated).toThrow(AiFeatureUnavailableError);

    let error: unknown;
    try {
      gated();
    } catch (caught) {
      error = caught;
    }
    const response = serviceErrorResponse(error);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'ai_unavailable', message: 'AI tutoring is disabled in this environment.' },
    });
  });
});
