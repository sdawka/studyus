<script lang="ts">
  import { onMount } from 'svelte';
  import { startCalendarActivitySync } from '../../lib/calendar/activitySync';

  let { userKey }: { userKey: string } = $props();
  onMount(() => startCalendarActivitySync({ userKey }));
</script>
