<script lang="ts">
  // CONTRACT STUB (v1.6 foundation) — props are frozen for the parallel
  // "attendance-as-task + type-specific completion flows" track to build
  // against. Do not mount this anywhere yet.
  //
  // Contract: the caller mounts this component when the user checks a
  // *typed* (non-todo) task, instead of completing it immediately the way
  // a plain todo does. This component then owns the whole completion UX —
  // collecting a recap/note, any type-specific follow-up (e.g. attendance
  // confirmation, grade entry), whatever that track designs — and is
  // responsible for actually calling the tasks store itself (toggleTask(
  // task.id, { completionNote }), and/or type-specific service calls) before
  // signaling done via `onCompleted`. `onClose` is the cancel path: the user
  // backs out without the task ever being marked complete.
  //
  // This stub does none of that yet — it's a pure pass-through so the
  // caller side of the contract (mount-on-check, unmount-on-close-or-
  // completed) can be wired up and tested before the real flow exists.
  import { onMount } from 'svelte';
  import type { ApiTask } from '../../lib/stores/tasks';

  interface Props {
    task: ApiTask;
    onClose: () => void;
    onCompleted: (opts?: { note?: string }) => void;
  }

  let { task: _task, onClose: _onClose, onCompleted }: Props = $props();

  onMount(() => {
    onCompleted();
  });
</script>
