// Svelte action for CSS-Grid masonry: the grid container sets a fine
// `grid-auto-rows` (4px) and non-dense auto-flow (default `row`, never
// `dense` — dense repacks items out of DOM order, which would desync tab
// order from visual order), and each item claims however many of those
// tracks its own rendered height needs via `grid-row-end: span N`.
//
// Height is measured with a ResizeObserver (not a one-time read) so any
// later reflow of the card's own content — an inline-add form opening, a
// subtask list expanding, a description wrapping to another line — gets
// picked up and reflows the grid automatically.
//
// The "gap" folded into the span math is the item's own computed
// margin-bottom, not the grid's `gap` property: the grid keeps row-gap at
// 0 so a spanned item's grid-area height is just `span * rowHeight`, and
// the visual breathing room below it comes from margin-bottom instead —
// that's what lets `span = ceil((height + gap) / rowHeight)` work out to
// the exact right value (see TasksView.svelte's `.card-grid` rule, which
// sets both the column-gap and every item's margin-bottom from the same
// `--masonry-gap` custom property).
//
// Skipped entirely once a browser natively supports CSS masonry (the
// `grid-lanes` proposal) — TasksView.svelte's `@supports (display:
// grid-lanes)` block switches the container over and neutralizes
// `grid-row` on every item, so there's nothing left for this action to do.
const ROW_HEIGHT = 4;

export function masonryItem(node: HTMLElement): { destroy?: () => void } {
  if (typeof CSS !== 'undefined' && CSS.supports('display', 'grid-lanes')) return {};

  function measure() {
    const gap = parseFloat(getComputedStyle(node).marginBottom) || 0;
    const height = node.getBoundingClientRect().height;
    const span = Math.max(1, Math.ceil((height + gap) / ROW_HEIGHT));
    node.style.gridRowEnd = `span ${span}`;
  }

  const ro = new ResizeObserver(measure);
  ro.observe(node);
  measure();

  return {
    destroy() {
      ro.disconnect();
    },
  };
}
