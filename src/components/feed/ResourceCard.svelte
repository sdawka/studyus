<script lang="ts">
  import type { Db } from '../../db/client';

  interface Resource {
    id: string;
    url: string;
    label: string;
    kind: string;
    courseId?: string | null;
    kcId?: string | null;
    pinned: boolean;
    createdAt?: number;
  }

  interface Course {
    id: string;
    title: string;
    slug: string;
    code?: string;
  }

  interface Props {
    resource: Resource;
    course?: Course;
  }

  let { resource, course }: Props = $props();
  let deleting = $state(false);

  // Extract domain from URL
  function getDomain(urlString: string): string {
    try {
      const url = new URL(urlString);
      return url.hostname.replace('www.', '');
    } catch {
      return 'link';
    }
  }

  async function deleteResource() {
    if (!confirm('Delete this resource?')) return;

    deleting = true;
    try {
      const res = await fetch(`/api/v1/resources/${resource.id}`, { method: 'DELETE' });
      if (res.ok) {
        // Remove card from DOM
        const el = document.querySelector(`[data-resource-id="${resource.id}"]`);
        if (el) el.remove();
      }
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      deleting = false;
    }
  }
</script>

<article class="resource-card" data-resource-id={resource.id} data-course-id={resource.courseId || ''}>
  <div class="card-header">
    <a href={resource.url} target="_blank" rel="noopener noreferrer" class="resource-link">
      <h3>{resource.label}</h3>
    </a>
    {#if resource.kind === 'user_shared'}
      <button class="delete-btn" onclick={deleteResource} disabled={deleting} title="Delete this resource">
        ×
      </button>
    {/if}
  </div>

  <div class="card-meta">
    <span class="domain">{getDomain(resource.url)}</span>
    {#if course}
      <a href={`/courses/${course.slug}`} class="course-chip">
        {course.code || course.title}
      </a>
    {/if}
    {#if resource.pinned}
      <span class="pinned-badge">📌 Pinned</span>
    {/if}
  </div>
</article>

<style>
  .resource-card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  .resource-card:hover {
    border-color: var(--accent);
    box-shadow: 0 2px 8px rgba(63, 111, 216, 0.1);
  }

  .card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .resource-link {
    flex: 1;
    text-decoration: none;
  }

  h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--accent);
  }

  .resource-link:hover h3 {
    text-decoration: underline;
  }

  .delete-btn {
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 1.5rem;
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: background-color 0.2s, color 0.2s;
  }

  .delete-btn:hover {
    background-color: #fee2e2;
    color: #dc2626;
  }

  .delete-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .card-meta {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
    font-size: 0.85rem;
  }

  .domain {
    color: var(--muted);
    text-transform: uppercase;
    font-size: 0.75rem;
    letter-spacing: 0.05em;
    font-weight: 500;
  }

  .course-chip {
    background: #e0e7ff;
    color: var(--accent);
    padding: 0.25rem 0.75rem;
    border-radius: 12px;
    text-decoration: none;
    font-size: 0.85rem;
    font-weight: 500;
    transition: background-color 0.2s;
  }

  .course-chip:hover {
    background: #c7d2fe;
  }

  .pinned-badge {
    color: var(--accent);
    font-size: 0.8rem;
  }
</style>
