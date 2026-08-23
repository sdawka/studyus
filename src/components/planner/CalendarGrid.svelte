<script lang="ts">
  import type { CalendarItem } from '../../lib/types/calendar';
  import { hueFor } from '../../lib/courseHue';

  interface CourseInfo {
    code: string;
    slug: string;
    color: number | null;
  }

  let {
    cells,
    courseById,
    selectedId = null,
    onSelect,
    onDayTap,
  }: {
    cells: { date: Date | null; items: CalendarItem[] }[];
    courseById: Map<string, CourseInfo>;
    selectedId?: string | null;
    onSelect?: (item: CalendarItem) => void;
    // Month is an overview/jump surface on mobile: tapping a day (not one of
    // its event chips) jumps to Agenda scrolled to that date, rather than
    // trying to cram event detail into a ~4-row cell. PlannerView only wires
    // this up when $isMobile — desktop keeps today's "chips only" behavior.
    onDayTap?: (date: Date) => void;
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
    return c ? hueFor({ slug: c.slug, color: c.color === null ? null : String(c.color) }) : 220;
  }
  function labelFor(item: CalendarItem): string {
    const code = courseFor(item)?.code;
    return code ? `${code} ${item.title}` : item.title;
  }

  function handleCellClick(e: MouseEvent, date: Date | null) {
    if (!date || !onDayTap) return;
    if ((e.target as HTMLElement).closest('.chip-evt')) return;
    onDayTap(date);
  }

  // Keyboard equivalent of handleCellClick. Only reachable when onDayTap is
  // wired (day-cells are otherwise not a tab stop — see the day-cell markup
  // below); the chip-evt buttons inside a cell handle their own Enter/Space
  // natively, so this only needs to guard against activating on top of one.
  function handleCellKeydown(e: KeyboardEvent, date: Date | null) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (!date || !onDayTap) return;
    if ((e.target as HTMLElement).closest('.chip-evt')) return;
    e.preventDefault();
    onDayTap(date);
  }
</script>

<div class="month-grid">
  {#each ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as wd}
    <div class="weekday">{wd}</div>
  {/each}
  {#each cells as cell}
    <div
      class="day-cell"
      class:empty={!cell.date}
      class:today={isToday(cell.date)}
      class:tappable={cell.date && onDayTap}
      role={cell.date && onDayTap ? 'button' : undefined}
      tabindex={cell.date && onDayTap ? 0 : undefined}
      aria-label={cell.date && onDayTap ? `Jump to agenda for ${cell.date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}` : undefined}
      onclick={(e) => handleCellClick(e, cell.date)}
      onkeydown={(e) => handleCellKeydown(e, cell.date)}
    >
      {#if cell.date}
        <div class="day-number num">{cell.date.getDate()}</div>
        {#each cell.items as item (item.id)}
          <button
            type="button"
            class="chip-evt"
            class:selected={selectedId === item.id}
            data-event-id={item.id}
            style={`--course-h:${hueForItem(item)}`}
            title={labelFor(item)}
            onclick={() => onSelect?.(item)}
          >
            <span class="dot"></span>{labelFor(item)}
          </button>
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
  .day-cell.tappable {
    cursor: pointer;
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
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-radius: var(--radius-sm);
    padding: 2px 6px;
    background: var(--course-soft);
    color: var(--course-ink);
    text-align: left;
  }
  .chip-evt.selected {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
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
      min-height: 3.2rem;
    }
    /* Chips degrade to plain dots: font-size:0 collapses the label text to
       nothing (the dot span keeps its explicit px size, so it stays
       visible) without touching markup — a cell just reads as "N dots" at
       a glance instead of trying to fit N truncated labels in ~3rem. */
    .chip-evt {
      font-size: 0;
      gap: 0;
      padding: 2px;
      width: auto;
    }
  }
</style>
