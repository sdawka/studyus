<script lang="ts">
  // Minimal inline SVG icon for a task's type, keyed off TASK_TYPE_META
  // (24x24 stroke viewBox, same convention as components/shell/Icon.astro).
  // Renders nothing for 'todo' — plain user tasks stay the calm default,
  // no icon clutter.
  import { TASK_TYPE_META, type TaskType } from '../../lib/taskTypeMeta';

  interface Props {
    type: TaskType;
    size?: number;
  }

  let { type, size = 14 }: Props = $props();

  let iconPath = $derived(TASK_TYPE_META[type].iconPath);
</script>

{#if iconPath}
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d={iconPath} />
  </svg>
{/if}
