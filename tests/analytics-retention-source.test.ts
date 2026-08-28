import { describe, expect, it } from 'vitest';
import attendanceCardSource from '../src/components/standing/AttendanceCard.svelte?raw';
import eventPopoverSource from '../src/components/planner/EventPopover.svelte?raw';
import calendarSettingsSource from '../src/components/settings/CalendarIntegrationSettings.svelte?raw';
import appearanceSettingsSource from '../src/components/settings/AppearanceSettings.svelte?raw';
import privacySettingsSource from '../src/components/settings/AnalyticsPrivacySettings.svelte?raw';
import sidebarSource from '../src/components/shell/Sidebar.astro?raw';
import attendanceRouteSource from '../src/pages/api/v1/class-sessions/[id].ts?raw';
import calendarRouteSource from '../src/pages/api/v1/calendar/connections/index.ts?raw';
import settingsRouteSource from '../src/pages/api/v1/user/index.ts?raw';
import courseRouteSource from '../src/pages/api/v1/courses/[slug].ts?raw';

describe('retention analytics wiring', () => {
  it('covers both maintained attendance controls at the successful mutation boundary', () => {
    expect(attendanceCardSource).toContain('/api/v1/class-sessions/${session.id}');
    expect(eventPopoverSource).toContain('/api/v1/class-sessions/${item.id}');
    expect(attendanceCardSource).toContain("'X-Studyus-Analytics-Surface': '/standing'");
    expect(eventPopoverSource).toContain("'X-Studyus-Analytics-Surface': '/planner'");
    expect(attendanceRouteSource.indexOf('updateClassSessionStatus(')).toBeLessThan(
      attendanceRouteSource.indexOf('attendanceToggledEvent('),
    );
    expect(attendanceRouteSource).toContain('previousStatus !== updated.status');
    expect(attendanceRouteSource).toContain('countSessionsBehind(');
  });

  it('queues one ordered calendar start/terminal batch per guarded attempt', () => {
    expect(calendarSettingsSource).toContain('if (busy !== null) return');
    expect(calendarRouteSource.indexOf('const startedAt = Date.now()')).toBeLessThan(
      calendarRouteSource.indexOf('connectCalendarProvider('),
    );
    expect(calendarRouteSource).toContain("queueOutcome('connected')");
    expect(calendarRouteSource).toContain("queueOutcome('failed')");
    expect(calendarRouteSource).toContain('{ force_batch: true }');
  });

  it('captures only persisted setting keys and never captures after opt-out', () => {
    expect(settingsRouteSource.indexOf('const updated = await updateUser(')).toBeLessThan(
      settingsRouteSource.indexOf('settingsChangedEvent('),
    );
    expect(settingsRouteSource).toContain(".filter((key) => key !== 'analytics_opt_out')");
    expect(privacySettingsSource.indexOf('await setAnalyticsOptOut(!nextEnabled)')).toBeLessThan(
      privacySettingsSource.indexOf("captureBehavioralEvent({ name: 'settings_changed'"),
    );
    expect(privacySettingsSource).toContain("if (nextEnabled) captureBehavioralEvent");
    expect(sidebarSource).toContain('settings: { sidebar_collapsed: nextCollapsed }');
    expect(sidebarSource).toContain('data-analytics-surface={Astro.routePattern}');
    expect(sidebarSource).toContain("'X-Studyus-Analytics-Surface': toggle.dataset.analyticsSurface ?? '/settings'");
    expect(settingsRouteSource).toContain("retentionEventSurface(request, 'settings')");
    expect(appearanceSettingsSource).toContain('if (saving || theme === id) return');
  });

  it('captures course archive only for the real false-to-true API transition', () => {
    expect(courseRouteSource).toContain('input.archived === true');
    expect(courseRouteSource).toContain('previouslyArchived === false');
    expect(courseRouteSource.indexOf('const course = await updateCourse(')).toBeLessThan(
      courseRouteSource.indexOf('courseArchivedEvent('),
    );
    expect(courseRouteSource).toContain('created_at: course.createdAt');
  });
});
