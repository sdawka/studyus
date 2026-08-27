import { describe, expect, it } from 'vitest';
import { canonicalRedirectUrl } from '../src/lib/canonicalOrigin';

describe('canonical production origin', () => {
  it('redirects the raw Worker hostname while preserving path and query', () => {
    const redirected = canonicalRedirectUrl(
      new URL('https://studyus.dawka.workers.dev/tutor/kc-1?c=conversation-1'),
    );

    expect(redirected?.href).toBe('https://studyus.app/tutor/kc-1?c=conversation-1');
  });

  it('leaves the canonical and local development hosts unchanged', () => {
    expect(canonicalRedirectUrl(new URL('https://studyus.app/dashboard'))).toBeNull();
    expect(canonicalRedirectUrl(new URL('http://127.0.0.1:4321/dashboard'))).toBeNull();
  });
});
