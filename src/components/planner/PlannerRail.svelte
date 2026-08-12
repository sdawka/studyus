<script lang="ts">
  import type { CalendarItem } from '../../lib/types/calendar';
  import { hueFor } from '../../lib/courseHue';
  import { addDays, localDateKey, mondayOf, startOfDay } from '../../lib/plannerDates';

  interface CourseOption {
    id: string;
    slug: string;
    code: string;
    title: string;
    color: number | null;
  }

  let {
    items,
    courses,
    selectedId = null,
    weekStart,
    onSelect,
    onJumpToWeek,
  }: {
    items: CalendarItem[]; // task_due + assessment_due, incomplete, within window
    courses: CourseOption[];
    selectedId?: string | null;
    weekStart: string;
    onSelect: (item: CalendarItem) => void;
    onJumpToWeek: (date: Date, item: CalendarItem) => void;
  } = $props();

  const courseById = new Map(courses.map((c) => [c.id, c]));
  function courseFor(item: CalendarItem) {
    return item.course_id ? courseById.get(item.course_id) : undefined;
  }
  function hueForItem(item: CalendarItem): number {
    const c = courseFor(item);
    return c ? hueFor({ slug: c.slug, color: c.color === null ? null : String(c.color) }) : 220;
  }

  const today = $derived(startOfDay(new Date()));

  function daysUntil(item: CalendarItem): number {
    const d = startOfDay(new Date(item.date));
    return Math.round((d.getTime() - today.getTime()) / 86_400_000);
  }

  const incomplete = $derived(items.filter((i) => !(i.type === 'task_due' && i.details?.done === true)));

  const overdue = $derived(incomplete.filter((i) => daysUntil(i) < 0).sort((a, b) => a.date.localeCompare(b.date)));
  const dueSoon = $derived(incomplete.filter((i) => daysUntil(i) === 0 || daysUntil(i) === 1).sort((a, b) => a.date.localeCompare(b.date)));
  const thisWeek = $derived(
    incomplete.filter((i) => daysUntil(i) >= 2 && daysUntil(i) <= 7).sort((a, b) => a.date.localeCompare(b.date)),
  );

  function weekStartFor(date: Date): string {
    return localDateKey(mondayOf(date));
  }

  function handleClick(item: CalendarItem) {
    const itemWeekStart = weekStartFor(new Date(item.date));
    if (itemWeekStart === weekStart) {
      onSelect(item);
    } else {
      onJumpToWeek(new Date(item.date), item);
    }
  }

  function dueLabel(item: CalendarItem): string {
    const days = daysUntil(item);
    if (days < 0) return `${Math.abs(days)}d overdue`;
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    return new Date(item.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
</script>

<div class="planner-rail">
  {#if overdue.length}
    <section>
      <h3 class="kicker rail-heading overdue-heading">Overdue</h3>
      <ul class="rail-list">
        {#each overdue as item (item.id)}
          <li>
            <button type="button" class="rail-item overdue" class:selected={selectedId === item.id} style={`--course-h:${hueForItem(item)}`} onclick={() => handleClick(item)}>
              {#if courseFor(item)}<span class="chip rail-chip">{courseFor(item)?.code}</span>{/if}
              <span class="rail-title">{item.title}</span>
              <span class="rail-due">{dueLabel(item)}</span>
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if dueSoon.length}
    <section>
      <h3 class="kicker rail-heading">Due today / tomorrow</h3>
      <ul class="rail-list">
        {#each dueSoon as item (item.id)}
          <li>
            <button type="button" class="rail-item" class:selected={selectedId === item.id} style={`--course-h:${hueForItem(item)}`} onclick={() => handleClick(item)}>
              {#if courseFor(item)}<span class="chip rail-chip">{courseFor(item)?.code}</span>{/if}
              <span class="rail-title">{item.title}</span>
              <span class="rail-due">{dueLabel(item)}</span>
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if thisWeek.length}
    <section>
      <h3 class="kicker rail-heading">This week</h3>
      <ul class="rail-list">
        {#each thisWeek as item (item.id)}
          <li>
            <button type="button" class="rail-item" class:selected={selectedId === item.id} style={`--course-h:${hueForItem(item)}`} onclick={() => handleClick(item)}>
              {#if courseFor(item)}<span class="chip rail-chip">{courseFor(item)?.code}</span>{/if}
              <span class="rail-title">{item.title}</span>
              <span class="rail-due">{dueLabel(item)}</span>
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if !overdue.length && !dueSoon.length && !thisWeek.length}
    <p class="rail-empty">Nothing due this week.</p>
  {/if}
</div>

<style>
  .planner-rail {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
  }
  .rail-heading {
    color: var(--muted);
    margin-bottom: 6px;
  }
  .overdue-heading {
    color: var(--danger-ink);
  }
  .rail-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .rail-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    background: var(--surface-2);
    border: 1px solid var(--hairline);
    border-left: 3px solid transparent;
    border-radius: var(--radius-sm);
    text-align: left;
  }
  .rail-item:hover {
    border-color: var(--border);
  }
  .rail-item.selected {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .rail-item.overdue {
    border-left-color: var(--danger);
  }
  .rail-chip {
    flex-shrink: 0;
    padding: 2px 8px;
    font-size: 10.5px;
    background: var(--course-soft);
    color: var(--course-ink);
    border: none;
  }
  .rail-title {
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
    font-weight: 550;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rail-due {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--muted);
  }
  .rail-empty {
    color: var(--muted);
    font-size: 13px;
  }
</style>
