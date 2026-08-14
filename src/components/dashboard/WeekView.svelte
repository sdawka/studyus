<script lang="ts">
  import { hueFor } from '../../lib/courseHue';
  import WeekGrid from '../planner/WeekGrid.svelte';
  import type { CalendarItem } from '../../lib/types/calendar';

  interface CourseInfo {
    id: string;
    slug: string;
    code: string;
    title: string;
    color: number | null;
  }

  let {
    initialItems,
    courses,
  }: { initialItems: CalendarItem[]; courses: CourseInfo[] } = $props();

  const STORAGE_KEY = 'sb:weekview';

  let expanded = $state(typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) === 'expanded' : false);
  let items = $state<CalendarItem[]>(initialItems);
  let loading = $state(false);
  let loadedExpandedWeek = false;

  function toggle() {
    expanded = !expanded;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, expanded ? 'expanded' : 'collapsed');
    }
    if (expanded && !loadedExpandedWeek) loadExpandedWeek();
  }

  function isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Collapsed view: today-first 7-day window.
  const collapsedDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return d;
  });

  const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

  function courseFor(item: CalendarItem): CourseInfo | undefined {
    return item.course_id ? courses.find((c) => c.id === item.course_id) : undefined;
  }
  function hueForItem(item: CalendarItem): number {
    const c = courseFor(item);
    return c ? hueFor({ slug: c.slug, color: c.color !== null ? String(c.color) : null }) : 220;
  }
  function shortTitle(item: CalendarItem): string {
    const c = courseFor(item);
    return c ? `${c.code} · ${item.title}` : item.title;
  }

  // The generated attend_class task_due IS the class's calendar presence
  // (class sessions themselves stay out of the feed) — its chip renders
  // class-styled and flips its glyph on `details.done`, independent of
  // every other task/assessment/session chip here.
  function isAttendClassItem(item: CalendarItem): boolean {
    return item.type === 'task_due' && item.details.task_type === 'attend_class';
  }
  function chipLabel(item: CalendarItem): string {
    const base = shortTitle(item);
    if (!isAttendClassItem(item)) return base;
    return `${item.details.done ? '●' : '○'} ${base}`;
  }

  const itemsByDay = $derived(collapsedDays.map((d) => items.filter((it) => isSameDay(new Date(it.date), d))));
  const MAX_CHIPS = 4;

  // Monday-start local ISO date, for the WeekGrid contract.
  function mondayOf(d: Date): Date {
    const m = new Date(d);
    const dow = m.getDay(); // 0 = Sun
    const diff = dow === 0 ? -6 : 1 - dow;
    m.setDate(m.getDate() + diff);
    m.setHours(0, 0, 0, 0);
    return m;
  }
  function toIsoDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  const weekStartDate = mondayOf(today);
  const weekStart = toIsoDate(weekStartDate);

  async function loadExpandedWeek() {
    loading = true;
    try {
      const from = new Date(weekStartDate);
      const to = new Date(weekStartDate);
      to.setDate(to.getDate() + 7);
      const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
      const res = await fetch(`/api/v1/calendar?${params.toString()}`);
      const json = await res.json();
      if (res.ok) {
        items = json.data as CalendarItem[];
        loadedExpandedWeek = true;
      }
    } catch {
      // Keep whatever items we already have (the SSR 7-day window) — the
      // expanded grid just won't cover the full Mon-Sun range.
    } finally {
      loading = false;
    }
  }

  function goToPlanner(item: CalendarItem) {
    location.href = `/planner?event=${item.id}&date=${item.date.slice(0, 10)}`;
  }
</script>

