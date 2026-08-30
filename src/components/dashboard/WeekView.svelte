<script lang="ts">
  import { tick } from 'svelte';
  import { courseForItem, hueForItem } from '../../lib/courseHue';
  import WeekGrid from '../planner/WeekGrid.svelte';
  import EventPopover from '../planner/EventPopover.svelte';
  import CreateSessionPopover from '../planner/CreateSessionPopover.svelte';
  import EventHoverCard from '../planner/EventHoverCard.svelte';
  import { createEventHoverCard } from '../planner/eventHoverCard.svelte.ts';
  import { apiFetch } from '../../lib/apiClient';
  import { calendarItemStartLabel } from '../../lib/plannerDates';
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

  const courseById = new Map(courses.map((c) => [c.id, c]));

  const STORAGE_KEY = 'sb:weekview';

  let expanded = $state(typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) === 'expanded' : false);
  let items = $state<CalendarItem[]>(initialItems);
  let loading = $state(false);
  let loadedExpandedWeek = false;

  // In-place event detail + create popovers for the expanded grid — mirrors
  // PlannerView's own state, scoped to this widget instead of a route-level
  // overlay. Selecting an item here no longer navigates away (see the old
  // goToPlanner, replaced by plannerLinkFor below): the popover opens right
  // over the grid, with an "Open in planner" link inside it for anyone who
  // wants the full surface.
  let rootEl = $state<HTMLElement | null>(null);
  let selectedItem = $state<CalendarItem | null>(null);
  let popoverAnchor = $state<{ x: number; y: number; width: number; height: number } | null>(null);
  let showPopover = $state(false);
  let createSlot = $state<Date | null>(null);
  let createSlotEnd = $state<Date | null>(null);
  let createAnchor = $state<{ x: number; y: number; width: number; height: number } | null>(null);
  let lastPointerPos = { x: 0, y: 0 };

  // Collapsed-chip hover peek (v1.6.1) — same hook WeekGrid's own event
  // blocks use (see eventHoverCard.svelte.ts), just a shorter delay and a
  // suppression guard so it never fights the click-opened EventPopover below.
  const chipHoverCard = createEventHoverCard({ delayMs: 150, suppressed: () => showPopover });

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

  function shortTitle(item: CalendarItem): string {
    const c = courseForItem(item, courseById);
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
    if (item.type === 'class_session') {
      // "CODE · Class: CODE" (or a bare "Class: …") truncates to nothing at
      // 7-column chip width — show status glyph + course code; the chip's
      // time slot and hue carry the rest. Full text stays in the tooltip.
      const code = courseForItem(item, courseById)?.code ?? item.title.replace(/^Class: /, '');
      const status = item.details?.status;
      const glyph = status === 'attended' ? '✓ ' : status === 'missed' ? '✗ ' : '';
      return `${glyph}${code}`;
    }
    const base = shortTitle(item);
    if (!isAttendClassItem(item)) return base;
    return `${item.details.done ? '●' : '○'} ${base}`;
  }

  const itemsByDay = $derived(collapsedDays.map((d) => items.filter((it) => isSameDay(new Date(it.date), d))));
  const MAX_CHIPS = 4;

  function toIsoDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // Rolling window from today, NOT mondayOf(today): this widget is "Next 7
  // days" — the collapsed chips, the SSR item window, and the compact grid's
  // sub-7-day rolling display all anchor on today. A Monday-anchored fetch
  // here silently dropped items on days the rolling display shows but the
  // calendar-week window doesn't cover (e.g. next Monday's classes, viewed
  // on a Saturday) — the expanded grid rendered them as empty columns.
  const weekStartDate = new Date(today);
  weekStartDate.setHours(0, 0, 0, 0);
  const weekStart = toIsoDate(weekStartDate);

  // `force` re-fetches even after the initial load already ran — used after
  // a create/delete in the popovers below, where the SSR/first-expand items
  // array is stale by definition (a brand-new item can't be in it yet).
  async function loadExpandedWeek(force = false) {
    if (loadedExpandedWeek && !force) return;
    loading = true;
    const from = new Date(weekStartDate);
    const to = new Date(weekStartDate);
    to.setDate(to.getDate() + 7);
    const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    const result = await apiFetch<CalendarItem[]>(`/api/v1/calendar?${params.toString()}`);
    if (result.ok) {
      items = result.data;
      loadedExpandedWeek = true;
    }
    // On failure, keep whatever items we already have (the SSR 7-day window)
    // — the expanded grid just won't cover the full Mon-Sun range.
    loading = false;
  }

  function plannerLinkFor(item: CalendarItem): string {
    return `/planner?event=${item.id}&date=${item.date.slice(0, 10)}`;
  }

  function closePopover() {
    showPopover = false;
    selectedItem = null;
  }

  async function selectItem(item: CalendarItem) {
    // A hover card may already be showing on the exact chip being clicked
    // (no guaranteed mouseleave before the popover covers it) — dismiss it
    // immediately rather than relying on the suppressed() re-check, which
    // only guards a hover that hasn't started rendering yet.
    chipHoverCard.hide();
    selectedItem = item;
    await tick();
    const target = rootEl?.querySelector<HTMLElement>(`[data-event-id="${item.id}"]`);
    if (target) {
      const r = target.getBoundingClientRect();
      popoverAnchor = { x: r.left, y: r.top, width: r.width, height: r.height };
    } else {
      popoverAnchor = { x: window.innerWidth / 2 - 20, y: window.innerHeight / 2 - 20, width: 40, height: 40 };
    }
    showPopover = true;
  }

  function closeCreate() {
    createSlot = null;
    createSlotEnd = null;
    createAnchor = null;
  }

  function handleSlotClick(start: Date, end?: Date) {
    closePopover();
    createSlot = start;
    createSlotEnd = end ?? null;
    createAnchor = { x: lastPointerPos.x, y: lastPointerPos.y, width: 0, height: 0 };
  }

  function handleCreated() {
    void loadExpandedWeek(true);
  }

  function handleTaskToggled(itemId: string, done: boolean) {
    items = items.map((i) => (i.id === itemId ? { ...i, details: { ...i.details, done } } : i));
    if (selectedItem?.id === itemId) selectedItem = { ...selectedItem, details: { ...selectedItem.details, done } };
  }

  function handleItemUpdated(itemId: string, patch: Partial<CalendarItem>) {
    items = items.map((i) => (i.id === itemId ? { ...i, ...patch, details: patch.details ? { ...i.details, ...patch.details } : i.details } : i));
    if (selectedItem?.id === itemId) {
      selectedItem = {
        ...selectedItem,
        ...patch,
        details: patch.details ? { ...selectedItem.details, ...patch.details } : selectedItem.details,
      };
    }
  }

  $effect(() => {
    function onPointerDown(e: MouseEvent) {
      lastPointerPos = { x: e.clientX, y: e.clientY };
    }
    rootEl?.addEventListener('mousedown', onPointerDown, true);
    return () => rootEl?.removeEventListener('mousedown', onPointerDown, true);
  });
