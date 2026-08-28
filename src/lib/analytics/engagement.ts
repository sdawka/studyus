import type { EventType } from '../schemas/events';
import type { NotificationType } from '../schemas/notifications';
import type { TaskType } from '../schemas/tasks';
import type { BehavioralCapture } from './daily';
import type { BehavioralEventInput } from './events';

export type ResourceOrigin = 'feed' | 'course' | 'shared';

export function taskCheckedEvent(
  task: { type?: TaskType; due_date?: string | null },
  sourceSurface: string,
  now = new Date(),
): BehavioralEventInput {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const due = task.due_date ? new Date(task.due_date) : undefined;
  if (due) due.setHours(0, 0, 0, 0);
  return {
    name: 'task_checked',
    task_type: task.type ?? 'todo',
    source_surface: sourceSurface,
    overdue: Boolean(due && due.getTime() < today.getTime()),
  };
}

export function taskDismissedEvent(
  task: { type?: TaskType },
  sourceSurface: string,
): BehavioralEventInput {
  return { name: 'task_dismissed', task_type: task.type ?? 'todo', source_surface: sourceSurface };
}

/** One instance per maintained Record Event control. */
export function createRecordEventAnalytics(capture: BehavioralCapture) {
  let interactionOpen = false;
  const submittedAttempts = new Set<string>();

  function opened(): void {
    if (interactionOpen) return;
    capture({ name: 'record_event_opened' });
    interactionOpen = true;
  }

  return {
    opened,
    closed(): void {
      interactionOpen = false;
    },
    submitted(eventType: EventType, attemptId: string): void {
      if (submittedAttempts.has(attemptId)) return;
      opened();
      capture({ name: 'record_event_submitted', event_type: eventType });
      submittedAttempts.add(attemptId);
      interactionOpen = false;
    },
  };
}

/** Notification ids are used only as an in-memory duplicate guard, never sent. */
export function createNotificationAnalytics(capture: BehavioralCapture) {
  const openedIds = new Set<string>();
  return {
    opened(notificationId: string, notificationType: NotificationType): void {
      if (openedIds.has(notificationId)) return;
      capture({ name: 'notification_opened', notification_type: notificationType });
      openedIds.add(notificationId);
    },
  };
}

/** Resource ids suppress hydration rerenders and double activations. */
export function createResourceAnalytics(capture: BehavioralCapture) {
  const openedIds = new Set<string>();

  function opened(resourceId: string, origin: ResourceOrigin): void {
    if (openedIds.has(resourceId)) return;
    capture({ name: 'resource_opened', resource_id: resourceId, origin });
    openedIds.add(resourceId);
  }

  return { opened };
}
