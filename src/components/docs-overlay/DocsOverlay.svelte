<script lang="ts">
  // TEMPORARY — docs annotation overlay root. See docs/product/annotations.md.
  //
  // Owns: route match, DOM anchor resolution + re-resolution, the
  // rAF-throttled measure loop, the hotkey/Escape contract, and rendering the
  // badge layer + panel. Content (what to say about each component) lives in
  // annotations.ts (Track C); presentation of a single badge/the panel lives
  // in AnnotationBadge.svelte / AnnotationPanel.svelte.
  //
  // Contract this file must keep: mounted once as a direct body child by
  // ../../lib/docs-overlay/mount.ts, which is injected only by
  // docsOverlayIntegration() in astro.config.mjs and only for `astro dev`
  // (it was previously a flag-guarded `client:idle` island in AppShell, but
  // Astro registers islands at build-analysis time, so that still emitted a
  // 55.5K chunk of annotation prose into production builds); listens for the
  // `toggle-docs-overlay` window CustomEvent; all open/closed/selection state
  // lives in ../../lib/docs-overlay/store; never traps focus, never
  // scroll-locks — the app stays fully usable while this is open.
  import { onMount } from 'svelte';
  import {
    overlayOpen,
    selectedComponent,
    dockSide,
    setOverlay,
    toggleOverlay,
    selectComponent,
    toggleDock,
  } from '../../lib/docs-overlay/store';
  import { matchRoute, type Annotation, type RouteAnnotation } from '../../lib/docs-overlay/types';
  import { ROUTE_ANNOTATIONS, SHELL_ANNOTATIONS } from '../../lib/docs-overlay/annotations';
  import { isMobile } from '../../lib/stores/viewport';
  import AnnotationBadge from './AnnotationBadge.svelte';
  import AnnotationPanel from './AnnotationPanel.svelte';

  interface Numbered {
    annotation: Annotation;
    number: number;
  }

  const BADGE_SIZE = 22;
  const VIEWPORT_MARGIN = 6;
  const MUTATION_DEBOUNCE_MS = 120;

  // This is an MPA (no client router/view-transitions) — every navigation is
  // a full reload, so the route match + merged annotation list are computed
  // once per mount and never change for the component's lifetime.
  let route = $state<RouteAnnotation | null>(null);
  let numbered = $state<Numbered[]>([]);
  // Suppresses the always-on FAB (and only the FAB) so scripts/visual-qa.mjs
  // stays free of dev chrome: the harness sets localStorage
  // `sb:docs-overlay-chrome=hidden` via addInitScript before every shot. The
  // overlay panel itself is already screenshot-safe (starts closed), so this
  // only needs to hide the persistent toggle.
  let chromeHidden = $state(false);
  let badges = $state<{ key: string; name: string; number: number; x: number; y: number }[]>([]);
  let unresolvedNames = $state<string[]>([]);
  let offscreenNames = $state<Set<string>>(new Set());
  let outlineRects = $state<{ x: number; y: number; w: number; h: number }[]>([]);

  // Plain (non-reactive) working state the effects below close over — only
  // the measure()/resolve() *outputs* above need to be $state for the
  // template to react to them. `numberedList` mirrors `numbered` and is what
  // resolve()/measure() actually iterate: reading the $state `numbered` from
  // inside the very effect that (re)writes it (setup()/teardown()) makes
  // that effect depend on its own write, which self-triggers forever
  // (Svelte throws effect_update_depth_exceeded) — iterating a plain copy
  // instead breaks that cycle; `numbered` stays $state purely so
  // AnnotationPanel's prop updates.
  let numberedList: Numbered[] = [];
  let targetsByName = new Map<string, HTMLElement[]>();
  let observedTargets = new Set<HTMLElement>();
  let resizeObserver: ResizeObserver | null = null;
  let mutationObserver: MutationObserver | null = null;
  let mutationTimer: ReturnType<typeof setTimeout> | undefined;
  let rafId: number | null = null;

  function scheduleMeasure() {
    if (rafId != null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      measure();
    });
  }

  // Re-resolves every annotation's selector against the live DOM. Called on
  // first open and again (debounced) whenever the body's subtree mutates,
  // since client:idle/client:visible islands and the /planner + /tasks
  // route-modal layers all mount after first paint.
  function resolve() {
    targetsByName = new Map();
    const nextUnresolved: string[] = [];
    const nextObserved = new Set<HTMLElement>();

    for (const { annotation } of numberedList) {
      let els: HTMLElement[] = [];
      try {
        const found = document.querySelectorAll(annotation.selector);
        els = annotation.all ? (Array.from(found) as HTMLElement[]) : found[0] ? [found[0] as HTMLElement] : [];
      } catch {
        els = []; // a malformed selector shouldn't take down dev chrome
      }
      if (els.length === 0) nextUnresolved.push(annotation.name);
      else targetsByName.set(annotation.name, els);
      for (const el of els) nextObserved.add(el);
    }

    unresolvedNames = nextUnresolved;

    if (resizeObserver) {
      for (const el of observedTargets) if (!nextObserved.has(el)) resizeObserver.unobserve(el);
      for (const el of nextObserved) if (!observedTargets.has(el)) resizeObserver.observe(el);
    }
    observedTargets = nextObserved;

    scheduleMeasure();
  }

  function rectVisible(r: DOMRect, vw: number, vh: number): boolean {
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
  }

  // The one rAF-throttled positioning pass. Uses getBoundingClientRect()
  // (viewport coords) so scrolling containers — the planner grid, the tasks
  // list — need no special-casing.
  function measure() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const nextBadges: typeof badges = [];
    const nextOffscreen = new Set<string>();

    for (const { annotation, number } of numberedList) {
      const els = targetsByName.get(annotation.name);
      if (!els) continue;
      let anyVisible = false;
      els.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        if (!rectVisible(r, vw, vh)) return;
        anyVisible = true;
        nextBadges.push({
          key: `${annotation.name}::${i}`,
          name: annotation.name,
          number,
          x: Math.min(Math.max(r.left - BADGE_SIZE / 2, VIEWPORT_MARGIN), vw - BADGE_SIZE - VIEWPORT_MARGIN),
          y: Math.min(Math.max(r.top - BADGE_SIZE / 2, VIEWPORT_MARGIN), vh - BADGE_SIZE - VIEWPORT_MARGIN),
        });
      });
      if (!anyVisible) nextOffscreen.add(annotation.name);
    }

    badges = nextBadges;
    offscreenNames = nextOffscreen;

    const selected = selectedComponent.get();
    if (selected) {
      const els = targetsByName.get(selected) ?? [];
      outlineRects = els
        .map((el) => el.getBoundingClientRect())
        .filter((r) => rectVisible(r, vw, vh))
        .map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height }));
    } else {
      outlineRects = [];
    }
  }

  function onMutation() {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(resolve, MUTATION_DEBOUNCE_MS);
  }

  function setup() {
    // Read back from a local const, not the $state `route` we're about to
    // assign — reading a $state value back inside the same effect run that
    // wrote it makes the effect depend on its own write (see the
    // numberedList comment above); this hit that exact bug for `route`.
    const matched = matchRoute(location.pathname, ROUTE_ANNOTATIONS);
    route = matched;
    // Route-specific components lead (what's actually on screen right now);
    // always-present shell chrome follows.
    const merged = [...(matched?.components ?? []), ...SHELL_ANNOTATIONS];
    numberedList = merged.map((annotation, i) => ({ annotation, number: i + 1 }));
    numbered = numberedList;

    resolve();

    window.addEventListener('scroll', scheduleMeasure, { capture: true, passive: true });
    window.addEventListener('resize', scheduleMeasure);

    resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(document.body);
    for (const el of observedTargets) resizeObserver.observe(el);

    mutationObserver = new MutationObserver(onMutation);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  function teardown() {
    window.removeEventListener('scroll', scheduleMeasure, { capture: true });
    window.removeEventListener('resize', scheduleMeasure);
    resizeObserver?.disconnect();
    resizeObserver = null;
    mutationObserver?.disconnect();
    mutationObserver = null;
    clearTimeout(mutationTimer);
    if (rafId != null) cancelAnimationFrame(rafId);
    rafId = null;

    targetsByName = new Map();
    observedTargets = new Set();
    badges = [];
    unresolvedNames = [];
    offscreenNames = new Set();
    outlineRects = [];
    route = null;
    numberedList = [];
    numbered = [];
  }

  $effect(() => {
    if (!$overlayOpen) return;
    setup();
    return teardown;
  });

  // Re-outline immediately on selection change rather than waiting for the
  // next scroll/resize/mutation tick.
  $effect(() => {
    void $selectedComponent;
    if ($overlayOpen) measure();
  });

  // While the overlay is open, claim Escape ownership for the whole session
  // (not just while a card is expanded) so the /planner and /tasks
  // route-modal layers — which listen for Escape on the same document/window
  // target — never also react to a keypress this layer already owns. Same
  // convention as Sheet.svelte, just scoped to the overlay's full lifetime
  // since our own two-stage Escape handling (below) covers both "close the
  // card" and "close the overlay" itself.
  $effect(() => {
    if (!$overlayOpen) return;
    (window as unknown as Record<string, boolean>).__plannerBlockEscape = true;
    (window as unknown as Record<string, boolean>).__tasksBlockEscape = true;
    return () => {
      (window as unknown as Record<string, boolean>).__plannerBlockEscape = false;
      (window as unknown as Record<string, boolean>).__tasksBlockEscape = false;
    };
  });

  function onSelect(name: string | null) {
    selectComponent(name);
  }

  function onToggle() {
    toggleOverlay();
  }

  function onKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    const editable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable;

    if (!editable && e.shiftKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      toggleOverlay();
      return;
    }

    if (e.key !== 'Escape' || !overlayOpen.get()) return;
    // On mobile the panel is a Sheet, which already owns Escape-to-close via
    // its own onClose (AnnotationPanel wires that to a plain "close the
    // whole overlay" — mobile has no separate docked-card affordance to
    // back out of first). Desktop keeps the two-stage behavior: first
    // Escape closes an expanded card, a second closes the overlay.
    if (isMobile.get()) return;
    e.preventDefault();
    if (selectedComponent.get() !== null) selectComponent(null);
    else setOverlay(false);
  }

  onMount(() => {
    try {
      chromeHidden = localStorage.getItem('sb:docs-overlay-chrome') === 'hidden';
    } catch {
      /* Safari private mode throws on access — just show the toggle. */
    }
    window.addEventListener('toggle-docs-overlay', onToggle);
    window.addEventListener('keydown', onKeydown);
    return () => {
      window.removeEventListener('toggle-docs-overlay', onToggle);
      window.removeEventListener('keydown', onKeydown);
    };
  });
