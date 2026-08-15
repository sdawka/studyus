<script lang="ts">
  import { formatShortDate } from '../../lib/plannerDates';

  interface CalendarItem { id: string; type: string; title: string; date: string }

  interface Props {
    deadlines: CalendarItem[];
  }
  let { deadlines }: Props = $props();
</script>

<section class="card">
  <div class="card-head">
    <h2 class="card-title">Upcoming deadlines</h2>
  </div>
  {#if deadlines.length === 0}
    <p class="empty">Nothing due in the next 30 days.</p>
  {:else}
    <ul class="deadline-list">
      {#each deadlines as d}
        <li><span class="deadline-date num">{formatShortDate(d.date)}</span><span class="deadline-title">{d.title}</span></li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .deadline-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .deadline-list li {
    display: flex;
    gap: var(--space-3);
    font-size: 13.5px;
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--hairline);
  }
  .deadline-list li:last-child { border-bottom: none; }
  .deadline-date { color: var(--accent); font-weight: 600; min-width: 4.5rem; flex-shrink: 0; }
</style>
