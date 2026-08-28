<script lang="ts">
  import { captureBehavioralEvent } from '../../lib/analytics/client';
  import { createResourceAnalytics, type ResourceOrigin } from '../../lib/analytics/engagement';

  let { resourceId, href, label, origin }: {
    resourceId: string;
    href: string;
    label: string;
    origin: ResourceOrigin;
  } = $props();

  const analytics = createResourceAnalytics(captureBehavioralEvent);
</script>

<a
  {href}
  target="_blank"
  rel="noopener noreferrer"
  onclick={() => analytics.opened(resourceId, origin)}
>{label}</a>
