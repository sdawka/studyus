<script lang="ts">
  // TEMPORARY — docs annotation overlay. See docs/product/annotations.md.
  // A single numbered marker over an annotated element. DocsOverlay.svelte
  // renders one per resolved (and currently on-screen) target; an `all:
  // true` annotation with several matches gets several of these sharing the
  // same number. Positioned by the parent via translate3d for cheap
  // repositioning during scroll.
  interface Props {
    number: number;
    name: string;
    active: boolean;
    x: number;
    y: number;
    onSelect: (name: string) => void;
  }

  let { number, name, active, x, y, onSelect }: Props = $props();
</script>

<button
  type="button"
  class="docs-badge"
  class:active
  style={`transform: translate3d(${x}px, ${y}px, 0)`}
  aria-label={name}
  aria-pressed={active}
  onclick={() => onSelect(name)}
>
  {number}
</button>

<style>
  /* Dev chrome — fixed palette, not theme tokens (see DocsOverlay.svelte). */
  .docs-badge {
    position: absolute;
    left: 0;
    top: 0;
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: #0f172a;
    border: 1.5px solid #5eead4;
    color: #5eead4;
    font: 700 11px/1 ui-monospace, 'SF Mono', Menlo, monospace;
    pointer-events: auto;
    cursor: pointer;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
    transition: background 0.1s ease, color 0.1s ease;
  }

  .docs-badge:hover {
    background: #16202e;
  }

  .docs-badge:focus-visible {
    outline: 2px solid #5eead4;
    outline-offset: 2px;
  }

  .docs-badge.active {
    background: #5eead4;
    color: #0f172a;
  }

  @media (prefers-reduced-motion: reduce) {
    .docs-badge {
      transition: none;
    }
  }
</style>
