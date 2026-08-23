<script lang="ts">
  import type { Db } from '../../db/client';
  import { apiFetch } from '../../lib/apiClient';

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
      const result = await apiFetch(
        '/api/v1/resources',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, label, course_id: courseId || null }),
        },
        'Failed to share resource',
      );

      if (!result.ok) {
        error = result.error;
        return;
      }

      success = true;
      url = '';
      label = '';
      courseId = '';

      // Reload to show new resource
      setTimeout(() => window.location.reload(), 1000);
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

    <button type="submit" class="btn btn-primary" disabled={submitting || !url || !label}>
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
    border-radius: var(--radius-sm);
    font-size: 0.95rem;
    background: var(--surface);
    color: var(--text);
    font-family: inherit;
    transition: border-color var(--motion-fast) var(--ease), box-shadow var(--motion-fast) var(--ease);
  }

  input:hover,
  select:hover {
    border-color: var(--muted);
  }

  input:disabled,
  select:disabled {
    background: var(--surface-2);
    color: var(--muted);
    cursor: not-allowed;
  }

  input:focus,
  select:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in oklch, var(--accent) 16%, transparent);
  }

  .error {
    color: var(--danger-ink);
    font-size: 0.85rem;
    margin: 0;
    padding: 0.5rem 0.75rem;
    background: var(--danger-soft);
    border-radius: var(--radius-sm);
  }

  .success {
    color: var(--good-ink);
    font-size: 0.85rem;
    margin: 0;
    padding: 0.5rem 0.75rem;
    background: var(--good-soft);
    border-radius: var(--radius-sm);
  }
</style>
