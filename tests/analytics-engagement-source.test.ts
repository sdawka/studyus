import { describe, expect, it } from 'vitest';
import analyticsClientSource from '../src/lib/analytics/client.ts?raw';
import taskStoreSource from '../src/lib/stores/tasks.ts?raw';
import plannerSource from '../src/components/planner/EventPopover.svelte?raw';
import modalSource from '../src/components/events/LogEventModal.svelte?raw';
import quickEventSource from '../src/components/admin/QuickEventForm.svelte?raw';
import notificationsSource from '../src/components/shell/NotificationsBell.svelte?raw';
import resourceCardSource from '../src/components/feed/ResourceCard.svelte?raw';
import resourceTileSource from '../src/components/course/ResourceTile.svelte?raw';
import kcPageSource from '../src/pages/courses/[slug]/kc/[kcId].astro?raw';

describe('engagement component emitter wiring', () => {
  it('queues deliberate events until the gated browser transport is ready', () => {
    expect(analyticsClientSource).toContain('pendingCaptures.push(input)');
    expect(analyticsClientSource).toContain('for (const input of queued) captureBehavioralEvent(input)');
    expect(analyticsClientSource).toContain('if (bootstrap && !mayCapture(bootstrap)) return');
  });

  it('captures task mutation outcomes only in settled-success paths', () => {
    expect(taskStoreSource).toContain('if (completed && surface) captureBehavioralEvent(taskCheckedEvent(task, surface))');
    expect(taskStoreSource).toContain("if (task.source === 'system' && surface) captureBehavioralEvent(taskDismissedEvent(task, surface))");
    expect(taskStoreSource.indexOf('tasksError.set(null);')).toBeLessThan(taskStoreSource.indexOf('taskCheckedEvent(task, surface)'));
    expect(plannerSource).toContain('} else if (nextDone) {');
    expect(plannerSource).toContain('captureBehavioralEvent(taskCheckedEvent({');
  });

  it('preserves the D5 attempt and gates submitted analytics on API success', () => {
    for (const source of [modalSource, quickEventSource]) {
      expect(source).toContain('postManualEvent(');
      expect(source).toContain('posted.attempt.idempotencyKey');
      expect(source.indexOf('if (!result.ok)')).toBeLessThan(source.indexOf('analytics.submitted('));
      expect(source).toMatch(/if \([^\n]*submitting[^\n]*\) return/);
    }
    expect(modalSource).toContain('analytics.opened()');
    expect(quickEventSource).toContain('analytics.opened()');
  });

  it('covers every maintained notification and resource activation control', () => {
    expect(notificationsSource).toContain('analytics.opened(n.id, n.type)');
    expect(resourceCardSource).toContain('onclick={trackOpen}');
    expect(resourceCardSource).toContain('trackOpen();');
    expect(resourceTileSource).toContain('onclick={trackOpen}');
    expect(resourceTileSource).toContain('trackOpen();');
    expect(kcPageSource).toContain('<ResourceAnalyticsLink client:visible');
  });
});
