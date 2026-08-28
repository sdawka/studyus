import type { SettingsInput } from '../schemas/user';
import type { ResolvedSettings } from '../services/user';
import { behavioralEventSchema, type BehavioralEvent } from './events';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const RETENTION_SURFACE_HEADER = 'x-studyus-analytics-surface';

const ATTENDANCE_SURFACES = new Set(['/standing', '/planner']);
const SETTINGS_SURFACES = new Set([
  '/404',
  '/corrections',
  '/courses',
  '/courses/[slug]',
  '/courses/[slug]/concepts',
  '/courses/[slug]/kc/[kcId]',
  '/courses/[slug]/notes',
  '/courses/[slug]/play',
  '/courses/[slug]/practice',
  '/courses/[slug]/resources',
  '/dashboard',
  '/feed',
  '/grades',
  '/learn/[kcId]',
  '/login',
  '/notes',
  '/notes/[id]',
  '/planner',
  '/profile',
  '/settings',
  '/study',
  '/study/quiz',
  '/tasks',
  '/tutor/[kcId]',
]);

type RetentionSurfaceKind = 'attendance' | 'settings';

export function retentionEventSurface(request: Request, kind: RetentionSurfaceKind): string {
  const candidate = request.headers.get(RETENTION_SURFACE_HEADER);
  const allowed = kind === 'attendance' ? ATTENDANCE_SURFACES : SETTINGS_SURFACES;
  if (candidate && allowed.has(candidate)) return candidate;
  return kind === 'attendance' ? '/api/v1/class-sessions/[id]' : '/settings';
}

export type SettingsChangeKey = keyof SettingsInput;

const SETTINGS_KEY_ORDER: readonly SettingsChangeKey[] = [
  'theme',
  'scheme',
  'sidebar_collapsed',
  'task_generators',
  'learning_preferences',
  'analytics_opt_out',
];

function equalSetting(
  key: SettingsChangeKey,
  before: ResolvedSettings,
  after: ResolvedSettings,
): boolean {
  if (key === 'task_generators') {
    return Object.keys(before.task_generators).every((generator) =>
      before.task_generators[generator as keyof ResolvedSettings['task_generators']]
      === after.task_generators[generator as keyof ResolvedSettings['task_generators']],
    );
  }
  if (key === 'learning_preferences') {
    return before.learning_preferences.weekly_hours === after.learning_preferences.weekly_hours
      && before.learning_preferences.guidance === after.learning_preferences.guidance
      && before.learning_preferences.depth === after.learning_preferences.depth;
  }
  return before[key] === after[key];
}

export function changedSettingsKeys(
  submitted: SettingsInput | undefined,
  before: ResolvedSettings,
  after: ResolvedSettings,
): SettingsChangeKey[] {
  if (!submitted) return [];
  return SETTINGS_KEY_ORDER.filter((key) => key in submitted && !equalSetting(key, before, after));
}

export function weeksSinceAdded(createdAt: number, now = Date.now()): number {
  if (!Number.isFinite(createdAt) || !Number.isFinite(now)) return 0;
  return Math.min(100_000, Math.max(0, Math.floor((now - createdAt) / WEEK_MS)));
}

type AuthenticatedBase = {
  user_id: string;
  session_id: string;
  surface: string;
  ts: number;
};

function parseEvent(candidate: unknown): BehavioralEvent | undefined {
  const parsed = behavioralEventSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

export function attendanceToggledEvent(
  base: AuthenticatedBase,
  input: { course_id: string; status: 'attended' | 'missed' | null; sessions_behind: number },
): BehavioralEvent | undefined {
  return parseEvent({
    name: 'attendance_toggled',
    ...base,
    course_id: input.course_id,
    status: input.status ?? 'unmarked',
    sessions_behind: input.sessions_behind,
  });
}

export function calendarConnectAttemptEvents(
  base: Omit<AuthenticatedBase, 'ts'>,
  input: {
    provider: 'google' | 'microsoft';
    started_at: number;
    completed_at: number;
    outcome: 'connected' | 'failed';
  },
): BehavioralEvent[] {
  const started = parseEvent({ name: 'calendar_connect_started', ...base, ts: input.started_at, provider: input.provider });
  const terminal = parseEvent({
    name: input.outcome === 'connected' ? 'calendar_connected' : 'calendar_connect_failed',
    ...base,
    ts: Math.max(input.started_at, input.completed_at),
    provider: input.provider,
  });
  return started && terminal ? [started, terminal] : [];
}

export function settingsChangedEvent(
  base: AuthenticatedBase,
  keys: readonly SettingsChangeKey[],
  analyticsOptOutAfter: boolean,
): BehavioralEvent | undefined {
  if (analyticsOptOutAfter || keys.length === 0) return undefined;
  return parseEvent({ name: 'settings_changed', ...base, keys });
}

export function courseArchivedEvent(
  base: AuthenticatedBase,
  input: { course_id: string; created_at: number },
): BehavioralEvent | undefined {
  return parseEvent({
    name: 'course_archived',
    ...base,
    course_id: input.course_id,
    weeks_since_added: weeksSinceAdded(input.created_at, base.ts),
  });
}
