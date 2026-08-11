<script lang="ts">
  // Reusable event timeline island. Fetches from the events API and
  // self-refreshes after any mutation — no props out, no events emitted.
  interface Props {
    kcId?: string;
    courseId?: string;
    limit?: number;
  }
  const { kcId, courseId, limit = 20 }: Props = $props();

  type ApiEvent = {
    id: string;
    ts: string;
    type: string;
    is_instructional: boolean;
    is_assessment: boolean;
    kc_id: string | null;
    course_id: string | null;
    payload: Record<string, unknown>;
    source: 'manual' | 'session' | 'tutor' | 'seed';
  };

  const TYPE_LABELS: Record<string, string> = {
    lecture_attended: 'Attended lecture',
    lecture_missed: 'Missed lecture',
    video_watched: 'Watched video',
    reading_done: 'Did reading',
    taught_someone: 'Taught someone',
    quiz_taken: 'Quiz taken',
    assignment_graded: 'Assignment graded',
    exam_graded: 'Exam graded',
    self_assessment: 'Self-assessment',
    practice_done: 'Practice done',
    retrieval_practice: 'Retrieval practice',
    tutor_session: 'Tutor session',
  };
  const EVENT_TYPES = Object.keys(TYPE_LABELS);

  function humanize(type: string): string {
    return TYPE_LABELS[type] ?? type;
  }

  function payloadScore(payload: Record<string, unknown>): string | null {
    if (typeof payload?.score === 'number') return `${payload.score}%`;
    if (typeof payload?.self_rating === 'number') return `self-rated ${payload.self_rating}/5`;
    if (typeof payload?.correctness === 'number') return `${Math.round(payload.correctness * 100)}%`;
    if (typeof payload?.correct === 'boolean') return payload.correct ? 'correct' : 'incorrect';
    return null;
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  let events = $state<ApiEvent[]>([]);
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let editingId = $state<string | null>(null);
  let editType = $state('');
  let editTs = $state('');
  let editScore = $state('');
  let editNote = $state('');
  let busyId = $state<string | null>(null);

  function fetchUrl(): string {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (kcId) return `/api/v1/kcs/${kcId}/events?${params.toString()}`;
    if (courseId) params.set('course', courseId);
    return `/api/v1/events?${params.toString()}`;
  }

  async function load() {
    loading = true;
    loadError = null;
    try {
      const res = await fetch(fetchUrl());
      const json = await res.json();
      if (!res.ok) {
        loadError = json?.error?.message ?? 'Failed to load events';
        return;
      }
      events = json.data;
    } catch {
      loadError = 'Network error, please try again.';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    // Re-fetch whenever the scope props change.
    void kcId;
    void courseId;
    void limit;
    load();
  });

  function startEdit(event: ApiEvent) {
    editingId = event.id;
    editType = event.type;
    editTs = new Date(event.ts).toISOString().slice(0, 16);
    editScore = typeof event.payload?.score === 'number' ? String(event.payload.score) : '';
    editNote = typeof event.payload?.note === 'string' ? event.payload.note : '';
  }

  function cancelEdit() {
    editingId = null;
  }

  async function saveEdit(event: ApiEvent) {
    busyId = event.id;
    try {
      const payload: Record<string, unknown> = { ...event.payload };
      if (editScore.trim() !== '') payload.score = Number(editScore);
      else delete payload.score;
      if (editNote.trim() !== '') payload.note = editNote.trim();
      else delete payload.note;

      const res = await fetch(`/api/v1/events/${event.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: editType,
          ts: new Date(editTs).toISOString(),
          payload,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        loadError = json?.error?.message ?? 'Failed to update event';
        return;
      }
      editingId = null;
      await load();
    } finally {
      busyId = null;
    }
  }

  async function remove(event: ApiEvent) {
    if (event.source !== 'manual' && !confirm(`Delete this ${humanize(event.type).toLowerCase()} event? This can't be undone.`)) {
      return;
    }
    busyId = event.id;
    try {
      const res = await fetch(`/api/v1/events/${event.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        loadError = json?.error?.message ?? 'Failed to delete event';
        return;
      }
      await load();
    } finally {
      busyId = null;
    }
  }
</script>

<div class="timeline">
  {#if loading}
    <p class="muted">Loading events…</p>
  {:else if loadError}
    <p class="error">{loadError}</p>
  {:else if events.length === 0}
    <p class="muted">No events logged yet.</p>
  {:else}
    <ul>
      {#each events as event (event.id)}
        <li>
          {#if editingId === event.id}
            <div class="edit-form">
              <select bind:value={editType}>
                {#each EVENT_TYPES as t (t)}
                  <option value={t}>{humanize(t)}</option>
                {/each}
              </select>
              <input type="datetime-local" bind:value={editTs} />
              <input type="number" placeholder="Score %" bind:value={editScore} min="0" max="100" />
              <input type="text" placeholder="Note" bind:value={editNote} />
              <div class="edit-actions">
                <button type="button" disabled={busyId === event.id} onclick={() => saveEdit(event)}>Save</button>
                <button type="button" class="ghost" onclick={cancelEdit}>Cancel</button>
              </div>
            </div>
          {:else}
            <div class="row">
              <div class="row-main">
                <span class="type">{humanize(event.type)}</span>
                {#if event.is_instructional}<span class="badge badge-ie">IE</span>{/if}
                {#if event.is_assessment}<span class="badge badge-ae">AE</span>{/if}
                <span class="date">{formatDate(event.ts)}</span>
              </div>
              <div class="row-meta">
                {#if payloadScore(event.payload)}<span class="score">{payloadScore(event.payload)}</span>{/if}
                <span class="source">{event.source}</span>
                {#if event.source === 'manual'}
                  <button type="button" class="link" onclick={() => startEdit(event)}>Edit</button>
                {/if}
                <button type="button" class="link danger" disabled={busyId === event.id} onclick={() => remove(event)}>
                  Delete
                </button>
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .timeline { display: flex; flex-direction: column; gap: 0.5rem; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  li {
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 0.6rem 0.8rem;
    background: white;
  }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
  .row-main { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .row-meta { display: flex; align-items: center; gap: 0.6rem; font-size: 0.85rem; color: #6b7280; }
  .type { font-weight: 500; font-size: 0.92rem; }
  .date { color: #6b7280; font-size: 0.82rem; }
  .badge {
    font-size: 0.68rem;
    font-weight: 600;
    padding: 0.1rem 0.4rem;
    border-radius: 999px;
    letter-spacing: 0.02em;
  }
  .badge-ie { background: #e0ecff; color: #2f4d99; }
  .badge-ae { background: #fde8d2; color: #9a5b12; }
  .score { font-weight: 500; color: #1c1e21; }
  .link {
    background: none;
    border: none;
    color: #3f6fd8;
    cursor: pointer;
    font-size: 0.85rem;
    padding: 0;
  }
  .link.danger { color: #b91c1c; }
  .link:disabled { opacity: 0.5; cursor: default; }
  .edit-form { display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center; }
  .edit-form input, .edit-form select {
    padding: 0.35rem 0.5rem;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    font-size: 0.85rem;
  }
  .edit-actions { display: flex; gap: 0.4rem; }
  .edit-actions button {
    background: #3f6fd8;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.35rem 0.6rem;
    font-size: 0.82rem;
    cursor: pointer;
  }
  .edit-actions button.ghost { background: none; color: #6b7280; }
  .muted { color: #6b7280; font-size: 0.9rem; }
  .error { color: #b91c1c; font-size: 0.9rem; }
</style>
