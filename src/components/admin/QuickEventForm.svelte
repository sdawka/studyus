<script lang="ts">
  interface CourseOption {
    id: string;
    code: string;
    title: string;
  }

  let { courses }: { courses: CourseOption[] } = $props();

  const EVENT_TYPES = [
    { value: 'lecture_attended', label: 'Attended a lecture' },
    { value: 'lecture_missed', label: 'Missed a lecture' },
    { value: 'reading_done', label: 'Did the reading' },
    { value: 'video_watched', label: 'Watched a video' },
    { value: 'practice_done', label: 'Did practice problems' },
    { value: 'retrieval_practice', label: 'Ran a retrieval practice set' },
    { value: 'taught_someone', label: 'Taught someone else' },
  ];

  let type = $state(EVENT_TYPES[0].value);
  let courseId = $state('');
  let submitting = $state(false);
  let message = $state<string | null>(null);
  let error = $state<string | null>(null);

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    submitting = true;
    error = null;
    message = null;
    try {
      const res = await fetch('/api/v1/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, course_id: courseId || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        error = json?.error?.message ?? 'Could not log that event.';
        return;
      }
      message = 'Logged.';
    } catch {
      error = 'Network error, please try again.';
    } finally {
      submitting = false;
    }
  }
</script>

<form onsubmit={handleSubmit}>
  <label>
    What happened
    <select bind:value={type}>
      {#each EVENT_TYPES as opt}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>
  </label>
  <label>
    Course (optional)
    <select bind:value={courseId}>
      <option value="">— none —</option>
      {#each courses as c}
        <option value={c.id}>{c.code} — {c.title}</option>
      {/each}
    </select>
  </label>
  <button type="submit" disabled={submitting}>{submitting ? 'Logging…' : 'Log it'}</button>
  {#if message}<span class="ok">{message}</span>{/if}
  {#if error}<span class="error">{error}</span>{/if}
</form>

<style>
  form {
    display: flex;
    align-items: flex-end;
    gap: 1rem;
    flex-wrap: wrap;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.85rem;
    color: #374151;
  }
  select {
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 0.9rem;
    min-width: 200px;
  }
  button {
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 8px;
    padding: 0.55rem 1rem;
    font-size: 0.9rem;
    cursor: pointer;
  }
  button:disabled { opacity: 0.6; cursor: default; }
  .ok { color: #15803d; font-size: 0.85rem; }
  .error { color: #b91c1c; font-size: 0.85rem; }
</style>
