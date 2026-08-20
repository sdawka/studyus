<script lang="ts">
  // Stub panel — real CRUD + adherence dots land with Track C (Rituals).
  // Props contract frozen here for that track to fill in:
  //
  //   rituals: RitualResponse[] | null  (src/lib/schemas/rituals.ts — each
  //     row already carries its `adherence` block, see ritualResponseSchema)
  //
  // Null until profile.astro wires the real service
  // (listRitualsWithAdherence) — this stub renders a placeholder regardless
  // of prop value.
  import type { RitualResponse } from '../../lib/schemas/rituals';

  interface Props {
    rituals: RitualResponse[] | null;
  }
  const { rituals }: Props = $props();
</script>

<section class="card">
  <h2>Rituals <span class="cs-tag">coming in this wave</span></h2>
  <p class="stepdesc">
    Recurring study practices and in-session structure — set up once, tracked as done/skipped/upcoming,
    never as a streak to protect.
  </p>
</section>

<style>
  section.card { margin-bottom: 1.75rem; }
  .card h2 { font-size: 1.05rem; margin: 0 0 1rem; }
  .cs-tag { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); font-style: italic; font-weight: 400; }
  .stepdesc { color: var(--muted); font-size: 0.88rem; max-width: 620px; margin: 0; }
</style>
