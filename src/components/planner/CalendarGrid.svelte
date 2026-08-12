<script lang="ts">
  import { hueFor } from '../../lib/courseHue';

  interface CalendarItem {
    id: string;
    type: 'assessment_due' | 'task_due';
    title: string;
    date: string;
    course_id: string | null;
    details: Record<string, unknown>;
  }
  interface CourseInfo {
    code: string;
    slug: string;
    color: string | null;
  }

  let {
    cells,
    courseById,
  }: {
    cells: { date: Date | null; items: CalendarItem[] }[];
    courseById: Map<string, CourseInfo>;
  } = $props();

  const today = new Date();

  function isToday(d: Date | null): boolean {
    if (!d) return false;
    return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  }
  function courseFor(item: CalendarItem): CourseInfo | undefined {
    return item.course_id ? courseById.get(item.course_id) : undefined;
  }
  function hueForItem(item: CalendarItem): number {
    const c = courseFor(item);
    return c ? hueFor(c) : 220;
  }
  function labelFor(item: CalendarItem): string {
    const code = courseFor(item)?.code;
    return code ? `${code} ${item.title}` : item.title;
  }
</script>

<div class="month-grid">
  {#each ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as wd}
    <div class="weekday">{wd}</div>
  {/each}
  {#each cells as cell}
    <div class="day-cell" class:empty={!cell.date} class:today={isToday(cell.date)}>
      {#if cell.date}
        <div class="day-number num">{cell.date.getDate()}</div>
        {#each cell.items as item (item.id)}
          <div class="chip-evt" style={`--course-h:${hueForItem(item)}`} title={labelFor(item)}>
            <span class="dot"></span>{labelFor(item)}
          </div>
        {/each}
      {/if}
    </div>
  {/each}
</div>

<style>
  .month-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 1px;
    background: var(--border);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  .weekday {
    background: var(--surface-2);
    padding: 8px;
    font-size: 0.72rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    text-align: center;
  }
  .day-cell {
    background: var(--surface);
    min-height: 6.5rem;
    padding: 0.4rem;
    font-size: 0.78rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .day-cell.empty {
    background: var(--bg);
  }
  .day-cell.today {
    background: var(--accent-soft);
  }
  .day-number {
    font-weight: 650;
    color: var(--text);
    margin-bottom: 0.2rem;
  }
  .day-cell.today .day-number {
    color: var(--accent-ink);
  }
  .chip-evt {
    display: flex;
    align-items: center;
    gap: 5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-radius: 6px;
    padding: 2px 6px;
    background: var(--course-soft);
    color: var(--course-ink);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--course);
    flex-shrink: 0;
  }

  @media (max-width: 720px) {
    .month-grid {
      font-size: 0.7rem;
    }
    .day-cell {
      min-height: 4.5rem;
    }
  }
</style>
