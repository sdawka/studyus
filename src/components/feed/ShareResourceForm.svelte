<script lang="ts">
  import type { Db } from '../../db/client';

  interface Course {
    id: string;
    title: string;
    slug: string;
    code?: string;
  }

  interface Props {
    courses: Course[];
  }

  let { courses }: Props = $props();

  let url = $state('');
  let label = $state('');
  let courseId = $state('');
  let error = $state<string | null>(null);
  let success = $state(false);
  let submitting = $state(false);

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    success = false;
    submitting = true;

    try {
      const res = await fetch('/api/v1/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          label,
          course_id: courseId || null,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        error = json?.error?.message ?? 'Failed to share resource';
        return;
      }

      success = true;
      url = '';
      label = '';
      courseId = '';

      // Reload to show new resource
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      error = 'Network error, please try again.';
      console.error('Submit error:', err);
    } finally {
      submitting = false;
    }
  }
</script>

<div class="share-form-wrapper">
  <h2>Share a resource</h2>
  <p class="form-hint">Found something useful? Share it with your study group.</p>

  <form onsubmit={handleSubmit}>
    <div class="form-group">
      <label for="url">URL *</label>
      <input
        id="url"
        type="url"
        bind:value={url}
        placeholder="https://example.com/article"
        required
        disabled={submitting}
      />
    </div>

    <div class="form-group">
      <label for="label">Title *</label>
      <input
        id="label"
        type="text"
        bind:value={label}
        placeholder="Brief title for this resource"
        required
        disabled={submitting}
      />
    </div>

    <div class="form-group">
      <label for="course">Course (optional)</label>
      <select id="course" bind:value={courseId} disabled={submitting}>
        <option value="">None</option>
        {#each courses as course}
          <option value={course.id}>{course.title}</option>
        {/each}
      </select>
    </div>

    {#if error}
      <p class="error">{error}</p>
    {/if}

    {#if success}
      <p class="success">Resource shared! Reloading...</p>
    {/if}

    <button type="submit" disabled={submitting || !url || !label}>
      {submitting ? 'Sharing…' : 'Share resource'}
    </button>
  </form>
</div>

<style>
  .share-form-wrapper {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  h2 {
    margin: 0 0 0.25rem 0;
    font-size: 1.1rem;
  }

  .form-hint {
    margin: 0;
    color: var(--muted);
    font-size: 0.9rem;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  label {
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text);
  }

  input,
  select {
    padding: 0.55rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 0.95rem;
    background: white;
    color: var(--text);
    font-family: inherit;
  }

  input:disabled,
  select:disabled {
    background: #f9fafb;
    color: var(--muted);
    cursor: not-allowed;
  }

  input:focus,
  select:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(63, 111, 216, 0.1);
  }

  button {
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.65rem 1rem;
    font-size: 0.95rem;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  button:hover:not(:disabled) {
    background: #3558b5;
  }

  button:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .error {
    color: #b91c1c;
    font-size: 0.85rem;
    margin: 0;
    padding: 0.5rem 0.75rem;
    background: #fee2e2;
    border-radius: 4px;
  }

  .success {
    color: #15803d;
    font-size: 0.85rem;
    margin: 0;
    padding: 0.5rem 0.75rem;
    background: #dcfce7;
    border-radius: 4px;
  }
</style>