</script>

{#if $overlayOpen}
  <!-- No aria-hidden on this container: it holds the AnnotationBadge
       <button>s, and aria-hidden over focusable content is invalid ARIA —
       the badges would stay in the tab order while being invisible to
       assistive tech, and it would silently void the aria-label/aria-pressed
       the badge sets. Only the decorative outlines below are hidden. -->
  <div class="docs-overlay-layer">
    {#each outlineRects as rect, i (i)}
      <div
        class="docs-outline"
        aria-hidden="true"
        style={`transform: translate3d(${rect.x}px, ${rect.y}px, 0); width:${rect.w}px; height:${rect.h}px`}
      ></div>
    {/each}
    {#each badges as badge (badge.key)}
      <AnnotationBadge
        number={badge.number}
        name={badge.name}
        active={$selectedComponent === badge.name}
        x={badge.x}
        y={badge.y}
        onSelect={onSelect}
      />
    {/each}
  </div>

  <AnnotationPanel
    {route}
    {numbered}
    selected={$selectedComponent}
    unresolved={unresolvedNames}
    offscreen={offscreenNames}
    dockSide={$dockSide}
    onSelect={onSelect}
    onToggleDock={toggleDock}
    onClose={() => setOverlay(false)}
  />
{/if}

<!-- Persistent activate/deactivate affordance. Always rendered (the island is
     mounted on every shell page in dev), so the overlay is discoverable without
     hunting for the sidebar item or knowing the Shift+D shortcut. Docks to the
     side OPPOSITE the panel so it never sits under an open right/left-docked
     panel. Hidden entirely when chromeHidden (visual-qa). -->
{#if !chromeHidden}
  <button
    type="button"
    class="docs-fab"
    class:open={$overlayOpen}
    class:dock-left={$overlayOpen && $dockSide === 'right'}
    aria-pressed={$overlayOpen}
    aria-label={$overlayOpen ? 'Close docs overlay' : 'Open docs overlay'}
    title="Toggle docs overlay (Shift+D)"
    onclick={onToggle}
  >
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="none">
      <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5" />
      <circle cx="8" cy="4.5" r="1" fill="currentColor" />
      <path d="M8 7v5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
    <span class="docs-fab-label">Docs</span>
    <kbd class="docs-fab-kbd">⇧D</kbd>
  </button>
{/if}

<style>
  /* Dev chrome — deliberately NOT theme tokens (this must read clearly over
     all 3 themes × both schemes at once). The one shared token is
     --z-docs-overlay, which sits above every other z-layer in the app by
     design (see src/styles/tokens.css's z-inventory comment). AnnotationPanel
     docks at that same base z — this layer sits one above it (not equal)
     so a badge whose target lands in the region the docked panel covers
     stays on top and clickable, rather than getting shadowed underneath the
     panel (found by testing: /planner's PlannerRail badge sat exactly where
     the right-docked panel covers, making it unreachable at the same z). */
  .docs-overlay-layer {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: calc(var(--z-docs-overlay) + 1);
  }

  /* Persistent toggle. Same "reads over all themes/schemes" reasoning as the
     rest of this layer, so hard-coded colors, not theme tokens. Sits one above
     the badge layer (= panel base + 2) so it stays clickable over an open
     panel. */
  .docs-fab {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: calc(var(--z-docs-overlay) + 2);
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 8px 12px;
    border: 1px solid rgba(94, 234, 212, 0.5);
    border-radius: 999px;
    background: #0f172a;
    color: #5eead4;
    font: 600 12px/1 ui-sans-serif, system-ui, sans-serif;
    letter-spacing: 0.02em;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
    cursor: pointer;
    /* pointer-events auto is the default for a real button, but the badge
       layer above sets pointer-events:none on its container — this button is a
       sibling of that layer, not a child, so it stays interactive. */
  }

  .docs-fab:hover {
    border-color: #5eead4;
    background: #1e293b;
  }

  .docs-fab:focus-visible {
    outline: 2px solid #5eead4;
    outline-offset: 2px;
  }

  /* Open state: filled, so the toggle reads as "active/click to close". */
  .docs-fab.open {
    background: #5eead4;
    color: #0f172a;
    border-color: #5eead4;
  }

  /* When the panel is open and docked right (its default), the panel covers the
     bottom-right corner — hop the toggle to the left so it never hides under it.
     A left-docked panel leaves the right corner free, so the default position is
     fine there. */
  .docs-fab.dock-left {
    right: auto;
    left: 16px;
  }

  .docs-fab-kbd {
    display: inline-flex;
    align-items: center;
    padding: 2px 5px;
    border-radius: 4px;
    background: rgba(94, 234, 212, 0.16);
    border: 1px solid rgba(94, 234, 212, 0.35);
    font-size: 10px;
    font-weight: 700;
  }

  .docs-fab.open .docs-fab-kbd {
    background: rgba(15, 23, 42, 0.16);
    border-color: rgba(15, 23, 42, 0.35);
  }

  .docs-outline {
    position: absolute;
    left: 0;
    top: 0;
    border: 2px solid #5eead4;
    border-radius: 4px;
    box-shadow: 0 0 0 3px rgba(94, 234, 212, 0.25);
    pointer-events: none;
    /* Deliberately NOT transitioning transform/width/height: measure()
       rewrites this rect every animation frame during a scroll, so easing
       toward each new position makes the outline visibly trail the element
       it is marking — the faster the scroll, the further behind it sits.
       Only opacity is safe to animate here. */
    animation: docs-outline-in 0.12s ease-out;
  }

  @keyframes docs-outline-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .docs-outline {
      animation: none;
    }
  }
</style>
