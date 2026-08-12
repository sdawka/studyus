<script lang="ts">
  import type { CalendarItem } from '../../lib/types/calendar';
  import { hueFor } from '../../lib/courseHue';
  import { addDays, isSameLocalDay, localDateKey, localDateKeyFromIso, timeRangeLabel } from '../../lib/plannerDates';

  interface CourseOption {
    id: string;
    slug: string;
    code: string;
    title: string;
    color: number | null;
  }

  let {
    items,
    weekStart,
    courses,
    compact = false,
    selectedId = null,
    onSelect,
    onSlotClick,
  }: {
    items: CalendarItem[];
    weekStart: string;
    courses: CourseOption[];
    compact?: boolean;
    selectedId?: string | null;
    onSelect?: (item: CalendarItem) => void;
    onSlotClick?: (start: Date) => void;
  } = $props();

  const courseById = new Map(courses.map((c) => [c.id, c]));
  function courseFor(item: CalendarItem) {
    return item.course_id ? courseById.get(item.course_id) : undefined;
  }
  function hueForItem(item: CalendarItem): number {
    const c = courseFor(item);
    return c ? hueFor({ slug: c.slug, color: c.color === null ? null : String(c.color) }) : 220;
  }

  const PX_PER_HOUR = $derived(compact ? 48 : 64);
  const HARD_FLOOR = 6;
  const HARD_CEIL = 23;
  const MIN_SPAN = $derived(compact ? 8 : 12);
  const DEFAULT_START = $derived(compact ? 9 : 8);
  const DEFAULT_END = $derived(compact ? 17 : 20);

  const weekStartDate = $derived(new Date(`${weekStart}T00:00:00`));
  const days = $derived(Array.from({ length: 7 }, (_, i) => addDays(weekStartDate, i)));
  const dayKeys = $derived(days.map((d) => localDateKey(d)));

  // Defensive filter: items belonging to this week, matched by local day key
  // against the visible 7 days (handles items that arrive pre-filtered too).
  const weekItems = $derived.by(() => {
    const keySet = new Set(dayKeys);
    return items.filter((i) => keySet.has(localDateKeyFromIso(i.date)));
  });

  const allDayItems = $derived(weekItems.filter((i) => i.all_day));
  const timedItems = $derived(weekItems.filter((i) => !i.all_day));

  function allDayForDay(dayKey: string): CalendarItem[] {
    return allDayItems.filter((i) => localDateKeyFromIso(i.date) === dayKey);
  }

  interface Timed {
    item: CalendarItem;
    startMs: number;
    endMs: number;
  }

  function timedForDay(dayKey: string): Timed[] {
    return timedItems
      .filter((i) => localDateKeyFromIso(i.date) === dayKey)
      .map((i) => {
        const startMs = Date.parse(i.date);
        const endMs = i.end_date ? Date.parse(i.end_date) : startMs + 30 * 60_000;
        return { item: i, startMs, endMs };
      });
  }

  const bounds = $derived.by(() => {
    let minHour = DEFAULT_START;
    let maxHour = DEFAULT_END;
    for (const i of timedItems) {
      const start = new Date(i.date);
      const end = i.end_date ? new Date(i.end_date) : new Date(start.getTime() + 30 * 60_000);
      minHour = Math.min(minHour, start.getHours() + start.getMinutes() / 60);
      maxHour = Math.max(maxHour, end.getHours() + end.getMinutes() / 60);
    }
    let start = Math.max(HARD_FLOOR, Math.floor(minHour));
    let end = Math.min(HARD_CEIL, Math.ceil(maxHour));
    if (end - start < MIN_SPAN) {
      end = Math.min(HARD_CEIL, start + MIN_SPAN);
      if (end - start < MIN_SPAN) start = Math.max(HARD_FLOOR, end - MIN_SPAN);
    }
    return { start, end };
  });

  const hourTicks = $derived.by(() => {
    const ticks: number[] = [];
    for (let h = bounds.start; h <= bounds.end; h++) ticks.push(h);
    return ticks;
  });

  const gridHeight = $derived((bounds.end - bounds.start) * PX_PER_HOUR);

  function hourLabel(h: number): string {
    const period = h < 12 || h === 24 ? 'AM' : 'PM';
    let hour12 = h % 12;
    if (hour12 === 0) hour12 = 12;
    return `${hour12} ${period}`;
  }

  interface Placed extends Timed {
    col: number;
    totalCols: number;
  }

  function layoutOverlaps(dayItems: Timed[]): Placed[] {
    const sorted = [...dayItems].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    const placed: Placed[] = [];
    let cluster: { t: Timed; col: number }[] = [];
    let activeCols: number[] = [];
    let clusterMaxEnd = -Infinity;

    function flush() {
      if (!cluster.length) return;
      const totalCols = Math.max(...cluster.map((c) => c.col)) + 1;
      for (const c of cluster) placed.push({ ...c.t, col: c.col, totalCols });
      cluster = [];
    }

    for (const t of sorted) {
      if (cluster.length && t.startMs >= clusterMaxEnd) {
        flush();
        activeCols = [];
        clusterMaxEnd = -Infinity;
      }
      let col = 0;
      while (activeCols[col] !== undefined && activeCols[col] > t.startMs) col++;
      activeCols[col] = t.endMs;
      cluster.push({ t, col });
      clusterMaxEnd = Math.max(clusterMaxEnd, t.endMs);
    }
    flush();
    return placed;
  }

  function placedForDay(dayKey: string): Placed[] {
    return layoutOverlaps(timedForDay(dayKey));
  }

  function topFor(ms: number): number {
    const d = new Date(ms);
    const minutesFromBoundStart = (d.getHours() - bounds.start) * 60 + d.getMinutes();
    return (minutesFromBoundStart / 60) * PX_PER_HOUR;
  }
  function heightFor(startMs: number, endMs: number): number {
    const minutes = Math.max(1, (endMs - startMs) / 60_000);
    return Math.max(24, (minutes / 60) * PX_PER_HOUR);
  }

  let now = $state(new Date());
  let nowTimer: ReturnType<typeof setInterval> | undefined;
  $effect(() => {
    nowTimer = setInterval(() => {
      now = new Date();
    }, 60_000);
    return () => clearInterval(nowTimer);
  });

  function isWeekend(d: Date): boolean {
    const dow = d.getDay();
    return dow === 0 || dow === 6;
  }
  function isToday(d: Date): boolean {
    return isSameLocalDay(d, now);
  }
  function nowTop(): number {
    const minutesFromBoundStart = (now.getHours() - bounds.start) * 60 + now.getMinutes();
    return (minutesFromBoundStart / 60) * PX_PER_HOUR;
  }
  const nowVisible = $derived(now.getHours() + now.getMinutes() / 60 >= bounds.start && now.getHours() + now.getMinutes() / 60 <= bounds.end);

  function isPast(endMs: number): boolean {
    return endMs < now.getTime();
  }

  function typeLabel(type: CalendarItem['type']): string {
    switch (type) {
      case 'assessment_due':
        return 'Due';
      case 'task_due':
        return 'Task';
      case 'study_session':
        return 'Study session';
      case 'event_logged':
        return 'Logged';
    }
  }

  // Hover card (internal, presentational — distinct from the click-driven
  // EventPopover PlannerView owns; this is a lightweight 200ms hover peek).
  let hoverItem = $state<CalendarItem | null>(null);
  let hoverPos = $state({ x: 0, y: 0 });
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;

  function onBlockEnter(e: MouseEvent, item: CalendarItem) {
    clearTimeout(hoverTimer);
    const target = e.currentTarget as HTMLElement;
    hoverTimer = setTimeout(() => {
      const rect = target.getBoundingClientRect();
      hoverPos = { x: rect.right + 8, y: rect.top };
      hoverItem = item;
    }, 200);
  }
  function onBlockLeave() {
    clearTimeout(hoverTimer);
    hoverItem = null;
  }

  function detailsSnippet(item: CalendarItem): string | null {
    const d = item.details ?? {};
    if (item.type === 'assessment_due' && typeof d.weight_pct === 'number') return `Worth ${d.weight_pct}% of grade`;
    if (item.type === 'study_session' && typeof d.planned_minutes === 'number') return `${d.planned_minutes} min planned`;
    if (item.type === 'event_logged' && typeof d.kc_name === 'string' && d.kc_name) return d.kc_name;
    return null;
  }

  function handleSlotClick(e: MouseEvent, day: Date) {
    if ((e.target as HTMLElement).closest('.event-block')) return;
    if (!onSlotClick) return;
    const columnEl = e.currentTarget as HTMLElement;
    const rect = columnEl.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const minutesFromStart = (offsetY / PX_PER_HOUR) * 60;
    const snappedMinutes = Math.round(minutesFromStart / 15) * 15;
    const start = new Date(day);
    start.setHours(bounds.start, 0, 0, 0);
    start.setMinutes(start.getMinutes() + snappedMinutes);
    onSlotClick(start);
  }

  const weekHasItems = $derived(weekItems.length > 0);
