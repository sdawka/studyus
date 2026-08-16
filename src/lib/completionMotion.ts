// Shared timing + motion vocabulary for the task-completion moment
// ("check, savor, bow out"): TaskCheckbox plays the check itself (pop,
// ring pulse, confetti), the row then lingers in place for
// COMPLETION_HOLD_MS so the strikethrough can be savored, and finally
// departs via the taskDepart transition below. Pure TS on purpose — no
// svelte imports — so stores/tasks.ts (framework-agnostic by convention)
// can import the hold constant from here without dragging component code
// into the store graph.

// How long a just-completed row holds its place in an "open" list before
// reclassifying (TasksView's Done disclosure, TodayTasks' bucket exit).
// Long enough to watch the check land and read the struck-through title
// (the confetti tail is ~1.1s), short enough that the list still feels
// like it tidies itself. The depart animation plays AFTER this window,
// on removal.
export const COMPLETION_HOLD_MS = 1600;

// Departure length. Kept under ~300ms so a batch of rapid completions
// queues into a pleasing cascade rather than a traffic jam.
export const TASK_DEPART_MS = 280;

// CompletionFlow celebrates at its Done button the instant completion is
// confirmed (before the store flip — on surfaces without a completion hold
// the optimistic flip unmounts the row AND the dialog in the same tick, so
// bursting after would fire from a dead anchor). When the row DOES survive,
// its TaskCheckbox sees the checked edge moments later and would burst
// again; this timestamp lets the checkbox skip just its confetti (keeping
// the pop/ring) when a flow celebration already covered the moment. Window
// is generous vs. the flip latency but far shorter than any human could
// complete two tasks through separate paths.
let lastFlowCelebrationAt = 0;

export function markFlowCelebration(): void {
  lastFlowCelebrationAt = Date.now();
}

export function recentFlowCelebration(windowMs = 800): boolean {
  return Date.now() - lastFlowCelebrationAt < windowMs;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function cubicInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 0.5 * Math.pow(2 * t - 2, 3) + 1;
}

interface TaskDepartParams {
  // The parent's flex/grid gap (px). Removing a row also removes one gap,
  // so the transition animates margin-bottom toward -gap in step with the
  // height collapse — occupied space lands at exactly the post-removal
  // layout and the list never snaps on the final frame.
  gap?: number;
  duration?: number;
}

interface TransitionConfig {
  duration: number;
  easing?: (t: number) => number;
  css: (t: number, u: number) => string;
}

// Svelte `out:` transition: fade + slight rightward drift while the row's
// height (and one list gap) collapses underneath it, so following rows
// glide up instead of jumping. Element height is measured at removal time;
// overflow is clipped for the duration so inner padding/content never
// paints outside the shrinking box. Under prefers-reduced-motion this
// degrades to a brief pure-opacity fade — the reclassification still
// reads, without the choreography.
export function taskDepart(node: Element, params: TaskDepartParams = {}): TransitionConfig {
  const { gap = 0, duration = TASK_DEPART_MS } = params;

  if (prefersReducedMotion()) {
    return {
      duration: 140,
      css: (t) => `opacity: ${t};`,
    };
  }

  const height = (node as HTMLElement).offsetHeight;

  return {
    duration,
    easing: cubicInOut,
    css: (t, u) => `
      overflow: hidden;
      height: ${(t * height).toFixed(1)}px;
      margin-bottom: ${(-u * gap).toFixed(1)}px;
      opacity: ${Math.min(1, t * 1.4).toFixed(3)};
      transform: translateX(${(u * 14).toFixed(1)}px);
    `,
  };
}
