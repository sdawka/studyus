<script lang="ts">
  // Course page's task rail card (v1.4 task-centric platform). Store-backed
  // (src/lib/stores/tasks.ts) — reads the same tasksById map every other
  // task surface reads, so a toggle here is instantly visible in TaskItem's
  // other mounts and vice versa. Fetches independently via ensureLoaded();
  // deliberately NOT folded into StandingTab's own Promise.all so this card
  // can render before/after the rest of the tab without blocking on it.
  import TaskItem from '../tasks/TaskItem.svelte';
  import { addTask, bucketByDue, ensureLoaded, selectForCourse, selectOpen, tasksList } from '../../lib/stores/tasks';

  interface Props {
    courseId: string;
    courseSlug: string;
  }
  let { courseId, courseSlug }: Props = $props();

  void ensureLoaded();

  let courseTasks = $derived(selectForCourse($tasksList, courseId));
  let buckets = $derived(bucketByDue(selectOpen(courseTasks)));
  let visible = $derived([...buckets.overdue, ...buckets.today, ...buckets.next].slice(0, 5));
  let catchUpCount = $derived(buckets.catchUp.length);

  let newTitle = $state('');
  let adding = $state(false);

  async function quickAdd() {
    const title = newTitle.trim();
    if (!title) return;
    adding = true;
    try {
      await addTask({ title, course_ids: [courseId] });
      newTitle = '';
    } finally {
      adding = false;
    }
  }
</script>

<section class="card tasks-card">
  <div class="card-head">
    <h2 class="card-title">Tasks</h2>
    <a class="footer-link head-link" href={`/tasks?course=${courseSlug}`}>All →</a>
  </div>

  {#if visible.length === 0 && catchUpCount === 0}
    <p class="empty">No tasks for this course yet.</p>
  {:else}
    <div class="list">
      {#each visible as task (task.id)}
        <TaskItem {task} compact />
      {/each}
      {#if catchUpCount > 0}
        <p class="catch-up-line">
          {catchUpCount} {catchUpCount === 1 ? 'class' : 'classes'} to catch up
        </p>
      {/if}
    </div>
  {/if}

  <form class="quick-add" onsubmit={(e) => { e.preventDefault(); quickAdd(); }}>
    <input type="text" placeholder="Add a task…" bind:value={newTitle} disabled={adding} />
  </form>
</section>

<style>
  .tasks-card {
    display: flex;
    flex-direction: column;
  }

  /* .footer-link is normally a full-width, top-bordered block anchored at
     the bottom of a card/popover (TodoDropdown, ScratchpadPopup). This card
     wants that same accent/weight treatment but living inline in the head
     next to the title instead — override the footer-specific box model,
     keep the color/weight/size. */
  .head-link {
    display: inline;
    border-top: none;
    padding: 0;
    text-align: right;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .catch-up-line {
    color: var(--muted);
    font-size: 12px;
    padding: 0.4rem 0.5rem;
  }

  .quick-add {
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--hairline);
  }
  .quick-add input {
    width: 100%;
    padding: 6px 9px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 6px);
    font-size: 13px;
    background: var(--surface);
    color: var(--text);
  }
</style>
