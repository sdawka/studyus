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
    color?: string | null;
  }

  interface Props {
    resource: Resource;
    course?: Course;
  }

  let { resource, course }: Props = $props();
  let deleting = $state(false);
  let faviconFailed = $state(false);

  const hue = $derived(course?.color ? Number(course.color) : null);

  // Extract domain from URL (display form, www stripped)
  function getDomain(urlString: string): string {
    try {
      const url = new URL(urlString);
      return url.hostname.replace('www.', '');
    } catch {
      return 'link';
    }
  }

  function getHostname(urlString: string): string {
    try {
      return new URL(urlString).hostname;
    } catch {
      return '';
    }
  }

  const domain = $derived(getDomain(resource.url));
  const hostname = $derived(getHostname(resource.url));
  const faviconUrl = $derived(hostname ? `https://www.google.com/s2/favicons?domain=${hostname}&sz=64` : '');
  const tileHeight = $derived(resource.kind === 'user_shared' ? 88 : 72);

  async function deleteResource(e: MouseEvent) {
    e.stopPropagation();
    if (!confirm('Delete this resource?')) return;

    deleting = true;
    try {
      const res = await fetch(`/api/v1/resources/${resource.id}`, { method: 'DELETE' });
      if (res.ok) {
        const el = document.querySelector(`[data-resource-id="${resource.id}"]`);
        if (el) el.remove();
      }
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      deleting = false;
    }
  }

  function handleCardClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    // Let native anchor/button clicks (title link, course chip, delete) handle themselves.
    if (target.closest('a, button')) return;
    window.open(resource.url, '_blank', 'noopener,noreferrer');
  }

  function handleCardKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && e.target === e.currentTarget) {
      window.open(resource.url, '_blank', 'noopener,noreferrer');
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<article
  class="resource-card"
  data-resource-id={resource.id}
  data-course-id={resource.courseId || ''}
  style={hue !== null ? `--course-h:${hue}` : ''}
  onclick={handleCardClick}
  onkeydown={handleCardKeydown}
>
  <div class="card-tile" class:tinted={hue !== null} style={`height:${tileHeight}px`}>
    {#if faviconUrl && !faviconFailed}
      <img src={faviconUrl} alt="" onerror={() => (faviconFailed = true)} />
    {:else}
      <span class="tile-initial">{domain.charAt(0).toUpperCase()}</span>
    {/if}
  </div>

  <div class="card-body">
    <a href={resource.url} target="_blank" rel="noopener noreferrer" class="resource-link">
      {resource.label}
    </a>
    <span class="domain">{domain}</span>

    <div class="card-footer">
      {#if course}
        <a href={`/courses/${course.slug}`} class="course-chip">
          {course.code || course.title}
        </a>
      {/if}
      {#if resource.kind === 'user_shared'}
        <span class="kind-badge">shared by you</span>
      {/if}
      {#if resource.pinned}
        <span class="pinned-badge" title="Pinned">📌</span>
      {/if}
      {#if resource.kind === 'user_shared'}
        <button
          class="delete-btn"
          onclick={deleteResource}
          disabled={deleting}
          title="Delete this resource"
          aria-label={`Delete ${resource.label}`}
        >
          <span aria-hidden="true">×</span>
        </button>
      {/if}
    </div>
  </div>
</article>

<style>
  .resource-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    cursor: pointer;
    transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
  }

  .resource-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-pop);
    border-color: var(--muted);
  }

  .card-tile {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-2);
  }

  .card-tile.tinted {
    background: var(--course-soft);
  }

  .card-tile img {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-sm);
  }

  .tile-initial {
    font-size: 1.75rem;
    font-weight: 650;
    color: var(--course-ink, var(--muted));
  }

  .card-body {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.85rem 1rem 1rem;
  }

  .resource-link {
    text-decoration: none;
    color: var(--text);
    font-size: 1rem;
    font-weight: 600;
    line-height: 1.35;
  }

  .resource-card:hover .resource-link {
    color: var(--accent);
  }

  .domain {
    color: var(--muted);
    text-transform: uppercase;
    font-size: 0.7rem;
    letter-spacing: 0.05em;
    font-weight: 500;
  }

  .card-footer {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 0.25rem;
  }

  .course-chip {
    background: var(--course-soft, var(--accent-soft));
    color: var(--course-ink, var(--accent));
    padding: 0.2rem 0.65rem;
    border-radius: 999px;
    text-decoration: none;
    font-size: 0.78rem;
    font-weight: 550;
    transition: filter 0.15s;
  }

  .course-chip:hover {
    filter: brightness(0.95);
  }

  .kind-badge {
    color: var(--muted);
    font-size: 0.75rem;
    font-style: italic;
  }

  .pinned-badge {
    font-size: 0.85rem;
  }

  .delete-btn {
    margin-left: auto;
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 1.15rem;
    line-height: 1;
    padding: 0.15rem 0.4rem;
    border-radius: var(--radius-sm);
    transition: background-color 0.15s, color 0.15s;
  }

  .delete-btn:hover {
    background-color: var(--danger-soft);
    color: var(--danger);
  }

  .delete-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