</script>

<section class="card" bind:this={rootEl}>
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
                <button
                  type="button"
                  class="chip-evt"
                  class:attend-chip={isAttendClassItem(item)}
                  class:selected={selectedItem?.id === item.id}
                  style={`--course-h:${hueForItem(item, courseById)}`}
                  data-event-id={item.id}
                  onclick={() => selectItem(item)}
                  onmouseenter={(e) => chipHoverCard.onEnter(e, item)}
                  onmouseleave={() => chipHoverCard.onLeave()}
                >
                  <span class="t">{chipLabel(item)}</span>
                  {#if !item.all_day}<span class="time">{calendarItemStartLabel(item)}</span>{/if}
                </button>
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
      <WeekGrid
        {items}
        {weekStart}
        {courses}
        compact={true}
        selectedId={selectedItem?.id ?? null}
        onSelect={selectItem}
        onSlotClick={handleSlotClick}
      />
    </div>
  </div>
</section>

{#if chipHoverCard.item}
  {@const hoverItem = chipHoverCard.item}
  <EventHoverCard item={hoverItem} pos={chipHoverCard.pos} course={courseForItem(hoverItem, courseById)} />
{/if}

{#if showPopover && selectedItem && popoverAnchor}
  <!-- Keyed by item id — see PlannerView's identical comment: reuse of this
       component instance across a direct item-to-item click would otherwise
       carry over its per-item $state (note draft, delete-confirm step). -->
  {#key selectedItem.id}
    <EventPopover
      item={selectedItem}
      course={courseForItem(selectedItem, courseById)}
      anchorRect={popoverAnchor}
      onClose={closePopover}
      onDeleted={() => void loadExpandedWeek(true)}
      onTaskToggled={handleTaskToggled}
      onItemUpdated={handleItemUpdated}
      plannerLink={plannerLinkFor(selectedItem)}
    />
  {/key}
{/if}

{#if createSlot && createAnchor}
  <!-- See PlannerView's identical comment: keeps type/title/duration state
       (and the drag-derived initial duration) from carrying over between
       two different slot selections made without closing in between. -->
  {#key `${createSlot.getTime()}-${createSlotEnd?.getTime() ?? 0}`}
    <CreateSessionPopover start={createSlot} end={createSlotEnd} anchorRect={createAnchor} {courses} onClose={closeCreate} onCreated={handleCreated} />
  {/key}
{/if}

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
    /* Was a plain <div>; now an interactive <button> (v1.6.1, hover-card +
       click-to-popover) — these reset the UA button chrome the markup
       change would otherwise introduce. Every other declaration here is
       unchanged from before the conversion. */
    appearance: none;
    width: 100%;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 7px;
    border-radius: var(--radius-sm);
    font-size: 11px;
    line-height: 1.3;
    background: var(--course-soft);
    border: 1px solid var(--course);
    color: var(--course-ink);
    overflow: hidden;
  }
  .chip-evt.selected {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
    box-shadow: var(--shadow-pop);
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
