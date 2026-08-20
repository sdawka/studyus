<script lang="ts">
  // Stub panel — real competency list + meta-skills strip land with Track B
  // (Capabilities). Props contract frozen here for that track to fill in:
  //
  //   capabilities: CapabilityResponse[] | null  (src/lib/schemas/capabilities.ts)
  //   metaSkills:   MetaSkill[] | null            (src/lib/schemas/capabilities.ts)
  //
  // Both null until profile.astro wires the real services
  // (listCapabilities / getMetaSkills) — this stub renders a placeholder
  // regardless of prop values.
  import type { CapabilityResponse, MetaSkill } from '../../lib/schemas/capabilities';

  interface Props {
    capabilities: CapabilityResponse[] | null;
    metaSkills: MetaSkill[] | null;
  }
  const { capabilities, metaSkills }: Props = $props();
</script>

<section class="card">
  <h2>Capabilities <span class="cs-tag">coming in this wave</span></h2>
  <p class="stepdesc">
    Competencies that aggregate concepts across courses, and the metacognitive skills behind how you
    study — retrieval practice, self-explanation, error analysis.
  </p>
</section>

<style>
  section.card { margin-bottom: 1.75rem; }
  .card h2 { font-size: 1.05rem; margin: 0 0 1rem; }
  .cs-tag { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); font-style: italic; font-weight: 400; }
  .stepdesc { color: var(--muted); font-size: 0.88rem; max-width: 620px; margin: 0; }
</style>
