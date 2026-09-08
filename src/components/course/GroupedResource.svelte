<script lang="ts">
  import { safeWebUrl } from '../../lib/webUrl';
  import { captureBehavioralEvent } from '../../lib/analytics/client';
  import { createResourceAnalytics, type ResourceOrigin } from '../../lib/analytics/engagement';

  interface ResourceEntry {
    id: string;
    url: string;
    label: string;
    kind: string;
    pinned: boolean;
  }

  interface ResourceContext {
    id: string;
    name: string;
    href: string;
  }

  interface Props {
    resources: ResourceEntry[];
    contexts: ResourceContext[];
  }

  let { resources: initialResources, contexts }: Props = $props();
  let removedIds = $state<Set<string>>(new Set());
  const resources = $derived(initialResources.filter((resource) => !removedIds.has(resource.id)));
  const analytics = createResourceAnalytics(captureBehavioralEvent);

  const representative = $derived(resources[0]);
  const safeUrl = $derived(representative ? safeWebUrl(representative.url) : null);
  const domain = $derived.by(() => {
    if (!representative) return 'link';
    try {
      return new URL(representative.url).hostname.replace(/^www\./, '') || 'link';
    } catch {
      return 'link';
    }
  });
  const sharedResources = $derived(resources.filter((resource) => resource.kind === 'user_shared'));

  function trackOpen() {
    if (!safeUrl) return;
    for (const resource of resources) {
      const origin: ResourceOrigin = resource.kind === 'user_shared' ? 'shared' : resource.kind === 'feed' ? 'feed' : 'course';
      analytics.opened(resource.id, origin);
    }
  }

  async function deleteResource(resourceId: string, event: MouseEvent) {
    event.stopPropagation();
    if (!confirm('Delete this resource?')) return;

    const response = await fetch(`/api/v1/resources/${resourceId}`, { method: 'DELETE' });
    if (response.ok) removedIds = new Set([...removedIds, resourceId]);
  }

  function handleCardClick(event: MouseEvent) {
    if ((event.target as HTMLElement).closest('a, button')) return;
    trackOpen();
    if (safeUrl) window.open(safeUrl, '_blank', 'noopener,noreferrer');
  }

  function handleCardKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && event.target === event.currentTarget) {
      trackOpen();
      if (safeUrl) window.open(safeUrl, '_blank', 'noopener,noreferrer');
    }
  }
</script>

{#if representative}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <article class="grouped-resource" data-resource-group={representative.url} onclick={handleCardClick} onkeydown={handleCardKeydown} tabindex={safeUrl ? 0 : undefined}>
    <div class="resource-icon" aria-hidden="true">{domain.charAt(0).toUpperCase()}</div>
    <div class="resource-body">
      <div class="resource-heading">
        {#if safeUrl}
          <a class="resource-link" href={safeUrl} target="_blank" rel="noopener noreferrer" onclick={trackOpen}>{representative.label}</a>
        {:else}
          <span class="resource-link">{representative.label}</span>
          <small>Link unavailable. Replace it with an HTTP or HTTPS URL.</small>
        {/if}
        {#if representative.pinned}<span class="pinned" title="Pinned">Pinned</span>{/if}
      </div>
      <span class="domain">{domain}</span>
      <div class="resource-meta">
        <span>{resources.length} {resources.length === 1 ? 'link' : 'links'} · {contexts.length} {contexts.length === 1 ? 'concept' : 'concepts'}</span>
        {#if resources.some((resource) => resource.kind === 'canonical')}<span class="kind">official</span>{/if}
        {#if resources.some((resource) => resource.kind === 'feed')}<span class="kind">feed</span>{/if}
        {#if sharedResources.length > 0}<span class="kind">shared by you</span>{/if}
      </div>
      {#if contexts.length > 0}
        <div class="contexts" aria-label="Related concepts">
          {#each contexts as context}
            <a href={context.href}>{context.name}</a>
          {/each}
        </div>
      {:else}
        <span class="no-context">Course resource</span>
      {/if}
    </div>
    {#if sharedResources.length > 0}
      <div class="resource-actions">
        {#each sharedResources as resource}
          <button type="button" class="delete" onclick={(event) => deleteResource(resource.id, event)} aria-label={`Delete ${resource.label}`}>
            Delete
          </button>
        {/each}
      </div>
    {/if}
  </article>
{/if}

<style>
  .grouped-resource {
    position: relative;
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr) auto;
    gap: var(--space-3);
    align-items: start;
    padding: var(--space-4);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    transition: transform var(--motion-base) var(--ease), box-shadow var(--motion-base) var(--ease), border-color var(--motion-base) var(--ease);
  }
  .grouped-resource:hover, .grouped-resource:focus-visible { transform: translateY(-2px); box-shadow: var(--shadow-pop); border-color: var(--course, var(--muted)); outline: none; }
  .resource-icon { display: grid; place-items: center; width: 42px; height: 42px; border-radius: var(--radius-sm); background: var(--course-soft, var(--surface-2)); color: var(--course-ink, var(--muted)); font-weight: 700; }
  .resource-body { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  .resource-heading { display: flex; align-items: start; gap: 8px; }
  .resource-link { min-width: 0; color: var(--text); font: 600 .96rem/1.35 var(--font-title, var(--font-body)); text-decoration: none; overflow-wrap: anywhere; }
  a.resource-link:hover { color: var(--accent); }
  .resource-body small, .domain, .no-context { color: var(--muted); font-size: .78rem; }
  .domain { text-transform: uppercase; letter-spacing: .05em; font-size: .66rem; }
  .pinned, .kind { display: inline-flex; align-items: center; padding: 3px 7px; border-radius: 999px; background: var(--surface-2); color: var(--muted); font-size: .68rem; white-space: nowrap; }
  .resource-meta { display: flex; flex-wrap: wrap; gap: 6px; color: var(--muted); font-size: .76rem; }
  .contexts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 3px; }
  .contexts a { color: var(--course-ink, var(--accent)); background: var(--course-soft, var(--surface-2)); border-radius: 999px; padding: 4px 8px; font-size: .76rem; text-decoration: none; }
  .contexts a:hover { text-decoration: underline; }
  .resource-actions { display: flex; flex-wrap: wrap; justify-content: end; gap: 5px; }
  .delete { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 5px 8px; background: transparent; color: var(--muted); cursor: pointer; font-size: .72rem; }
  .delete:hover { color: var(--danger); border-color: var(--danger); }
  @media (max-width: 560px) {
    .grouped-resource { grid-template-columns: 36px minmax(0, 1fr); padding: var(--space-3); }
    .resource-icon { width: 36px; height: 36px; }
    .resource-actions { grid-column: 2; justify-content: start; }
  }
</style>
