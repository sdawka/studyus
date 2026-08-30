<script lang="ts">
  // Minimal runes component: proves the dom project compiles <script lang="ts">,
  // mounts to happy-dom, and that $state updates flush on interaction.
  let { name = 'world' }: { name?: string } = $props();
  let count = $state(0);
</script>

<button onclick={() => count++}>hello {name} {count}</button>
