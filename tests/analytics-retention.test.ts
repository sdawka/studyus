import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { classSessions, courses, users } from '../src/db/schema';
import {
  attendanceToggledEvent,
  calendarConnectAttemptEvents,
  changedSettingsKeys,
  courseArchivedEvent,
  retentionEventSurface,
  settingsChangedEvent,
  weeksSinceAdded,
} from '../src/lib/analytics/retention';
import { countSessionsBehind, localNoon, updateClassSessionStatus } from '../src/lib/services/classSessions';
import { DEFAULT_SETTINGS, type ResolvedSettings } from '../src/lib/services/user';

const db = getDb(env.DB);
const now = 1_800_000_000_000;
const base = { user_id: 'user-1', session_id: 'session-1', surface: '/settings', ts: now };

describe('retention event builders', () => {
  it('accepts only maintained product route patterns from the surface header', () => {
    const request = (surface?: string) => new Request('https://studyus.test/api/v1/user', {
      headers: surface ? { 'X-Studyus-Analytics-Surface': surface } : undefined,
    });

    expect(retentionEventSurface(request('/standing'), 'attendance')).toBe('/standing');
    expect(retentionEventSurface(request('/planner'), 'attendance')).toBe('/planner');
    expect(retentionEventSurface(request('/dashboard'), 'attendance')).toBe('/api/v1/class-sessions/[id]');
    expect(retentionEventSurface(request('/standing?course=private'), 'attendance')).toBe('/api/v1/class-sessions/[id]');
    expect(retentionEventSurface(request('https://studyus.test/standing'), 'attendance')).toBe('/api/v1/class-sessions/[id]');

    expect(retentionEventSurface(request('/courses/[slug]'), 'settings')).toBe('/courses/[slug]');
    expect(retentionEventSurface(request('/unknown'), 'settings')).toBe('/settings');
    expect(retentionEventSurface(request('/settings?token=secret'), 'settings')).toBe('/settings');
    expect(retentionEventSurface(request(), 'settings')).toBe('/settings');
  });

  it('emits only actually changed setting key names and suppresses the new opt-out state', () => {
    const before: ResolvedSettings = structuredClone(DEFAULT_SETTINGS);
    const after: ResolvedSettings = {
      ...structuredClone(DEFAULT_SETTINGS),
      theme: 'focus',
      analytics_opt_out: true,
      task_generators: { ...DEFAULT_SETTINGS.task_generators, stale_kc: true },
    };
    const keys = changedSettingsKeys(
      { theme: 'focus', scheme: 'light', analytics_opt_out: true, task_generators: { stale_kc: true } },
      before,
      after,
    );
    expect(keys).toEqual(['theme', 'task_generators', 'analytics_opt_out']);
    expect(settingsChangedEvent(base, keys, true)).toBeUndefined();

    const event = settingsChangedEvent(base, ['theme', 'task_generators'], false);
    expect(event).toMatchObject({ name: 'settings_changed', keys: ['theme', 'task_generators'] });
    expect(JSON.stringify(event)).not.toContain('focus');
    expect(JSON.stringify(event)).not.toContain('stale_kc');
  });

  it('keeps calendar attempt order and timestamps without error details', () => {
    const events = calendarConnectAttemptEvents(
      { user_id: base.user_id, session_id: base.session_id, surface: base.surface },
      { provider: 'google', started_at: now, completed_at: now + 250, outcome: 'failed' },
    );
    expect(events.map((event) => event.name)).toEqual(['calendar_connect_started', 'calendar_connect_failed']);
    expect(events.map((event) => event.ts)).toEqual([now, now + 250]);
    expect(events.every((event) => 'provider' in event && event.provider === 'google')).toBe(true);
    expect(JSON.stringify(events)).not.toContain('error');
  });

  it('normalizes cleared attendance and deterministically bounds course age', () => {
    expect(attendanceToggledEvent(base, {
      course_id: 'course-1',
      status: null,
      sessions_behind: 3,
    })).toMatchObject({ name: 'attendance_toggled', status: 'unmarked', sessions_behind: 3 });
    expect(weeksSinceAdded(now - 20 * 24 * 60 * 60 * 1000, now)).toBe(2);
    expect(weeksSinceAdded(now + 1, now)).toBe(0);
    expect(courseArchivedEvent(base, { course_id: 'course-1', created_at: now - 14 * 24 * 60 * 60 * 1000 }))
      .toMatchObject({ name: 'course_archived', course_id: 'course-1', weeks_since_added: 2 });
  });
});

describe('attendance lag derivation', () => {
  let userId: string;
  let courseId: string;

  beforeEach(async () => {
    userId = crypto.randomUUID();
    courseId = crypto.randomUUID();
    await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
    await db.insert(courses).values({ id: courseId, userId, code: 'RET 101', slug: `ret-${courseId}`, title: 'Retention' });
  });

  it('counts only overdue unmarked sessions after the successful toggle', async () => {
    const yesterday = localNoon(now) - 24 * 60 * 60 * 1000;
    const older = yesterday - 24 * 60 * 60 * 1000;
    const firstId = crypto.randomUUID();
    await db.insert(classSessions).values([
      { id: firstId, userId, courseId, date: older, status: null, source: 'manual' },
      { id: crypto.randomUUID(), userId, courseId, date: yesterday, status: null, source: 'manual' },
      { id: crypto.randomUUID(), userId, courseId, date: localNoon(now), status: null, source: 'manual' },
      { id: crypto.randomUUID(), userId, courseId, date: older - 24 * 60 * 60 * 1000, status: 'attended', source: 'manual' },
    ]);
    expect(await countSessionsBehind(db, userId, courseId, now)).toBe(2);
    await updateClassSessionStatus(db, userId, firstId, { status: 'attended' });
    expect(await countSessionsBehind(db, userId, courseId, now)).toBe(1);
  });
});
