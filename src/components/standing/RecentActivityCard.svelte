<script lang="ts">
  interface EventRow {
    id: string;
    type: string;
    ts: string;
    source: 'manual' | 'session' | 'tutor' | 'seed';
    kc_id: string | null;
  }

  const EVENT_TYPES = [
    'video_watched', 'reading_done', 'taught_someone',
    'quiz_taken', 'assignment_graded', 'exam_graded', 'self_assessment',
    'practice_done', 'retrieval_practice', 'tutor_session',
  ];

  interface Props {
    events: EventRow[];
  }
  let { events: initialEvents }: Props = $props();

  let events = $state(initialEvents);
  const VISIBLE_LIMIT = 6;
  let showAll = $state(false);
  let eventTypeDrafts = $state<Record<string, string>>(Object.fromEntries(events.map((e) => [e.id, e.type])));
  let eventSavingId = $state<string | null>(null);
  let eventFeedback = $state<Record<string, string>>({});

  const visibleEvents = $derived(showAll ? events : events.slice(0, VISIBLE_LIMIT));

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  async function saveEventType(eventId: string) {
    const nextType = eventTypeDrafts[eventId];
    eventSavingId = eventId;
    eventFeedback = { ...eventFeedback, [eventId]: '' };
    try {
      const res = await fetch(`/api/v1/events/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: nextType }),
      });
      const json = await res.json();
      if (!res.ok) {
        eventFeedback = { ...eventFeedback, [eventId]: json?.error?.message ?? 'Update failed' };
        return;
      }
      events = events.map((e) => (e.id === eventId ? { ...e, type: json.data.type } : e));
      eventFeedback = { ...eventFeedback, [eventId]: 'Updated.' };
    } catch {
      eventFeedback = { ...eventFeedback, [eventId]: 'Network error.' };
    } finally {
      eventSavingId = null;
    }
  }

  async function deleteEventRow(eventId: string) {
    if (!confirm('Delete this event?')) return;
    eventSavingId = eventId;
    try {
      const res = await fetch(`/api/v1/events/${eventId}`, { method: 'DELETE' });
      if (res.ok) {
        events = events.filter((e) => e.id !== eventId);
      }
    } finally {
      eventSavingId = null;
    }
  }
</script>

<section class="card">
  <div class="card-head">
    <h2 class="card-title">Recent activity</h2>
  </div>
  {#if events.length === 0}
    <p class="empty">No events logged for this course yet.</p>
  {:else}
    <ul class="event-list">
      {#each visibleEvents as e (e.id)}
        <li>
          <div class="event-row">
            <span class="event-date num">{formatDate(e.ts)}</span>
            {#if e.source === 'manual'}
              <select bind:value={eventTypeDrafts[e.id]} disabled={eventSavingId === e.id}>
                {#each EVENT_TYPES as t}
                  <option value={t}>{t.replace(/_/g, ' ')}</option>
                {/each}
              </select>
              <button type="button" class="link-btn" onclick={() => saveEventType(e.id)} disabled={eventSavingId === e.id}>Update</button>
            {:else}
              <span class="event-type">{e.type.replace(/_/g, ' ')}</span>
              <span class="pill pill-idle">{e.source}</span>
            {/if}
            <button type="button" class="row-delete" aria-label="Delete this event" onclick={() => deleteEventRow(e.id)} disabled={eventSavingId === e.id}>×</button>
          </div>
          {#if eventFeedback[e.id]}<p class="feedback">{eventFeedback[e.id]}</p>{/if}
        </li>
      {/each}
    </ul>
    {#if events.length > VISIBLE_LIMIT}
      <button type="button" class="show-all-btn" onclick={() => (showAll = !showAll)}>
        {showAll ? 'Show fewer' : `Show all (${events.length})`}
      </button>
    {/if}
  {/if}
</section>

<style>
  .event-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .event-list li { padding: var(--space-2) 0; border-bottom: 1px solid var(--hairline); }
  .event-list li:last-child { border-bottom: none; }
  .event-row { display: flex; align-items: center; gap: 8px; font-size: 12.5px; flex-wrap: wrap; }
  .event-date { color: var(--muted); min-width: 3.8rem; }
  .event-type { text-transform: capitalize; }
  select {
    padding: 4px 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 12px;
    background: var(--surface);
    color: var(--text);
    max-width: 9rem;
  }
  .link-btn { background: none; color: var(--accent); font-size: 12px; font-weight: 550; }
  .link-btn:hover { text-decoration: underline; }
  .row-delete {
    background: none;
    color: var(--muted);
    padding: 0 4px;
    font-size: 14px;
    line-height: 1;
    margin-left: auto;
    border-radius: 4px;
  }
  .row-delete:hover { color: var(--danger); background: var(--hover); }
  .feedback { color: var(--good); font-size: 11.5px; margin-top: 2px; }
  .show-all-btn {
    background: none;
    color: var(--accent);
    padding: var(--space-2) 0 0;
    font-size: 12.5px;
    font-weight: 550;
  }
  .show-all-btn:hover { text-decoration: underline; }
</style>
