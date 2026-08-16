<script lang="ts">
  // Rail card: the nearest dated official assessments with their weight —
  // "what's coming and how much it counts" at a glance. Derived from the
  // assessments list the parent island already fetches (no extra request);
  // replaces the old DeadlinesCard, whose unfiltered 30-day calendar feed
  // mixed scheduled sessions and task rows in with actual deadlines.
  import { daysUntil, deadlineUrgency, formatShortDate } from '../../lib/plannerDates';

  interface UpNextAssessment {
    id: string;
    title: string;
    kind: 'official' | 'practice';
    due_date: string | null;
    weight_pct: number | null;
    grade_received: number | null;
  }

  interface Props {
    assessments: UpNextAssessment[];
  }
  let { assessments }: Props = $props();

  const SHOW_CAP = 4;

  let upcoming = $derived.by(() => {
    return assessments
      .filter((a) => a.kind === 'official' && a.due_date !== null && daysUntil(a.due_date) >= 0)
      .sort((a, b) => a.due_date!.localeCompare(b.due_date!))
      .slice(0, SHOW_CAP);
  });
</script>

<section class="card">
  <div class="card-head">
    <h2 class="card-title">Coming up</h2>
  </div>

  {#if upcoming.length === 0}
    <p class="empty">No dated assessments ahead.</p>
  {:else}
    <ul class="up-list">
      {#each upcoming as a (a.id)}
        {@const days = daysUntil(a.due_date!)}
        {@const urgency = deadlineUrgency(days)}
        <li class="up-row">
          <div class="up-top">
            <span class="up-title">{a.title}</span>
            {#if a.weight_pct !== null}
              <span class="weight num" title="Weight toward the course grade">{a.weight_pct}%</span>
            {/if}
          </div>
          <div class="up-meta">
            <span class="pill {urgency.cls}">{urgency.label}</span>
            <span class="up-date num">{formatShortDate(a.due_date!)}</span>
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="card-footer">
    <a class="link-btn" href="#assessments">All assessments →</a>
  </div>
</section>

<style>
  .up-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .up-row {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--hairline);
  }
  .up-row:first-child { padding-top: 0; }
  .up-row:last-child { border-bottom: none; }

  /* Title line carries only the title + weight figure; the due pill/date
     live on their own meta line so they can never crush the title. */
  .up-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    min-width: 0;
  }
  .up-title {
    font-size: 13.5px;
    color: var(--text);
    min-width: 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .weight {
    flex-shrink: 0;
    font-size: 13px;
    font-weight: 620;
    color: var(--text);
  }

  .up-meta {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .up-date {
    color: var(--muted);
    font-size: 12px;
  }

  .card-footer {
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--hairline);
  }
  .link-btn { color: var(--accent); font-size: 12.5px; font-weight: 550; text-decoration: none; }
  .link-btn:hover { text-decoration: underline; }
</style>