<section class="card">
  <div class="card-head">
    <h2>Next 7 days</h2>
    <div class="head-actions">
      <a class="link-more" href="/planner">Open planner →</a>
      <button type="button" class="toggle-btn" onclick={toggle} aria-expanded={expanded}>
        <span class="chevron" class:open={expanded}>›</span>
        {#key expanded}
          <span class="toggle-label">{expanded ? 'Collapse' : 'Expand'}</span>
        {/key}
      </button>
    </div>
  </div>

  <div class="reveal" class:open={!expanded} aria-hidden={expanded}>
    <div class="reveal-inner">
      <div class="week">
        {#each collapsedDays as d, i}
          <div class="day" class:today={isSameDay(d, today)}>
            <div class="dh">
              <span class="wd">{weekdayFmt.format(d)}</span>
              <span class="n num">{d.getDate()}</span>
            </div>
            {#if itemsByDay[i].length === 0}
              <div class="day-empty">—</div>
            {:else}
              {#each itemsByDay[i].slice(0, MAX_CHIPS) as item (item.id)}
                <div
                  class="chip-evt"
                  class:attend-chip={isAttendClassItem(item)}
                  style={`--course-h:${hueForItem(item)}`}
                  title={shortTitle(item)}
                >
                  <span class="t">{chipLabel(item)}</span>
                  {#if !item.all_day}<span class="time">{timeFmt.format(new Date(item.date))}</span>{/if}
                </div>
              {/each}
              {#if itemsByDay[i].length > MAX_CHIPS}
                <div class="overflow">+{itemsByDay[i].length - MAX_CHIPS}</div>
              {/if}
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </div>

  <div class="reveal" class:open={expanded} aria-hidden={!expanded}>
    <div class="reveal-inner">
      {#if loading}<p class="loading">Loading…</p>{/if}
      <WeekGrid {items} {weekStart} {courses} compact={true} onSelect={goToPlanner} />
    </div>
  </div>
</section>

<style>
  .card-head {
    align-items: center;
  }
  .head-actions {
    display: flex;
    align-items: center;
    gap: var(--space-3, 12px);
  }
  .link-more {
    font-size: 12.5px;
    color: var(--muted);
    text-decoration: none;
    font-weight: 560;
    white-space: nowrap;
  }
  .link-more:hover {
    color: var(--accent-ink);
  }
  .toggle-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12.5px;
    font-weight: 560;
    color: var(--muted);
    white-space: nowrap;
  }
  .toggle-btn:hover {
    color: var(--text);
  }
  .toggle-label {
    display: inline-block;
    animation: toggle-label-in var(--motion-base) var(--ease);
  }
  @keyframes toggle-label-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  /* Expand/collapse reveal: grid-template-rows 0fr->1fr morphs the actual
     content height (not a hard swap), fading in sync so the page below
     rides the same animation instead of jumping. */
  .reveal {
    display: grid;
    grid-template-rows: 0fr;
    opacity: 0;
    transition: grid-template-rows var(--motion-base) var(--ease), opacity var(--motion-base) var(--ease);
  }
  .reveal.open {
    grid-template-rows: 1fr;
    opacity: 1;
  }
  .reveal-inner {
    overflow: hidden;
    min-height: 0;
  }
  .chevron {
    display: inline-block;
    transform: rotate(90deg);
    transition: transform var(--motion-base) var(--ease);
  }
  .chevron.open {
    transform: rotate(-90deg);
  }
  .loading {
    color: var(--muted);
    font-size: 13px;
    padding: 8px 0;
  }

  .week {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 8px;
  }
  .day {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    padding: 10px 8px;
    min-height: 128px;
    display: grid;
    gap: 6px;
    align-content: start;
    background: var(--surface-2);
  }
  .day.today {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .dh {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 2px;
  }
  .wd {
    font-size: 10.5px;
    font-weight: 650;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--faint);
  }
  .n {
    font: 650 15px/1 var(--font-display);
    color: var(--text);
  }
  .day.today .wd,
  .day.today .n {
    color: var(--accent-ink);
  }
  .chip-evt {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 7px;
    border-radius: 8px;
    font-size: 11px;
    line-height: 1.3;
    background: var(--course-soft);
    border: 1px solid var(--course);
    color: var(--course-ink);
    overflow: hidden;
  }
  .chip-evt .t {
    font-weight: 560;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }
  .chip-evt .time {
    font-size: 9.5px;
    opacity: 0.75;
    white-space: nowrap;
    flex-shrink: 0;
  }
  /* attend_class's chip is the class period itself, not just a reminder —
     a touch bolder/more saturated than the standard soft task/assessment
     chip. Mixes two existing course tokens rather than adding a new one. */
  .chip-evt.attend-chip {
    background: color-mix(in oklch, var(--course) 22%, var(--course-soft));
    border-width: 1.5px;
    font-weight: 650;
  }
  .overflow {
    font-size: 10.5px;
    color: var(--muted);
    padding: 2px 4px;
  }
  .day-empty {
    font-size: 11.5px;
    color: var(--faint);
    padding: 4px 2px;
  }

  /* Queries the AppShell <main> content container, not the viewport,
     so this fires based on actual available width in both sidebar
     states rather than the raw window size. 680px minus main's 64px
     horizontal padding — @container measures content-box, so the
     written value must subtract that padding to land the breakpoint
     where main's own rendered width actually crosses 680px. */
  @container (max-width: 616px) {
    .week {
      grid-template-columns: repeat(7, minmax(118px, 1fr));
      overflow-x: auto;
      padding-bottom: 4px;
      scroll-snap-type: x proximity;
      -webkit-overflow-scrolling: touch;
    }
    .day {
      scroll-snap-align: start;
      min-height: 112px;
    }
  }
</style>
