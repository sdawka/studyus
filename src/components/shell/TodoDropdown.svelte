<script lang="ts">
  import TaskItem from '../tasks/TaskItem.svelte';
  import type { TaskItemTask } from '../tasks/TaskItem.svelte';
  import { bindPopoverDismiss } from './popover.svelte.ts';

  interface Course {
    id: string;
    code: string;
    color?: string | number | null;
    color_hue?: number | null;
  }

  interface Props {
    open: boolean;
    onToggle: () => void;
    onClose: () => void;
    courses?: Course[];
  }

  let { open, onToggle, onClose, courses = [] }: Props = $props();

  let anchorEl: HTMLElement | null = null;
  let tasks = $state<TaskItemTask[]>([]);
  let loaded = $state(false);
  let newTitle = $state('');
  let adding = $state(false);

  let courseHues = $derived.by(() => {
    const map: Record<string, number> = {};
    for (const c of courses) {
      const hue = c.color_hue ?? (c.color !== null && c.color !== undefined ? Number(c.color) : null);
      if (hue !== null && !Number.isNaN(hue)) map[c.id] = hue;
    }
    return map;
  });

  let openTasks = $derived(tasks.filter((t) => !t.completed));
  let openCount = $derived(openTasks.length);
  let topSeven = $derived(
    [...openTasks]
      .sort((a, b) => {
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      })
      .slice(0, 7),
  );

  async function loadTasks() {
    try {
      const res = await fetch('/api/v1/tasks');
      if (res.ok) {
        const json = await res.json();
        tasks = json.data;
      }
    } finally {
      loaded = true;
    }
  }

  $effect(() => {
    void loadTasks();
  });

  bindPopoverDismiss({ isOpen: () => open, close: () => onClose(), anchorEl: () => anchorEl });

  function handleToggle(updated: TaskItemTask) {
    tasks = tasks.map((t) => (t.id === updated.id ? updated : t));
  }

  function handleDelete(id: string) {
    tasks = tasks.filter((t) => t.id !== id);
  }

  async function quickAdd() {
    if (!newTitle.trim()) return;
    adding = true;
    try {
      const res = await fetch('/api/v1/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim() }),
      });
      if (res.ok) {
        const json = await res.json();
        tasks = [json.data, ...tasks];
        newTitle = '';
      }
    } finally {
      adding = false;
    }
  }
</script>

<div class="popover-anchor" bind:this={anchorEl}>
  <button type="button" class="icon-btn" onclick={onToggle} aria-expanded={open} title="To-do" aria-label="To-do list">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M9 12l2 2 4-4 M5 5h14v14H5z" />
    </svg>
    {#if openCount > 0}
      <span class="badge">{openCount > 9 ? '9+' : openCount}</span>
    {/if}
  </button>

  {#if open}
    <div class="popover panel" role="menu" style="--pop-w: var(--pop-w-md)">
      <div class="panel-head">
        <span class="kicker">To-do ({openCount})</span>
      </div>

      <form class="quick-add" onsubmit={(e) => { e.preventDefault(); quickAdd(); }}>
        <input type="text" placeholder="Quick add a task…" bind:value={newTitle} disabled={adding} />
        <button type="submit" disabled={adding || !newTitle.trim()} aria-label="Add task">+</button>
      </form>

      {#if !loaded}
        <p class="empty">Loading…</p>
      {:else if topSeven.length === 0}
        <p class="empty">No open tasks. Nicely done.</p>
      {:else}
        <div class="list">
          {#each topSeven as task (task.id)}
            <TaskItem {task} compact {courseHues} ontoggle={handleToggle} ondelete={handleDelete} />
          {/each}
        </div>
      {/if}

      <a class="footer-link" href="/tasks">All tasks →</a>
    </div>
  {/if}
</div>

<style>
  .popover-anchor { position: relative; }

  .badge {
    position: absolute;
    top: 2px;
    right: 2px;
    min-width: 15px;
    height: 15px;
    padding: 0 3px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-contrast);
    font-size: 9.5px;
    font-weight: 700;
    display: grid;
    place-items: center;
    line-height: 1;
  }

  .panel {
    max-height: 460px;
    overflow-y: auto;
  }

  .quick-add { display: flex; gap: 6px; }
  .quick-add input {
    flex: 1;
    min-width: 0;
    padding: 6px 9px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 6px);
    font-size: 13px;
    background: var(--surface);
    color: var(--text);
  }
  .quick-add button {
    width: 30px;
    border-radius: var(--radius-sm, 6px);
    background: var(--accent);
    color: var(--accent-contrast);
    font-size: 15px;
    font-weight: 700;
  }
  .quick-add button:disabled { opacity: 0.5; }

  .list { display: flex; flex-direction: column; gap: 2px; }
</style>
