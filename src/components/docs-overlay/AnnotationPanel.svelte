<script lang="ts">
  // TEMPORARY — docs annotation overlay. See docs/product/annotations.md.
  // The panel half of the overlay: route summary + a numbered component list
  // matching the badges DocsOverlay.svelte draws over the page. Desktop is a
  // ~340px floating card that can be dragged by its header (position persisted,
  // see below); ≤767px it renders inside the shared Sheet primitive instead
  // (isMobile from viewport.ts), same as every other popover-to-sheet
  // conversion in this app.
  //
  // Note on Escape: Sheet.svelte owns Escape-to-close internally and always
  // calls `onClose` unconditionally. `onClose` here is wired to "close the
  // whole overlay" (not two-stage) — mobile has no separate docked card to
  // back out of first, so a single dismiss (scrim tap / × / Escape, all
  // funneled through Sheet's one callback) just closes everything. The
  // desktop two-stage Escape (card first, then overlay) lives in
  // DocsOverlay.svelte's own keydown handler, gated to skip when isMobile.
  import { onMount } from 'svelte';
  import Sheet from '../shell/Sheet.svelte';
  import { isMobile } from '../../lib/stores/viewport';
  import type { Annotation, RouteAnnotation } from '../../lib/docs-overlay/types';
  import type { DockSide } from '../../lib/docs-overlay/store';

  // Kept local rather than imported from DocsOverlay.svelte — a .svelte
  // file's instance-script exports aren't real ESM named exports (only
  // `<script module>` ones are), so this tiny shape is just duplicated here.
  interface Numbered {
    annotation: Annotation;
    number: number;
  }

  interface Props {
    route: RouteAnnotation | null;
    numbered: Numbered[];
    selected: string | null;
    unresolved: string[];
    offscreen: Set<string>;
    dockSide: DockSide;
    onSelect: (name: string | null) => void;
    onToggleDock: () => void;
    onClose: () => void;
  }

  // onToggleDock stays in Props (DocsOverlay still passes it) but is unused now
  // that the panel free-floats + drags instead of snapping to an edge.
  let { route, numbered, selected, unresolved, offscreen, dockSide, onSelect, onClose }: Props = $props();

  function toggleRow(name: string) {
    onSelect(selected === name ? null : name);
  }

  function isUnresolved(name: string, list: string[]): boolean {
    return list.includes(name);
  }

  // --- Floating + draggable behavior (desktop only) ---
  // The panel floats as a card and can be dragged by its header. Position is a
  // viewport-pixel {x,y} of the card's top-left, persisted so it survives the
  // full-page reload every MPA navigation triggers. `pos === null` means "use
  // the default anchored spot" (top, on the dockSide edge). Kept entirely local
  // to this component — no store/DocsOverlay changes — so the whole layer stays
  // deletable in one pass.
  const POS_KEY = 'sb:docs-overlay-pos';
  const MARGIN = 8;

  let panelEl = $state<HTMLElement | null>(null);
  let pos = $state<{ x: number; y: number } | null>(null);
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;

  function clamp(v: number, min: number, max: number): number {
    return Math.min(Math.max(v, min), max);
  }

  // Keep the card on-screen: at least the header stays reachable so it can never
  // be stranded off the viewport where it couldn't be grabbed again.
  function clampPos(x: number, y: number): { x: number; y: number } {
    const w = panelEl?.offsetWidth ?? 340;
    const h = panelEl?.offsetHeight ?? 200;
    return {
      x: clamp(x, MARGIN, Math.max(MARGIN, window.innerWidth - w - MARGIN)),
      y: clamp(y, MARGIN, Math.max(MARGIN, window.innerHeight - Math.min(h, 120) - MARGIN)),
    };
  }

  function onHeadPointerDown(e: PointerEvent) {
    // Let the action buttons (⇄ reset / × close) work normally.
    if ((e.target as HTMLElement).closest('.icon-btn')) return;
    if (!panelEl) return;
    const rect = panelEl.getBoundingClientRect();
    dragging = true;
    originX = rect.left;
    originY = rect.top;
    startX = e.clientX;
    startY = e.clientY;
    // Switch from CSS-anchored to explicit px at the current spot so the first
    // move doesn't jump.
    pos = { x: rect.left, y: rect.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onHeadPointerMove(e: PointerEvent) {
    if (!dragging) return;
    pos = clampPos(originX + (e.clientX - startX), originY + (e.clientY - startY));
  }

  function onHeadPointerUp(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    try {
      if (pos) localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch {
      /* storage unavailable — position just won't persist across reloads */
    }
  }

  // Reset to the default anchored spot (also the escape hatch if the card ever
  // ends up somewhere awkward).
  function resetPosition() {
    pos = null;
    try {
      localStorage.removeItem(POS_KEY);
    } catch {
      /* non-fatal */
    }
  }

  onMount(() => {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
          pos = clampPos(parsed.x, parsed.y);
        }
      }
    } catch {
      /* ignore malformed/absent stored position */
    }
  });
