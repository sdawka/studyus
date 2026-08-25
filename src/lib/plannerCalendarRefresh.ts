export const CALENDAR_SYNCED_EVENT = 'studyus:calendar-synced';

/**
 * Refresh planner data after the app shell has finished importing changes
 * from a connected calendar. Keeping the listener registration here makes
 * its lifecycle explicit and independently testable from the Svelte view.
 */
export function listenForCalendarSync(target: EventTarget, refresh: () => void): () => void {
  target.addEventListener(CALENDAR_SYNCED_EVENT, refresh);
  return () => target.removeEventListener(CALENDAR_SYNCED_EVENT, refresh);
}
