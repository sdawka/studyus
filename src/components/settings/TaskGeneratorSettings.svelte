<script lang="ts">
  // v1.4: per-family on/off toggles for the task sweep (see
  // lib/services/taskSweep.ts). Each checkbox PATCHes /api/v1/user with
  // ONLY the changed key — settings.task_generators is deep-merged
  // server-side (services/user.ts), so a partial patch never clobbers
  // sibling toggles.
  import TaskTypeIcon from '../tasks/TaskTypeIcon.svelte';
  import { TASK_TYPE_META, type TaskType } from '../../lib/taskTypeMeta';
  import { pushToast } from '../../lib/stores/toast';

  // Fixed display order (matches the plan's generator table), distinct from
  // TASK_TYPE_META's sort-weight order which also includes 'todo'.
  const GENERATOR_ORDER: Exclude<TaskType, 'todo'>[] = [
    'attend_class',
    'prep_before_class',
    'review_after_class',
    'practice_kc',
    'stale_kc',
    'grade_entry',
  ];

  const GENERATOR_DESCRIPTIONS: Record<Exclude<TaskType, 'todo'>, string> = {
    attend_class: 'A checkable task for each upcoming class session.',
    prep_before_class: 'A reminder the day before each class meets.',
    review_after_class: 'A same-day nudge to review notes after class.',
    practice_kc: 'Practice tasks for weak concepts on assessments due soon.',
    stale_kc: "A nudge to revisit concepts you haven't touched in a while.",
    grade_entry: 'A reminder to enter a grade once an assessment is past due.',
  };

  type Generators = Record<Exclude<TaskType, 'todo'>, boolean>;

  interface Props {
    generators: Generators;
  }
  let { generators: initialGenerators }: Props = $props();

  let generators = $state({ ...initialGenerators });
  let savingKey = $state<string | null>(null);
  let savedKey = $state<string | null>(null);

  async function toggle(key: Exclude<TaskType, 'todo'>) {
    const next = !generators[key];
    generators = { ...generators, [key]: next };
    savingKey = key;
    savedKey = null;
    try {
      const res = await fetch('/api/v1/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { task_generators: { [key]: next } } }),
      });
      if (!res.ok) {
        // Roll back on failure — mirrors the optimistic-rollback pattern
        // used by the tasks store.
        generators = { ...generators, [key]: !next };
        pushToast(`Could not save "${TASK_TYPE_META[key].label}" setting`, 'error');
        return;
      }
      savedKey = key;
      setTimeout(() => {
        if (savedKey === key) savedKey = null;
      }, 2000);
    } catch {
      generators = { ...generators, [key]: !next };
      pushToast(`Network error — could not save "${TASK_TYPE_META[key].label}" setting`, 'error');
    } finally {
      savingKey = null;
    }
  }
</script>

<ul class="generator-list">
  {#each GENERATOR_ORDER as key}
    <li class="generator-row">
      <span class="row-icon"><TaskTypeIcon type={key} size={16} /></span>
      <span class="row-text">
        <span class="row-label">{TASK_TYPE_META[key].label}</span>
        <span class="row-desc">{GENERATOR_DESCRIPTIONS[key]}</span>
        {#if key === 'attend_class'}
          <span class="row-note">Unchecking hides future class tasks; attendance still tracks.</span>
        {/if}
      </span>
      <span class="row-control">
        {#if savedKey === key}<span class="saved-msg">Saved</span>{/if}
        <input
          type="checkbox"
          checked={generators[key]}
          disabled={savingKey === key}
          onchange={() => toggle(key)}
          aria-label={`Generate ${TASK_TYPE_META[key].label} tasks`}
        />
      </span>
    </li>
  {/each}
</ul>

<style>
  .generator-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .generator-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--hairline);
  }
  .generator-row:last-child { border-bottom: none; }

  .row-icon {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    color: var(--muted);
    margin-top: 2px;
  }

  .row-text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .row-label { font-size: 14px; font-weight: 550; color: var(--text); }
  .row-desc { font-size: 12.5px; color: var(--muted); }
  .row-note { font-size: 11.5px; color: var(--muted); font-style: italic; }

  .row-control { display: flex; align-items: center; gap: 8px; flex-shrink: 0; margin-top: 2px; }
  .row-control input[type='checkbox'] { cursor: pointer; accent-color: var(--accent); }
  .saved-msg { font-size: 12px; color: var(--good-ink); }
</style>