</script>

<div class="week-grid" class:compact>
  <div class="header-row" style={`--gutter: 56px`}>
    <div class="gutter-cell"></div>
    {#each days as day, i}
      <div class="day-header" class:weekend={isWeekend(day)} class:today={isToday(day)}>
        <span class="wd">{day.toLocaleDateString(undefined, { weekday: 'short' })}</span>
        <span class="dn" class:badge={isToday(day)}>{day.getDate()}</span>
      </div>
    {/each}
  </div>

  <div class="all-day-row">
    <div class="gutter-cell all-day-label">All-day</div>
    {#each dayKeys as dayKey, i}
      <div class="all-day-cell" class:weekend={isWeekend(days[i])}>
        {#each allDayForDay(dayKey) as item (item.id)}
          <button
            type="button"
            class="all-day-pill"
            class:selected={selectedId === item.id}
            data-event-id={item.id}
            style={`--course-h:${hueForItem(item)}`}
            onclick={() => onSelect?.(item)}
            onmouseenter={(e) => onBlockEnter(e, item)}
            onmouseleave={onBlockLeave}
          >
            {item.type === 'assessment_due' ? '◆' : '○'} {item.title}
          </button>
        {/each}
      </div>
    {/each}
  </div>

  {#if !weekHasItems}
    <p class="empty-hint">Nothing scheduled — click any time slot to add a study block.</p>
  {/if}

  <div class="time-body" style={`height:${gridHeight}px`}>
    <div class="hour-gutter">
      {#each hourTicks as h}
        <div class="hour-tick" style={`top:${(h - bounds.start) * PX_PER_HOUR}px`}>
          <span class="num">{hourLabel(h)}</span>
        </div>
      {/each}
    </div>
    <div class="day-columns">
      {#each days as day, i}
        {@const dayKey = dayKeys[i]}
        <div
          class="day-column"
          class:weekend={isWeekend(day)}
          class:today={isToday(day)}
          onclick={(e) => handleSlotClick(e, day)}
        >
          {#each hourTicks as h}
            <div class="hour-line" style={`top:${(h - bounds.start) * PX_PER_HOUR}px`}></div>
          {/each}
          {#if isToday(day) && nowVisible}
            <div class="now-line" style={`top:${nowTop()}px`}>
              <span class="now-dot"></span>
            </div>
          {/if}
          {#each placedForDay(dayKey) as p (p.item.id)}
            {@const top = topFor(p.startMs)}
            {@const height = heightFor(p.startMs, p.endMs)}
            {@const widthPct = 100 / p.totalCols}
            {@const leftPct = p.col * widthPct}
            <button
              type="button"
              class="event-block"
              class:selected={selectedId === p.item.id}
              class:dashed={p.item.type === 'study_session'}
              class:past={isToday(day) && isPast(p.endMs)}
              data-event-id={p.item.id}
              style={`--course-h:${hueForItem(p.item)}; top:${top}px; height:${height}px; left:calc(${leftPct}% + 2px); width:calc(${widthPct}% - 4px);`}
              onclick={() => onSelect?.(p.item)}
              onmouseenter={(e) => onBlockEnter(e, p.item)}
              onmouseleave={onBlockLeave}
            >
              <span class="evt-title">{p.item.title}</span>
              {#if height >= 32}
                <span class="evt-time">{timeRangeLabel(new Date(p.startMs), new Date(p.endMs))}</span>
              {/if}
            </button>
          {/each}
        </div>
      {/each}
    </div>
  </div>
</div>

{#if hoverItem}
  {@const item = hoverItem}
  {@const course = courseFor(item)}
  <div class="hover-card" style={`left:${hoverPos.x}px; top:${hoverPos.y}px; --course-h:${hueForItem(item)}`}>
    <p class="hc-title">{item.title}</p>
    <p class="hc-time">{timeRangeLabel(new Date(item.date), item.end_date ? new Date(item.end_date) : null)}</p>
    {#if course}
      <span class="chip hc-chip">{course.code}</span>
    {/if}
    <p class="hc-type">{typeLabel(item.type)}</p>
    {#if detailsSnippet(item)}
      <p class="hc-detail">{detailsSnippet(item)}</p>
    {/if}
  </div>
{/if}

<style>
  .week-grid {
    display: flex;
    flex-direction: column;
    min-width: 0;
    position: relative;
  }
  .header-row,
  .all-day-row {
    display: grid;
    grid-template-columns: var(--gutter) repeat(7, 1fr);
  }
  .gutter-cell {
    width: var(--gutter, 56px);
  }
  .day-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 6px 4px 8px;
    border-left: 1px solid var(--hairline);
  }
  .day-header.weekend {
    background: color-mix(in oklch, var(--surface-2) 60%, var(--bg));
  }
  .wd {
    font-size: 11px;
    font-weight: 550;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .dn {
    font-size: 17px;
    font-weight: 650;
    font-family: var(--font-body);
    font-variant-numeric: tabular-nums;
  }
  .dn.badge {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-contrast);
  }
  .all-day-row {
    border-top: 1px solid var(--hairline);
    border-bottom: 1px solid var(--border);
    min-height: 30px;
  }
  .all-day-label {
    font-size: 10.5px;
    color: var(--muted);
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-right: 8px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .all-day-cell {
    border-left: 1px solid var(--hairline);
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .all-day-cell.weekend {
    background: color-mix(in oklch, var(--surface-2) 60%, var(--bg));
  }
  .all-day-pill {
    text-align: left;
    font-size: 11.5px;
    font-weight: 550;
    padding: 3px 7px;
    border-radius: 6px;
    background: var(--course-soft);
    color: var(--course-ink);
    border-left: 2px solid var(--course);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .all-day-pill.selected {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
    box-shadow: var(--shadow-pop);
  }
  .empty-hint {
    text-align: center;
    color: var(--muted);
    font-size: 13px;
    padding: 14px 0 4px;
  }
  .time-body {
    position: relative;
    display: grid;
    grid-template-columns: var(--gutter, 56px) 1fr;
  }
  .hour-gutter {
    position: relative;
    width: var(--gutter, 56px);
  }
  .hour-tick {
    position: absolute;
    right: 8px;
    transform: translateY(-6px);
    font-size: 11px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .day-columns {
    position: relative;
    display: grid;
    grid-template-columns: repeat(7, 1fr);
  }
  .day-column {
    position: relative;
    border-left: 1px solid var(--hairline);
    cursor: pointer;
  }
  .day-column.weekend {
    background: color-mix(in oklch, var(--surface-2) 45%, var(--bg));
  }
  .hour-line {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px solid var(--hairline);
    opacity: 0.6;
  }
  .now-line {
    position: absolute;
    left: 0;
    right: 0;
    height: 0;
    border-top: 2px solid var(--danger);
    z-index: 3;
  }
  .now-dot {
    position: absolute;
    left: -4px;
    top: -4px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--danger);
  }
  .event-block {
    position: absolute;
    text-align: left;
    background: var(--course-soft);
    color: var(--course-ink);
    border-left: 2px solid var(--course);
    border-radius: 5px;
    padding: 3px 6px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 1px;
    z-index: 2;
    transition: box-shadow var(--motion-fast) var(--ease);
  }
  .event-block.dashed {
    border-left-style: dashed;
  }
  .event-block.past {
    opacity: 0.6;
  }
  .event-block.selected {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
    box-shadow: var(--shadow-pop);
  }
  .evt-title {
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .evt-time {
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
  }
  .hover-card {
    position: fixed;
    z-index: 60;
    width: 220px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-pop);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    pointer-events: none;
  }
  .hc-title {
    font-size: 13px;
    font-weight: 650;
  }
  .hc-time {
    font-size: 11.5px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .hc-chip {
    align-self: flex-start;
    padding: 2px 8px;
    font-size: 10.5px;
    background: var(--course-soft);
    color: var(--course-ink);
    border: none;
  }
  .hc-type {
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .hc-detail {
    font-size: 11.5px;
    color: var(--text);
  }
</style>
