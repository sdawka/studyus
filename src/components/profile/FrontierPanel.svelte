<script lang="ts">
  // Stub panel — replaces the old "Global knowledge map — coming later"
  // sketch. Real frontier chips + FrontierGraph land with Track A (ZPD).
  // Props contract frozen here for that track to fill in:
  //
  //   frontier: FrontierResponse | null  (src/lib/schemas/zpd.ts)
  //
  // Null until profile.astro wires the real service (getGlobalFrontier) —
  // this stub renders a placeholder regardless of prop value.
  import type { FrontierResponse } from '../../lib/schemas/zpd';

  interface Props {
    frontier: FrontierResponse | null;
  }
  const { frontier }: Props = $props();
</script>

<section class="card">
  <h2>Learning frontier <span class="cs-tag">coming in this wave</span></h2>
  <p class="stepdesc">
    The concepts you're ready for next — unmastered, with every prerequisite already in reach.
  </p>
</section>

<style>
  section.card { margin-bottom: 1.75rem; }
  .card h2 { font-size: 1.05rem; margin: 0 0 1rem; }
  .cs-tag { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); font-style: italic; font-weight: 400; }
  .stepdesc { color: var(--muted); font-size: 0.88rem; max-width: 620px; margin: 0; }
</style>
