<script lang="ts">
  import { safeWebUrl } from '../../lib/webUrl';
  import { captureBehavioralEvent } from '../../lib/analytics/client';
  import { createResourceAnalytics, type ResourceOrigin } from '../../lib/analytics/engagement';

  let { resourceId, href, label, origin }: {
    resourceId: string;
    href: string;
    label: string;
    origin: ResourceOrigin;
  } = $props();

  const safeHref = $derived(safeWebUrl(href));
  const analytics = createResourceAnalytics(captureBehavioralEvent);
</script>

{#if safeHref}
<a
  href={safeHref}
  target="_blank"
  rel="noopener noreferrer"
  onclick={() => analytics.opened(resourceId, origin)}
>{label}</a>
{:else}
<span>{label} — Link unavailable. Use an HTTP or HTTPS URL.</span>
{/if}
