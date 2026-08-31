<script lang="ts">
  // task_due only: the complete-this-task checkbox.
  //
  // task_due items carry the raw task id (see getCalendar in
  // src/lib/services/calendar.ts — no prefix). If the tasks store already
  // has this task hydrated, go through it so every other store-backed
  // surface (TasksCard, TaskItem, TodoDropdown) sees the flip too; planner
  // pages don't hydrate the full store, so fall back to a direct PATCH.
  // Either way, report the flip optimistically via onDone and re-report
  // whatever actually lands (toggleTask swallows its own failures and rolls
  // its snapshot back rather than throwing). EventPopover owns writing that
  // back to `item` and bubbling it to the parent.
  import type { CalendarItem } from '../../../lib/types/calendar';
  import { apiFetch } from '../../../lib/apiClient';
  import { captureBehavioralEvent, currentAnalyticsSurface } from '../../../lib/analytics/client';
  import { taskCheckedEvent } from '../../../lib/analytics/engagement';
  import type { TaskType } from '../../../lib/schemas/tasks';
  import { tasksById, toggleTask } from '../../../lib/stores/tasks';
  import { burstConfetti } from '../../../lib/confetti';
  import { markFlowCelebration } from '../../../lib/completionMotion';

  let { item, onDone }: { item: CalendarItem; onDone: (done: boolean) => void } = $props();

  let toggling = $state(false);
  let checkboxEl = $state<HTMLInputElement | null>(null);

  async function handleToggle() {
    const id = item.id;
    const nextDone = !(item.details?.done === true);
    toggling = true;
    // Celebrate synchronously, before the store flip below (toggleTask's own
    // optimistic write to tasksById) — same ordering rule as CompletionFlow's
    // Done button: burst while the checkbox is guaranteed still mounted,
    // rather than risk firing from a dead anchor after some other effect of
    // the completion (a completion-hold departure elsewhere, etc.) tears it
    // down. markFlowCelebration marks the moment so any OTHER TaskCheckbox
    // reacting to this same completion (e.g. this task also rendered as a
    // TodayTasks row, sharing the same tasksById store) skips its own burst
    // — one celebration per completion, never two. Unchecking stays boring,
    // matching TaskCheckbox's check-only convention.
    if (nextDone && checkboxEl) {
      markFlowCelebration();
      burstConfetti(checkboxEl);
    }
    onDone(nextDone);
    try {
      if (tasksById.get()[id]) {
        await toggleTask(id);
        const settled = tasksById.get()[id];
        const finalDone = settled ? settled.completed : nextDone;
        if (finalDone !== nextDone) onDone(finalDone);
      } else {
        // Either failure mode (non-ok response or the request never landing)
        // reverts identically, so there's nothing left for a catch to do.
        const result = await apiFetch(`/api/v1/tasks/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ completed: nextDone }),
        });
        if (!result.ok) {
          onDone(!nextDone);
        } else if (nextDone) {
          const surface = currentAnalyticsSurface();
          if (surface) {
            captureBehavioralEvent(taskCheckedEvent({
              type: item.details?.task_type as TaskType | undefined,
              due_date: item.date,
            }, surface));
          }
        }
      }
    } finally {
      toggling = false;
    }
  }
</script>

<label class="task-toggle">
  <input
    type="checkbox"
    bind:this={checkboxEl}
    checked={item.details?.done === true}
    disabled={toggling}
    onchange={handleToggle}
  />
  <span>{item.details?.done === true ? 'Completed' : 'Mark complete'}</span>
</label>

<style>
  .task-toggle {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12.5px;
    color: var(--text);
    cursor: pointer;
  }
  .task-toggle input {
    cursor: pointer;
  }
</style>
