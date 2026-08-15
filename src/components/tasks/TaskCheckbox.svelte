<script lang="ts">
  // CONTRACT STUB (v1.6 foundation) — props are frozen for the parallel
  // "checkbox delight" track to build against; this file's markup/styling
  // will be replaced wholesale by that track (fun hover state + confetti
  // completion animation). Do not mount this anywhere yet — no caller
  // wires it up until the delight track lands.
  //
  // `onToggle` fires on every interaction (both checking and unchecking);
  // the caller — not this component — decides whether checking a typed
  // task should open CompletionFlow.svelte before actually completing it.
  // This stub has no such branching: it's a plain, dumb checkbox.
  interface Props {
    checked: boolean;
    busy?: boolean;
    disabled?: boolean;
    label: string;
    onToggle: () => void;
  }

  let { checked, busy = false, disabled = false, label, onToggle }: Props = $props();
</script>

<input type="checkbox" {checked} disabled={disabled || busy} aria-label={label} onchange={onToggle} />
