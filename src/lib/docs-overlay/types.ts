// TEMPORARY — docs annotation overlay. See docs/product/annotations.md.
// Retire the layer by deleting src/lib/docs-overlay/ + src/components/docs-overlay/
// and reverting the flag-guarded wiring listed in that doc.
//
// Types for the annotation registry: the machine-readable projection of
// docs/product/screens.md onto live DOM nodes. Content lives in annotations.ts.

export interface Annotation {
  /** Component name exactly as written in docs/product/screens.md. */
  name: string;
  /**
   * CSS selector resolved against the live document. Prefer the `.slot-*`
   * wrappers on card-dense routes — most components render a bare
   * `<section class="card">` root and can't be told apart by class alone.
   */
  selector: string;
  /** Annotate every match rather than just the first (e.g. '.task-row'). */
  all?: boolean;
  /** What job this component exists to do. */
  purpose: string;
  /** What the student can perceive they can do here. */
  affordances: string[];
  /** What actually happens on interaction — endpoints, stores, navigation. */
  actions: string[];
  /** How the app responds — motion, optimistic state, errors, empty states. */
  feedback: string[];
  /** Provenance: doc paths this entry was distilled from. */
  docs: string[];
}

export interface RouteAnnotation {
  /** Astro route pattern, e.g. '/courses/[slug]'. */
  route: string;
  title: string;
  purpose: string;
  /** Jobs-to-be-done this screen serves. */
  jobs: string[];
  /** Notable end-to-end flows that pass through this screen. */
  flows: string[];
  docs: string[];
  components: Annotation[];
}

const patternCache = new Map<string, RegExp>();

/** '/courses/[slug]' -> /^\/courses\/[^/]+\/?$/ */
function toPattern(route: string): RegExp {
  const cached = patternCache.get(route);
  if (cached) return cached;
  const source = route
    .split('/')
    .map((seg) => {
      if (seg.startsWith('[...')) return '.*';
      if (seg.startsWith('[')) return '[^/]+';
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  const pattern = new RegExp(`^${source}/?$`);
  patternCache.set(route, pattern);
  return pattern;
}

/** Literal (non-param) segment count — higher wins, so '/study/quiz' beats '/study'. */
function specificity(route: string): number {
  return route.split('/').filter((seg) => seg && !seg.startsWith('[')).length;
}

/**
 * Pick the most specific route annotation matching a real `location.pathname`.
 * Returns null when the current route isn't annotated (most routes aren't —
 * the layer deliberately covers only the core six, see annotations.ts).
 */
export function matchRoute<T extends { route: string }>(pathname: string, routes: T[]): T | null {
  let best: T | null = null;
  let bestScore = -1;
  for (const candidate of routes) {
    if (!toPattern(candidate.route).test(pathname)) continue;
    const score = specificity(candidate.route);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}
