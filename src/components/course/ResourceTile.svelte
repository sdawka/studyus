<script lang="ts">
  interface Resource {
    id: string;
    url: string;
    label: string;
    pinned: boolean;
  }

  interface Props {
    resource: Resource;
    deletable?: boolean;
  }

  let { resource, deletable = false }: Props = $props();
  let deleting = $state(false);
  let faviconFailed = $state(false);

  function getHostname(urlString: string): string {
    try {
      return new URL(urlString).hostname;
    } catch {
      return '';
    }
  }

  function getDomain(urlString: string): string {
    return getHostname(urlString).replace('www.', '') || 'link';
  }

  const hostname = $derived(getHostname(resource.url));
  const domain = $derived(getDomain(resource.url));
  const faviconUrl = $derived(hostname ? `https://www.google.com/s2/favicons?domain=${hostname}&sz=64` : '');

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

  function handleTileClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('a, button')) return;
    window.open(resource.url, '_blank', 'noopener,noreferrer');
  }

  function handleTileKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && e.target === e.currentTarget) {
      window.open(resource.url, '_blank', 'noopener,noreferrer');
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<article
  class="resource-tile"
  data-resource-id={resource.id}
  onclick={handleTileClick}
  onkeydown={handleTileKeydown}
  tabindex="0"
>
  <div class="tile-favicon">
    {#if faviconUrl && !faviconFailed}
      <img src={faviconUrl} alt="" onerror={() => (faviconFailed = true)} />
    {:else}
      <span class="tile-initial">{domain.charAt(0).toUpperCase()}</span>
    {/if}
  </div>

  <div class="tile-body">
    <a href={resource.url} target="_blank" rel="noopener noreferrer" class="tile-label">
      {resource.label}
    </a>
    <span class="tile-domain">{domain}</span>
  </div>

  {#if resource.pinned}
    <span class="tile-pin" title="Pinned">📌</span>
  {/if}
  {#if deletable}
    <button
      class="tile-delete"
      onclick={deleteResource}
      disabled={deleting}
      title="Delete this resource"
      aria-label={`Delete ${resource.label}`}
    >
      <span aria-hidden="true">×</span>
    </button>
  {/if}
</article>

<style>
  .resource-tile {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: transform var(--motion-base) var(--ease), box-shadow var(--motion-base) var(--ease),
      border-color var(--motion-base) var(--ease);
  }

  .resource-tile:hover,
  .resource-tile:focus-visible {
    transform: translateY(-2px);
    box-shadow: var(--shadow-pop);
    border-color: var(--course, var(--muted));
  }

  .tile-favicon {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-sm);
    background: var(--course-soft, var(--surface-2));
  }

  .tile-favicon img {
    width: 20px;
    height: 20px;
    border-radius: var(--radius-sm);
  }

  .tile-initial {
    font-size: 1.05rem;
    font-weight: 650;
    color: var(--course-ink, var(--muted));
  }

  .tile-body {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    flex: 1 1 auto;
  }

  .tile-label {
    color: var(--text);
    text-decoration: none;
    font-size: 0.88rem;
    font-weight: 600;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    /* Dense, repeated (one per resource tile) — explicit sans so it can
       never inherit the page's serif --font-display. */
    font-family: var(--font-title, var(--font-body));
  }

  .resource-tile:hover .tile-label {
    color: var(--accent);
  }

  .tile-domain {
    color: var(--muted);
    text-transform: uppercase;
    font-size: 0.65rem;
    letter-spacing: 0.05em;
    font-weight: 500;
  }

  .tile-pin {
    flex: 0 0 auto;
    font-size: 0.8rem;
    align-self: flex-start;
  }

  .tile-delete {
    flex: 0 0 auto;
    align-self: flex-start;
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 1.05rem;
    line-height: 1;
    padding: 0.1rem 0.35rem;
    border-radius: var(--radius-sm);
    transition: background-color var(--motion-fast) var(--ease), color var(--motion-fast) var(--ease);
  }

  .tile-delete:hover {
    background-color: var(--danger-soft);
    color: var(--danger);
  }

  .tile-delete:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
