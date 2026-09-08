import { describe, expect, it } from 'vitest';
import source from '../src/components/study/StudyFlow.svelte?raw';

describe('StudyFlow session finalization wiring', () => {
  it('submits canonical KC outcomes in the single completion request', () => {
    expect(source).toContain('kc_outcomes: kcIds.map');
    expect(source).toContain('self_rating: Number(selfRatings[kcId])');
    expect(source).not.toContain("fetch('/api/v1/events'");
  });

  it('uses the explicit discard endpoint and the network-safe API helper', () => {
    expect(source).toContain('/discard`');
    expect(source).toContain('await apiFetch');
    expect(source).not.toContain('await fetch(`/api/v1/sessions/');
    expect(source).not.toContain('Discarded — not counted.');
  });

  it('uses acknowledged timer state and exposes recovery and takeover actions', () => {
    expect(source).toContain('/timer`');
    expect(source).toContain("operation: 'heartbeat'");
    expect(source).toContain("operation: 'takeover'");
    expect(source).toContain('Time from before timer tracking is unknown');
    expect(source).not.toContain('Date.now() - openSession.startedAt');
  });

  it('keeps the session running when the final timer pause fails', () => {
    expect(source).toContain('async function pauseTimer(): Promise<boolean>');
    expect(source).toContain('if (!(await pauseTimer())) return;');
  });
});