</script>

{#snippet panelBody()}
  {#if unresolved.length > 0}
    <p class="warning-chip" role="status">
      ⚠ {unresolved.length} anchor{unresolved.length === 1 ? '' : 's'} unresolved: {unresolved.join(', ')}
    </p>
  {/if}

  <section class="route-section">
    <p class="section-label">Route</p>
    {#if route}
      <p class="route-purpose">{route.purpose}</p>
      {#if route.jobs.length}
        <p class="detail-label">Jobs</p>
        <ul class="text-list">
          {#each route.jobs as job}<li>{job}</li>{/each}
        </ul>
      {/if}
      {#if route.flows.length}
        <p class="detail-label">Flows</p>
        <ul class="text-list">
          {#each route.flows as flow}<li>{flow}</li>{/each}
        </ul>
      {/if}
      {#if route.docs.length}
        <p class="detail-label">Docs</p>
        <ul class="docs-list">
          {#each route.docs as doc}<li>{doc}</li>{/each}
        </ul>
      {/if}
    {:else}
      <p class="route-note">This route isn't annotated yet — showing shell components only.</p>
    {/if}
  </section>

  <section class="component-section">
    <p class="section-label">Components</p>
    <ul class="component-list">
      {#each numbered as { annotation, number } (annotation.name)}
        {@const unresolvedRow = isUnresolved(annotation.name, unresolved)}
        {@const offscreenRow = offscreen.has(annotation.name)}
        {@const isSelected = selected === annotation.name}
        <li class="component-row" class:selected={isSelected}>
          <button
            type="button"
            class="row-btn"
            class:unresolved={unresolvedRow}
            aria-expanded={isSelected}
            onclick={() => toggleRow(annotation.name)}
          >
            <span class="row-number">{number}</span>
            <span class="row-name">{annotation.name}</span>
            {#if unresolvedRow}
              <span class="row-tag warn">not found</span>
            {:else if offscreenRow}
              <span class="row-tag">off-screen</span>
            {/if}
          </button>
          {#if isSelected}
            <div class="row-detail">
              <p class="detail-purpose">{annotation.purpose}</p>
              {#if annotation.affordances.length}
                <p class="detail-label">Affordances</p>
                <ul class="text-list">
                  {#each annotation.affordances as a}<li>{a}</li>{/each}
                </ul>
              {/if}
              {#if annotation.actions.length}
                <p class="detail-label">Actions</p>
                <ul class="text-list">
                  {#each annotation.actions as a}<li>{a}</li>{/each}
                </ul>
              {/if}
              {#if annotation.feedback.length}
                <p class="detail-label">Feedback</p>
                <ul class="text-list">
                  {#each annotation.feedback as a}<li>{a}</li>{/each}
                </ul>
              {/if}
              {#if annotation.docs.length}
                <p class="detail-label">Docs</p>
                <ul class="docs-list">
                  {#each annotation.docs as d}<li>{d}</li>{/each}
                </ul>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/snippet}

{#if $isMobile}
  <Sheet open={true} {onClose} title={route?.title ?? 'Docs overlay'}>
    {@render panelBody()}
  </Sheet>
{:else}
  <aside
    bind:this={panelEl}
    class="docs-panel"
    class:dock-left={dockSide === 'left'}
    class:floating={pos !== null}
    class:dragging
    style={pos ? `left:${pos.x}px; top:${pos.y}px; right:auto;` : ''}
    aria-label="Docs annotation panel"
  >
    <!-- Drag handle: the header. onpointerdown starts the drag; the buttons
         inside opt out via the .icon-btn guard in onHeadPointerDown. -->
    <header
      class="panel-head"
      onpointerdown={onHeadPointerDown}
      onpointermove={onHeadPointerMove}
      onpointerup={onHeadPointerUp}
    >
      <div class="panel-title">
        <span class="kicker">Docs overlay · drag to move</span>
        <h2>{route?.title ?? 'Shell only'}</h2>
      </div>
      <div class="panel-actions">
        <button
          type="button"
          class="icon-btn"
          onclick={resetPosition}
          aria-label="Reset panel position"
          title="Reset position"
        >⌖</button>
        <button type="button" class="icon-btn" onclick={onClose} aria-label="Close docs overlay">×</button>
      </div>
    </header>
    <div class="panel-body">
      {@render panelBody()}
    </div>
  </aside>
{/if}

<style>
  /* Dev chrome — fixed palette, not theme tokens (see DocsOverlay.svelte). */
  /* Floating card, not an edge dock. Default anchored top-right with a margin;
     a dragged position (inline left/top from the .floating state) overrides
     these. Bordered all round + rounded + drop shadow so it reads as floating
     over the page, while staying non-modal (no backdrop, app stays usable). */
  .docs-panel {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: var(--z-docs-overlay);
    width: 340px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    background: #1b2430;
    color: #e6edf3;
    border: 1px solid #2f3b4c;
    border-radius: 12px;
    box-shadow: 0 10px 34px rgba(0, 0, 0, 0.45);
    overflow: hidden; /* clip children to the rounded corners */
    font: 400 12.5px/1.5 ui-sans-serif, system-ui, sans-serif;
  }

  /* Default side hint when the card hasn't been dragged yet. */
  .docs-panel.dock-left {
    right: auto;
    left: 16px;
  }

  /* Once dragged, inline left/top win; kill the anchoring so nothing fights. */
  .docs-panel.floating {
    right: auto;
  }

  .docs-panel.dragging {
    user-select: none;
    cursor: grabbing;
  }

  .panel-head {
    flex-shrink: 0;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    padding: 14px 14px 12px;
    border-bottom: 1px solid #2f3b4c;
    cursor: grab;
    touch-action: none; /* let pointer drag own the gesture, not the browser */
  }
  .docs-panel.dragging .panel-head {
    cursor: grabbing;
  }

  .panel-title {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .kicker {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #5eead4;
  }

  .panel-title h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 650;
    color: #e6edf3;
  }

  .panel-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  .icon-btn {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    color: #8ea1b2;
    font-size: 14px;
    line-height: 1;
  }
  .icon-btn:hover {
    background: #23303f;
    color: #e6edf3;
  }
  .icon-btn:focus-visible {
    outline: 2px solid #5eead4;
    outline-offset: 1px;
  }

  .panel-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 12px 14px 20px;
  }

  .warning-chip {
    margin: 0 0 12px;
    padding: 8px 10px;
    border-radius: 6px;
    background: rgba(251, 191, 36, 0.14);
    border: 1px solid rgba(251, 191, 36, 0.4);
    color: #fbbf24;
    font-size: 11.5px;
    line-height: 1.4;
  }

  .section-label {
    margin: 0 0 6px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #8ea1b2;
  }

  .detail-label {
    margin: 10px 0 4px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #8ea1b2;
  }

  .route-section {
    margin-bottom: 16px;
    padding-bottom: 14px;
    border-bottom: 1px solid #2f3b4c;
  }

  .route-purpose {
    margin: 0;
    color: #e6edf3;
    font-size: 13px;
  }

  .route-note {
    margin: 0;
    color: #8ea1b2;
    font-style: italic;
  }

  .text-list,
  .docs-list {
    margin: 0;
    padding-left: 16px;
    color: #c3d0dc;
  }

  .text-list li,
  .docs-list li {
    margin-bottom: 3px;
  }

  .docs-list {
    font: 400 11px/1.4 ui-monospace, 'SF Mono', Menlo, monospace;
    color: #8ea1b2;
  }

  .component-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .component-row.selected {
    background: rgba(94, 234, 212, 0.06);
    border-radius: 6px;
  }

  .row-btn {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 6px;
    border-radius: 6px;
    text-align: left;
    color: #e6edf3;
  }
  .row-btn:hover {
    background: #23303f;
  }
  .row-btn:focus-visible {
    outline: 2px solid #5eead4;
    outline-offset: -2px;
  }
  .row-btn.unresolved {
    color: #7c8a99;
  }

  .row-number {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1px solid #3a4a5c;
    font: 700 10px/1 ui-monospace, 'SF Mono', Menlo, monospace;
    color: #8ea1b2;
  }
  .row-btn:not(.unresolved) .row-number {
    border-color: #5eead4;
    color: #5eead4;
  }

  .row-name {
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-tag {
    flex-shrink: 0;
    padding: 2px 6px;
    border-radius: 999px;
    font-size: 9.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    background: #2f3b4c;
    color: #8ea1b2;
  }
  .row-tag.warn {
    background: rgba(251, 191, 36, 0.16);
    color: #fbbf24;
  }

  .row-detail {
    padding: 2px 8px 12px 32px;
  }

  .detail-purpose {
    margin: 0;
    color: #e6edf3;
    font-size: 12.5px;
  }

  @media (max-width: 767px) {
    .docs-panel {
      display: none; /* AnnotationPanel renders the Sheet variant instead */
    }
  }
</style>
