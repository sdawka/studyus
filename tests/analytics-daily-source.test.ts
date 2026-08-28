import { describe, expect, it } from 'vitest';
import bootstrapSource from '../src/lib/analytics/client.ts?raw';
import bootstrapComponentSource from '../src/components/AnalyticsBootstrap.astro?raw';
import nextMoveSource from '../src/components/dashboard/NextMoveCard.svelte?raw';

describe('daily analytics emitter wiring', () => {
  it('routes page lifecycle through the gated analytics wrapper', () => {
    expect(bootstrapComponentSource).toContain('surface: Astro.routePattern');
    expect(bootstrapSource).toContain('capturePageLifecycle(session, config.surface, captureBehavioralEvent)');
    expect(bootstrapSource).toContain('if (!mayCapture(config))');
  });

  it('limits Next Move terminals to their intended controls', () => {
    expect(nextMoveSource).toContain('analytics.viewed(move, activeIndex + 1, selectedMinutes)');
    expect(nextMoveSource).toContain('analytics.ignored(move, activeIndex + 1, selectedMinutes)');
    expect(nextMoveSource).toContain('analytics.followed(move, activeIndex + 1, selectedMinutes)');
    expect(nextMoveSource).toContain('onclick={followMove}');
    expect(nextMoveSource).toContain('onclick={showAnother}');
  });
});
