// Shared frontend metadata for task types (v1.4): label, icon path (24x24
// stroke format, same convention as components/shell/Icon.astro — a single
// `d` string, possibly several space-separated `M...` subpaths), and a sort
// weight used to break ties when ordering same-due-date tasks (see the
// /tasks card ordering rule in the plan). `todo` intentionally has no icon
// (iconPath: null) — plain user tasks stay the calm default;
// components/tasks/TaskTypeIcon.svelte renders nothing for it.
import { TASK_TYPES, type TaskType } from './schemas/tasks';

export interface TaskTypeMetaEntry {
  label: string;
  iconPath: string | null;
  weight: number;
}

export const TASK_TYPE_META: Record<TaskType, TaskTypeMetaEntry> = {
  todo: {
    label: 'To-do',
    iconPath: null,
    weight: 0,
  },
  attend_class: {
    label: 'Attend class',
    // calendar-check: calendar body (Icon.astro's `calendar`) + a checkmark.
    iconPath:
      'M4 8h16 M7 3v4 M17 3v4 M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z M9 13.5l2 2 4-4.5',
    weight: 1,
  },
  prep_before_class: {
    label: 'Prep before class',
    // open-book: two facing pages meeting at a center spine.
    iconPath: 'M12 6.5c-1.5-1-4-1.5-8-1.5v13c4 0 6.5 .5 8 1.5c1.5-1 4-1.5 8-1.5v-13c-4 0-6.5 .5-8 1.5Z M12 6.5v13',
    weight: 2,
  },
  review_after_class: {
    label: 'Review after class',
    // ccw-arrow: a near-full circular arc with an arrowhead at its start.
    iconPath: 'M19 12a7 7 0 1 1 -2.5 -5.4 M19 3v4.5h-4.5',
    weight: 3,
  },
  practice_kc: {
    label: 'Practice',
    // target: three concentric rings, drawn via the two-arc circle trick.
    iconPath:
      'M3 12a9 9 0 1 0 18 0 a9 9 0 1 0 -18 0 M6.5 12a5.5 5.5 0 1 0 11 0 a5.5 5.5 0 1 0 -11 0 M10.5 12a1.5 1.5 0 1 0 3 0 a1.5 1.5 0 1 0 -3 0',
    weight: 4,
  },
  stale_kc: {
    label: 'Revisit',
    // clock: circle + hour/minute hands.
    iconPath: 'M4 12a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0 M12 7v5l3.5 3',
    weight: 5,
  },
  grade_entry: {
    label: 'Enter grade',
    // percent: diagonal stroke + two small circles at opposite corners.
    iconPath: 'M6.5 17.5l11-11 M6 8.5a1.5 1.5 0 1 0 3 0 a1.5 1.5 0 1 0 -3 0 M15 15.5a1.5 1.5 0 1 0 3 0 a1.5 1.5 0 1 0 -3 0',
    weight: 6,
  },
  // v1.9 placeholder — TASK_TYPE_META is an exhaustive Record<TaskType, ...>,
  // so 'ritual' needs an entry here to keep check:types green. Label/icon are
  // provisional; the rituals track owns real polish of this entry.
  ritual: {
    label: 'Ritual',
    // repeat-circle: a near-full circular arc (provisional — placeholder
    // shape distinct from review_after_class's; rituals track owns final art).
    iconPath: 'M12 4a8 8 0 1 0 8 8 M16 4v4h-4',
    weight: 7,
  },
};

// Re-exported so frontend code that only needs the list/type of task types
// (e.g. iterating settings toggles) can import it from this module instead
// of reaching into the schemas layer.
export { TASK_TYPES };
export type { TaskType };
