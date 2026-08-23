<script lang="ts">
  // Competency list (higher-order aggregates of KCs across courses, derived
  // mastery/coverage/status) + a meta-skills strip (retrieval practice,
  // self-explanation, error analysis — frequency/trend, deliberately never
  // a 0-100 score; KLI honesty + anti-gamification, vision.md).
  //
  // Props contract (frozen for profile.astro to wire):
  //   capabilities: CapabilityResponse[] | null  (src/lib/schemas/capabilities.ts)
  //   metaSkills:   MetaSkill[] | null            (src/lib/schemas/capabilities.ts)
  //
  // Both null renders the same "coming in this wave" placeholder as before
  // (profile.astro hasn't wired listCapabilities/getMetaSkills yet); an
  // empty array (real data, just nothing seeded) renders an empty-state
  // message instead of the placeholder.
  import type { CapabilityResponse, MetaSkill, MetaSkillKey } from '../../lib/schemas/capabilities';
  import { formatRelative } from '../../lib/plannerDates';

  interface Props {
    capabilities: CapabilityResponse[] | null;
    metaSkills: MetaSkill[] | null;
  }
  const { capabilities, metaSkills }: Props = $props();

  const STATUS_COLORS: Record<string, string> = {
    'not-started': 'var(--faint)',
    learning: 'var(--warn)',
    review: 'var(--warn)',
    mastered: 'var(--good)',
  };
  const STATUS_LABELS: Record<string, string> = {
    'not-started': 'Not started',
    learning: 'Learning',
    review: 'Review',
    mastered: 'Mastered',
  };

  const META_SKILL_LABELS: Record<MetaSkillKey, string> = {
    retrieval_practice: 'Retrieval practice',
    self_explanation: 'Self-explanation',
    error_analysis: 'Error analysis',
  };
  const TREND_ARROWS: Record<MetaSkill['trend'], string> = { up: '↑', flat: '→', down: '↓' };

  function coverageLine(cap: CapabilityResponse): string {
    const started = Math.round(cap.coverage * cap.members.length);
    return `${started} of ${cap.members.length} concept${cap.members.length === 1 ? '' : 's'} started`;
  }

  // Reframe, not coerce (anti-gamification): when every row reads "not
  // started", a bare list of zeroes looks like a scoreboard of failure.
  // One quiet line points up at the learning frontier instead of adding
  // badges/urgency to the rows themselves.
  const allNotStarted = $derived(
    capabilities !== null && capabilities.length > 0 && capabilities.every((c) => c.status === 'not-started'),
  );
</script>

<section class="card">
  <h2>Capabilities</h2>
  <p class="stepdesc">
    Competencies that aggregate concepts across courses, and the metacognitive skills behind how you
    study — retrieval practice, self-explanation, error analysis.
  </p>

  {#if allNotStarted}
    <p class="reframe-line">Nothing logged against these yet — the learning frontier above shows where to start.</p>
  {/if}

  {#if capabilities === null}
    <p class="placeholder">Coming in this wave.</p>
  {:else if capabilities.length === 0}
    <p class="placeholder">No competencies yet.</p>
  {:else}
    <ul class="competency-list">
      {#each capabilities as cap (cap.id)}
        <li class="competency-row">
          <div class="competency-head">
            <span class="competency-name">{cap.name}</span>
            <span class="status-chip" style={`color:${STATUS_COLORS[cap.status]}; border-color:${STATUS_COLORS[cap.status]}`}>
              {STATUS_LABELS[cap.status] ?? cap.status}
            </span>
          </div>
          <div class="mastery-bar">
            <div class="track">
              <div class="fill" style={`width:${cap.mastery}%; background:${STATUS_COLORS[cap.status]};`}></div>
            </div>
            <span class="pct">{cap.mastery}%</span>
          </div>
          <p class="coverage-line">{coverageLine(cap)}</p>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="meta-skills">
    <h3>Study skills</h3>
    {#if metaSkills === null}
      <p class="placeholder">Coming in this wave.</p>
    {:else}
      <ul class="meta-skill-list">
        {#each metaSkills as skill (skill.key)}
          <li class="meta-skill-row">
            <span class="meta-skill-label">{META_SKILL_LABELS[skill.key]}</span>
            <span class="meta-skill-count">{skill.count_28d} in 28d</span>
            <span class="meta-skill-trend trend-{skill.trend}" title={`trend: ${skill.trend}`}>{TREND_ARROWS[skill.trend]}</span>
            <span class="meta-skill-last">{skill.last_at ? formatRelative(skill.last_at) : 'never'}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

<style>
  section.card { margin-bottom: 1.75rem; }
  .card h2 { font-size: 1.05rem; margin: 0 0 1rem; }
  .stepdesc { color: var(--muted); font-size: 0.88rem; max-width: 620px; margin: 0 0 1rem; }
  .placeholder { color: var(--muted); font-size: 0.88rem; margin: 0; }
  .reframe-line { color: var(--muted); font-size: 0.86rem; font-style: italic; margin: -0.4rem 0 1rem; }

  .competency-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.9rem; }
  .competency-row { min-width: 0; }
  .competency-head { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.3rem; }
  .competency-name { font-size: 0.92rem; font-weight: 500; min-width: 0; }
  .status-chip {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    border: 1px solid;
    border-radius: var(--radius-sm);
    padding: 0.1rem 0.4rem;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .mastery-bar { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
  .track { flex: 1; min-width: 0; height: 6px; border-radius: 999px; background: var(--hairline); overflow: hidden; }
  .fill { height: 100%; border-radius: 999px; transition: width var(--motion-base) var(--ease); }
  .pct { font-size: 0.75rem; color: var(--muted); min-width: 2.5em; text-align: right; flex-shrink: 0; }

  .coverage-line { margin: 0.3rem 0 0; font-size: 0.78rem; color: var(--muted); }

  .meta-skills { margin-top: 1.5rem; }
  .meta-skills h3 { font-size: 0.85rem; margin: 0 0 0.6rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }
  .meta-skill-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  .meta-skill-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto auto;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.85rem;
  }
  .meta-skill-label { min-width: 0; }
  .meta-skill-count { color: var(--muted); white-space: nowrap; }
  .meta-skill-trend { font-weight: 600; width: 1.2em; text-align: center; }
  .trend-up { color: var(--good); }
  .trend-down { color: var(--warn); }
  .trend-flat { color: var(--muted); }
  .meta-skill-last { color: var(--muted); font-size: 0.78rem; white-space: nowrap; }

  @media (max-width: 480px) {
    .meta-skill-row { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "label trend" "count last"; }
    .meta-skill-label { grid-area: label; }
    .meta-skill-trend { grid-area: trend; }
    .meta-skill-count { grid-area: count; }
    .meta-skill-last { grid-area: last; text-align: right; }
  }
</style>
