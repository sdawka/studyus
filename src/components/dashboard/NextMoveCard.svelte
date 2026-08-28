<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../../lib/apiClient';
  import { captureBehavioralEvent } from '../../lib/analytics/client';
  import { createNextMoveAnalytics } from '../../lib/analytics/daily';
  import type { AvailableMinutes, NextMove, NextMoveResponse } from '../../lib/schemas/nextMove';

  interface Props {
    initialResponse: NextMoveResponse;
  }

  let { initialResponse }: Props = $props();
  let response = $state(initialResponse);
  let selectedMinutes = $state<AvailableMinutes>(initialResponse.available_minutes);
  let activeIndex = $state(0);
  let loading = $state(false);
  let error = $state<string | null>(null);

  let moves = $derived([
    ...(response.recommendation ? [response.recommendation] : []),
    ...response.alternatives,
  ]);
  let move = $derived(moves[activeIndex] ?? null);
  const analytics = createNextMoveAnalytics(captureBehavioralEvent);

  onMount(() => {
    if (move) analytics.viewed(move, activeIndex + 1, selectedMinutes);
  });

  async function chooseMinutes(minutes: AvailableMinutes) {
    if (minutes === selectedMinutes || loading) return;
    loading = true;
    error = null;
    const result = await apiFetch<NextMoveResponse>(
      `/api/v1/profile/next-move?available_minutes=${minutes}`,
      {},
      "Couldn't refresh your next move.",
    );
    loading = false;
    if (!result.ok || !result.data) {
      error = result.ok ? "Couldn't refresh your next move." : result.error;
      return;
    }
    response = result.data;
    selectedMinutes = minutes;
    activeIndex = 0;
    const firstMove = result.data.recommendation ?? result.data.alternatives[0] ?? null;
    if (firstMove) analytics.viewed(firstMove, 1, minutes);
  }

  function showAnother() {
    if (!move || moves.length < 2) return;
    analytics.ignored(move, activeIndex + 1, selectedMinutes);
    const nextIndex = (activeIndex + 1) % moves.length;
    activeIndex = nextIndex;
    analytics.viewed(moves[nextIndex]!, nextIndex + 1, selectedMinutes);
  }

  function followMove() {
    if (!move) return;
    analytics.followed(move, activeIndex + 1, selectedMinutes);
  }

  function methodLabel(item: NextMove): string {
    return item.method === 'quick_quiz'
      ? `Start ${item.question_count}-question check`
      : 'Understand this concept';
  }
</script>

<section class="card next-move" aria-labelledby="next-move-title" aria-busy={loading}>
  <div class="card-head">
    <div>
      <p class="kicker">Open next</p>
      <h2 class="card-title" id="next-move-title">Your highest-value study move</h2>
    </div>
    <div class="time-options" aria-label="Available study time">
      {#each [15, 25, 50] as minutes}
        <button
          type="button"
          class:active={selectedMinutes === minutes}
          aria-pressed={selectedMinutes === minutes}
          disabled={loading}
          onclick={() => chooseMinutes(minutes as AvailableMinutes)}
        >{minutes} min</button>
      {/each}
    </div>
  </div>

  {#if error}
    <p class="error" role="status">{error}</p>
  {/if}

  {#if move}
    <div class="move" style={`--course-h:${move.course.color ?? 264}`}>
      <p class="course-line"><span class="course-dot"></span>{move.course.course_code} · {move.course.course_title}</p>
      <h3>{move.title}</h3>
      <p class="method-line">
        {move.method === 'quick_quiz' ? 'Retrieval practice' : 'Guided understanding'}
        <span>·</span> {move.planned_minutes} min
      </p>

      <details>
        <summary>Why this?</summary>
        <ul>
          {#each move.reasons as reason (reason.code)}
            <li>{reason.label}</li>
          {/each}
        </ul>
      </details>

      <div class="actions">
        <a class="btn btn-primary" href={move.action_href} onclick={followMove}>{methodLabel(move)} →</a>
        {#if moves.length > 1}
          <button type="button" class="btn btn-secondary" onclick={showAnother}>Show another</button>
        {/if}
        <span class="position num">{activeIndex + 1} of {moves.length}</span>
      </div>
    </div>
  {:else}
    <div class="empty-state">
      <h3>Nothing needs a push right now.</h3>
      <p>Your active concepts are mastered or waiting on prerequisites. You can still choose any course to explore.</p>
      <a href="/courses">Browse courses →</a>
    </div>
  {/if}
</section>

<style>
  .next-move {
    overflow: hidden;
    border-color: color-mix(in srgb, var(--accent) 24%, var(--border));
  }
  .card-head {
    align-items: flex-start;
    gap: var(--space-3);
  }
  .card-head .kicker { margin: 0 0 4px; }
  .time-options {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--hover);
  }
  .time-options button {
    min-height: 30px;
    padding: 0 10px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 12px;
    font-weight: 650;
    cursor: pointer;
  }
  .time-options button.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-card);
  }
  .time-options button:disabled { cursor: wait; opacity: 0.65; }
  .move { margin-top: var(--space-4); }
  .course-line {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0;
    color: var(--muted);
    font-size: 12px;
    font-weight: 680;
    letter-spacing: 0.035em;
    text-transform: uppercase;
  }
  .course-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: oklch(64% 0.16 var(--course-h));
  }
  h3 { margin: 8px 0 0; font-size: clamp(20px, 3vw, 27px); line-height: 1.15; letter-spacing: -0.02em; }
  .method-line { margin: 8px 0 0; color: var(--muted); font-size: 13px; }
  .method-line span { padding: 0 3px; }
  details { margin-top: var(--space-4); border-top: 1px solid var(--hairline); padding-top: var(--space-3); }
  summary { cursor: pointer; color: var(--accent-ink, var(--accent)); font-size: 12.5px; font-weight: 650; }
  ul { display: grid; gap: 6px; margin: 10px 0 0; padding-left: 20px; color: var(--muted); font-size: 13px; }
  .actions { display: flex; align-items: center; gap: 8px; margin-top: var(--space-4); flex-wrap: wrap; }
  .actions .btn { text-decoration: none; }
  .position { margin-left: auto; color: var(--muted); font-size: 11.5px; }
  .error { margin: 10px 0 0; color: var(--danger); font-size: 13px; }
  .empty-state { margin-top: var(--space-4); }
  .empty-state h3 { font-size: 18px; }
  .empty-state p { color: var(--muted); font-size: 13.5px; }
  .empty-state a { color: var(--accent); font-size: 13px; font-weight: 600; }

  @media (max-width: 560px) {
    .card-head { flex-direction: column; }
    .time-options { width: 100%; box-sizing: border-box; }
    .time-options button { flex: 1; min-height: 40px; }
    .actions { align-items: stretch; flex-direction: column; }
    .actions .btn { text-align: center; }
    .position { align-self: center; margin-left: 0; }
  }
</style>
