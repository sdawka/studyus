<script lang="ts">
  import type { CalendarItem } from '../../lib/types/calendar';
  import { hueFor } from '../../lib/courseHue';
  import {
    addDays,
    addMinutes,
    isSameLocalDay,
    localDateKey,
    localDateKeyFromIso,
    resolvedEventTimes,
    snap15,
    startOfDay,
    timeRangeLabel,
  } from '../../lib/plannerDates';
  import EventHoverCard from './EventHoverCard.svelte';
  import { createEventHoverCard } from './eventHoverCard.svelte.ts';

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
    anchorDate,
    dayCount = $bindable(7),
    onSelect,
    onSlotClick,
  }: {
    items: CalendarItem[];
    weekStart: string;
    courses: CourseOption[];
    compact?: boolean;
    selectedId?: string | null;
    // Local ISO day (yyyy-mm-dd); non-7-day modes show `dayCount` days
    // starting here (today-pinned-leftmost per docs/design/planner-ux.md:11-12),
    // instead of Monday-of-week. Ignored entirely in 7-day mode.
    anchorDate?: string;
    // Bindable, not just readable: this component owns the computation
    // (container-measured off its own rendered width, below), but callers
    // like PlannerView need the live value to size their own chevron/arrow
    // paging step — `bind:dayCount` is how they read it without duplicating
    // the width thresholds.
    dayCount?: number;
    onSelect?: (item: CalendarItem) => void;
    // `end` is only present for a drag-created range (see the pointer drag
    // handlers below) — a plain click/tap always calls this with one arg,
    // same contract as before drag-create existed.
    onSlotClick?: (start: Date, end?: Date) => void;
  } = $props();

  // Container-measured, not @media/@container: this component renders both
  // inside the planner's fixed overlay layer AND inside `main` on the
  // dashboard (WeekView's compact instance) — two different containing
  // blocks, so neither a viewport query nor a @container-against-main query
  // gives a single correct answer. Measuring the component's own rendered
  // width sidesteps that entirely. Width 0 (pre-measurement, first paint)
  // defaults to 7 to avoid a 1-day flash before the ResizeObserver reports.
  let gridWidth = $state(0);
  $effect(() => {
    dayCount = gridWidth === 0 ? 7 : gridWidth < 480 ? 1 : gridWidth < 760 ? 3 : 7;
  });
  // 1-day mode gets a narrower hour gutter (56 is generous when there's only
  // one day column competing for width); 3/7-day keep the original 56.
  const gutterPx = $derived(dayCount === 1 ? 44 : 56);

  const courseById = new Map(courses.map((c) => [c.id, c]));
  function courseFor(item: CalendarItem) {
    return item.course_id ? courseById.get(item.course_id) : undefined;
  }
  function hueForItem(item: CalendarItem): number {
    const c = courseFor(item);
    return c ? hueFor({ slug: c.slug, color: c.color === null ? null : String(c.color) }) : 220;
  }

  const PX_PER_HOUR = $derived(compact ? 56 : 64);
  const HARD_FLOOR = 6;
  const HARD_CEIL = 23;
  // Compact is a summary widget, not a planning surface: trim the window
  // tightly around whatever items actually exist instead of defaulting to
  // a 9-17 workday span. Full planner (non-compact) is untouched below.
  const MIN_SPAN = $derived(compact ? 6 : 12);
  const DEFAULT_START = $derived(compact ? 9 : 8);
  const DEFAULT_END = $derived(compact ? 17 : 20);
  const MIN_BLOCK_HEIGHT = $derived(compact ? 27 : 24);

  // Two-line gate for a block's title+time, recomputed against real box
  // metrics instead of the old flat `height >= 32` guess: content box =
  // block height minus its 3px+3px vertical padding; a title line at 12px/
  // line-height 1.2 is 14.4px, the time line at 10.5px/1.2 is 12.6px, plus
  // the 1px flex gap between them = 28px of content, so anything under
  // padding(6) + 28 = 34px total block height can't fit both without
  // clipping — those blocks show the (vertically centered) title alone.
  const TWO_LINE_THRESHOLD = 34;

  const weekStartDate = $derived(new Date(`${weekStart}T00:00:00`));
  // 7-day mode always shows the calendar week (Monday-anchored, matching the
  // `weekStart` fetch window). 1/3-day modes ignore `weekStart` for display
  // purposes and instead show `dayCount` consecutive days starting at
  // `anchorDate` (default today) — a rolling window, not locked to Sun–Sat,
  // so whatever day the caller is paging toward stays pinned leftmost.
  const days = $derived.by(() => {
    if (dayCount >= 7) return Array.from({ length: 7 }, (_, i) => addDays(weekStartDate, i));
    const anchor = anchorDate ? new Date(`${anchorDate}T00:00:00`) : startOfDay(new Date());
    return Array.from({ length: dayCount }, (_, i) => addDays(anchor, i));
  });
  const dayKeys = $derived(days.map((d) => localDateKey(d)));

  // Defensive filter: items belonging to the visible days, matched by local
  // day key (handles items that arrive pre-filtered too). Also the mechanism
  // that keeps 1/3-day modes showing only their narrower window's items.
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
        // resolvedEventTimes is the class_session-aware resolver (details.
        // start_min/end_min, never the ISO's local getHours()) — see
        // plannerDates.ts. Every other type resolves identically to before.
        const { startMs, endMs: resolvedEndMs } = resolvedEventTimes(i);
        const endMs = resolvedEndMs ?? startMs + 30 * 60_000;
        return { item: i, startMs, endMs };
      });
  }

  const bounds = $derived.by(() => {
    if (compact) {
      // Tightest window containing the actual items, ±1h padding, floored
      // at a MIN_SPAN so a single item doesn't render a cramped sliver.
      if (timedItems.length === 0) {
        return { start: DEFAULT_START, end: Math.min(HARD_CEIL, DEFAULT_START + MIN_SPAN) };
      }
      let minHour = Infinity;
      let maxHour = -Infinity;
      for (const i of timedItems) {
        // resolvedEventTimes, not a raw `new Date(i.date)` — see timedForDay's
        // identical comment; a class_session's window must come from its
        // details.start_min/end_min or the auto-sized hour range comes out wrong.
        const { startMs, endMs: resolvedEndMs } = resolvedEventTimes(i);
        const start = new Date(startMs);
        const end = new Date(resolvedEndMs ?? startMs + 30 * 60_000);
        minHour = Math.min(minHour, start.getHours() + start.getMinutes() / 60);
        maxHour = Math.max(maxHour, end.getHours() + end.getMinutes() / 60);
      }
      let start = Math.max(HARD_FLOOR, Math.floor(minHour) - 1);
      let end = Math.min(HARD_CEIL, Math.ceil(maxHour) + 1);
      if (end - start < MIN_SPAN) {
        end = Math.min(HARD_CEIL, start + MIN_SPAN);
        if (end - start < MIN_SPAN) start = Math.max(HARD_FLOOR, end - MIN_SPAN);
      }
      return { start, end };
    }
    let minHour = DEFAULT_START;
    let maxHour = DEFAULT_END;
    for (const i of timedItems) {
      const { startMs, endMs: resolvedEndMs } = resolvedEventTimes(i);
      const start = new Date(startMs);
      const end = new Date(resolvedEndMs ?? startMs + 30 * 60_000);
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

  // Compact shows a label every 2 hours (indexed from the window start, so
  // the start hour is always labeled) to cut hour-gutter noise; full
  // planner keeps every hour labeled.
  const labelTicks = $derived(compact ? hourTicks.filter((_, i) => i % 2 === 0) : hourTicks);

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
    return Math.max(MIN_BLOCK_HEIGHT, (minutes / 60) * PX_PER_HOUR);
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

  // attend_class task_due pills ARE the class's calendar presence (class
  // sessions themselves stay out of the calendar feed — see calendar.ts) —
  // they must never be suppressed or faded on completion, just filled in.
  // Every other task pill dims + fills on completion like a normal
  // checked-off item. No per-type glyphs either way — the grid stays calm.
  function isAttendClassPill(item: CalendarItem): boolean {
    return item.type === 'task_due' && item.details?.task_type === 'attend_class';
  }
  function pillGlyph(item: CalendarItem): string {
    if (item.type === 'assessment_due') return '◆';
    return item.details?.done === true ? '●' : '○';
  }

  // class_session's attendance glyph on the block itself (unmarked shows
  // nothing — an empty grid slot shouldn't imply "missed").
  function classStatusGlyph(item: CalendarItem): string {
    const status = item.details?.status;
    if (status === 'attended') return '✓';
    if (status === 'missed') return '✗';
    return '';
  }

  // Overlap columns halve (or worse) a block's width; the "Class: "/"Study: "
  // prefix then eats the whole line and ellipsis leaves "Class: …" — cutting
  // the course code, the only distinguishing text. Strip the prefix on shared
  // columns; border style + hue still encode the kind.
  function blockTitle(p: { item: CalendarItem; totalCols: number }): string {
    return p.totalCols > 1 ? p.item.title.replace(/^(Class|Study): /, '') : p.item.title;
  }

  // Hover card (internal, presentational — distinct from the click-driven
  // EventPopover PlannerView owns; this is a lightweight 200ms hover peek).
  // State/positioning lives in the shared hook (v1.6.1 extraction — see
  // eventHoverCard.svelte.ts); this call takes no options, so behavior here
  // is unchanged from before the extraction (same 200ms delay, same edge-flip
  // math). dashboard/WeekView's collapsed chips use the same hook with a
  // shorter delay + a popover-open suppression guard.
  const hoverCard = createEventHoverCard();

  // Shared pixel->Date math for both the plain-click path and drag-create:
  // `clientY` relative to the day column's measured top, clamped to the
  // visible [bounds.start, bounds.end] window, converted to minutes-from-
  // bounds.start and added onto `day` at bounds.start. Callers snap15() the
  // result themselves (click wants the click position snapped; drag wants
  // both endpoints snapped independently).
  function yToDate(day: Date, clientY: number, columnTop: number): Date {
    const offsetY = clientY - columnTop;
    const totalMinutes = (bounds.end - bounds.start) * 60;
    const minutesFromStart = Math.max(0, Math.min(totalMinutes, (offsetY / PX_PER_HOUR) * 60));
    const d = new Date(day);
    d.setHours(bounds.start, 0, 0, 0);
    d.setMinutes(d.getMinutes() + minutesFromStart);
    return d;
  }

  function handleSlotClick(e: MouseEvent, day: Date) {
    // A completed drag (moved past the threshold) already fired onSlotClick
    // from the pointerup handler below — the browser still dispatches this
    // click event afterward (pointerup's target === pointerdown's target),
    // so without this guard every drag would create a slot twice.
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    if ((e.target as HTMLElement).closest('.event-block')) return;
    if (!onSlotClick) return;
    const columnEl = e.currentTarget as HTMLElement;
    const rect = columnEl.getBoundingClientRect();
    const start = snap15(yToDate(day, e.clientY, rect.top));
    onSlotClick(start);
  }

  // Keyboard equivalent of handleSlotClick: a day-column has no clientY to
  // derive a precise slot from, so Enter/Space creates a study block at a
  // sensible default (9 AM) on that day instead. Only reachable when
  // onSlotClick is actually wired (day-columns are otherwise not a tab stop
  // — see the day-column markup below).
  function handleSlotKeydown(e: KeyboardEvent, day: Date) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if ((e.target as HTMLElement).closest('.event-block')) return;
    if (!onSlotClick) return;
    e.preventDefault();
    const start = new Date(day);
    start.setHours(9, 0, 0, 0);
    onSlotClick(start);
  }

  // --- Drag-create ---------------------------------------------------------
  // Vertical pointer-drag on a day column selects a time range with a live
  // ghost block. Mouse only: touch/pen pointers fall straight through to the
  // existing tap-to-create click path above (no drag threshold logic runs
  // for them at all), matching the "touch keeps tap-to-create" requirement
  // without needing a viewport/hover-capability check here.
  interface DragState {
    dayIndex: number;
    day: Date;
    columnTop: number;
    startY: number;
    currentY: number;
    pointerId: number;
    moved: boolean;
  }
  const DRAG_THRESHOLD_PX = 4;
  let dragState = $state<DragState | null>(null);
  // Set by a completed drag so the click event the browser still fires
  // afterward is a no-op (see handleSlotClick's guard above); also set when
  // Escape cancels an in-flight drag, for the same reason.
  let suppressNextClick = false;

  function computeDragRange(state: DragState): { start: Date; end: Date } {
    const lo = Math.min(state.startY, state.currentY);
    const hi = Math.max(state.startY, state.currentY);
    const start = snap15(yToDate(state.day, lo, state.columnTop));
    let end = snap15(yToDate(state.day, hi, state.columnTop));
    if (end.getTime() <= start.getTime()) end = addMinutes(start, 15);
    return { start, end };
  }

  function onColumnPointerDown(e: PointerEvent, day: Date, dayIndex: number) {
    if (!onSlotClick) return;
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.event-block')) return;
    const columnEl = e.currentTarget as HTMLElement;
    const rect = columnEl.getBoundingClientRect();
    columnEl.setPointerCapture(e.pointerId);
    dragState = { dayIndex, day, columnTop: rect.top, startY: e.clientY, currentY: e.clientY, pointerId: e.pointerId, moved: false };
  }

  function onColumnPointerMove(e: PointerEvent) {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    const moved = dragState.moved || Math.abs(e.clientY - dragState.startY) > DRAG_THRESHOLD_PX;
    // Block the outer route-modal Escape-closes-planner handler the instant
    // a real drag starts (see planner.astro / PlannerView's __plannerBlockEscape
    // convention) — an Escape from here on should cancel the drag, not close
    // the whole planner. Reset in endDrag/the keydown handler below.
    if (moved && !dragState.moved) (window as unknown as Record<string, boolean>).__plannerBlockEscape = true;
    dragState = { ...dragState, currentY: e.clientY, moved };
  }

  function endDrag(e: PointerEvent, fire: boolean) {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    const state = dragState;
    dragState = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Already released (e.g. implicit release on pointerup) — nothing to do.
    }
    if (!state.moved) return; // never crossed the drag threshold — let the native click fire normally
    suppressNextClick = true;
    (window as unknown as Record<string, boolean>).__plannerBlockEscape = false;
    if (!fire || !onSlotClick) return;
    const { start, end } = computeDragRange(state);
    onSlotClick(start, end);
  }

  function onColumnPointerUp(e: PointerEvent) {
    endDrag(e, true);
  }
  function onColumnPointerCancel(e: PointerEvent) {
    endDrag(e, false);
  }

  $effect(() => {
    function onKeydown(e: KeyboardEvent) {
      if (e.key !== 'Escape' || !dragState) return;
      suppressNextClick = true;
      dragState = null;
      (window as unknown as Record<string, boolean>).__plannerBlockEscape = false;
    }
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  });

  const weekHasItems = $derived(weekItems.length > 0);
</script>

<div class="week-grid" class:compact bind:clientWidth={gridWidth} style={`--day-count:${dayCount}`}>
  <div class="header-row" style={`--gutter: ${gutterPx}px`}>
    <div class="gutter-cell"></div>
    {#each days as day, i}
      <div class="day-header" class:weekend={isWeekend(day)} class:today={isToday(day)}>
        <span class="wd">{day.toLocaleDateString(undefined, { weekday: 'short' })}</span>
        <span class="dn" class:badge={isToday(day)}>{day.getDate()}</span>
      </div>
    {/each}
  </div>

  <div class="all-day-row" style={`--gutter: ${gutterPx}px`}>
    <div class="gutter-cell all-day-label">All-day</div>
    {#each dayKeys as dayKey, i}
      <div class="all-day-cell" class:weekend={isWeekend(days[i])}>
        {#each allDayForDay(dayKey) as item (item.id)}
          <button
            type="button"
            class="all-day-pill"
            class:selected={selectedId === item.id}
            class:pill-done={item.type === 'task_due' && !isAttendClassPill(item) && item.details?.done === true}
            data-event-id={item.id}
            style={`--course-h:${hueForItem(item)}`}
            onclick={() => onSelect?.(item)}
            onmouseenter={(e) => hoverCard.onEnter(e, item)}
            onmouseleave={() => hoverCard.onLeave()}
          >
            {pillGlyph(item)} {item.title}
          </button>
        {/each}
      </div>
    {/each}
  </div>

  {#if !weekHasItems}
    <p class="empty-hint">Nothing scheduled — click or drag a time slot to add a study block.</p>
  {/if}

  <div class="time-body" style={`height:${gridHeight}px; --gutter: ${gutterPx}px`}>
    <div class="hour-gutter">
      {#each labelTicks as h}
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
          class:dragging={!!dragState && dragState.dayIndex === i && dragState.moved}
          role={onSlotClick ? 'button' : undefined}
          tabindex={onSlotClick ? 0 : undefined}
          aria-label={onSlotClick ? `Add study block on ${day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}` : undefined}
          onclick={(e) => handleSlotClick(e, day)}
          onkeydown={(e) => handleSlotKeydown(e, day)}
          onpointerdown={(e) => onColumnPointerDown(e, day, i)}
          onpointermove={onColumnPointerMove}
          onpointerup={onColumnPointerUp}
          onpointercancel={onColumnPointerCancel}
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
            {@const twoLine = height >= TWO_LINE_THRESHOLD}
            {@const statusGlyph = p.item.type === 'class_session' ? classStatusGlyph(p.item) : ''}
            <button
              type="button"
              class="event-block"
              class:selected={selectedId === p.item.id}
              class:dashed={p.item.type === 'study_session'}
              class:past={isToday(day) && isPast(p.endMs)}
              class:one-line={!twoLine}
              class:overlap={p.totalCols > 1}
              data-event-id={p.item.id}
              style={`--course-h:${hueForItem(p.item)}; top:${top}px; height:${height}px; left:calc(${leftPct}% + 2px); width:calc(${widthPct}% - 4px);`}
              onclick={() => onSelect?.(p.item)}
              onmouseenter={(e) => hoverCard.onEnter(e, p.item)}
              onmouseleave={() => hoverCard.onLeave()}
            >
              <span class="evt-title">{#if statusGlyph}<span class="evt-status">{statusGlyph}</span>{/if}{blockTitle(p)}</span>
              {#if twoLine}
                <span class="evt-time">{timeRangeLabel(new Date(p.startMs), new Date(p.endMs))}</span>
              {/if}
            </button>
          {/each}
          {#if dragState && dragState.dayIndex === i && dragState.moved}
            {@const range = computeDragRange(dragState)}
            <div
              class="drag-ghost"
              style={`top:${topFor(range.start.getTime())}px; height:${heightFor(range.start.getTime(), range.end.getTime())}px;`}
            >
              <span class="ghost-label">{timeRangeLabel(range.start, range.end)}</span>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>

{#if hoverCard.item}
  {@const item = hoverCard.item}
  <EventHoverCard {item} pos={hoverCard.pos} course={courseFor(item)} />
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
    /* --gutter is set inline only on .header-row; .all-day-row is its
       sibling, not a descendant, so it never inherits that value.
       Without this fallback the var() reference is invalid, the whole
       grid-template-columns declaration drops to `none`, and every
       all-day item collapses into one full-width column instead of
       its actual day. */
    grid-template-columns: var(--gutter, 56px) repeat(var(--day-count, 7), 1fr);
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
    /* Flex item of .all-day-cell; without this its default min-width:auto
       (driven by the nowrap title's own content) keeps it from shrinking
       below its natural width, defeating the overflow/ellipsis below —
       latent until the --gutter fallback fix made cells properly narrow. */
    min-width: 0;
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
  /* Completed regular tasks fade like a checked-off item; attend_class
     pills never get this class (see isAttendClassPill) — they're the
     class's calendar presence, not a to-do, so they stay at full opacity
     when done instead of fading out. */
  .all-day-pill.pill-done {
    opacity: 0.6;
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
  /* Compact is a summary widget: fewer, slightly bolder hour labels (every
     2h, set in script) read more calmly than a full dense hourly gutter. */
  .week-grid.compact .hour-tick {
    font-size: 11.5px;
    font-weight: var(--weight-med, 500);
  }
  /* Last-resort cap — the compact window is trimmed to items ± 1h (min
     6h), so most days land well under this; it only catches a true
     outlier (e.g. one item at 6am and another near midnight) so the
     widget scrolls internally instead of blowing out the dashboard. */
  .week-grid.compact .time-body {
    max-height: 620px;
    overflow-y: auto;
  }
  .day-columns {
    position: relative;
    display: grid;
    grid-template-columns: repeat(var(--day-count, 7), 1fr);
  }
  .day-column {
    position: relative;
    border-left: 1px solid var(--hairline);
    cursor: pointer;
  }
  .day-column.weekend {
    background: color-mix(in oklch, var(--surface-2) 45%, var(--bg));
  }
  /* Active drag: suppress text selection (no preventDefault on the pointer
     handlers themselves — that would also swallow the mouse-compat events
     PlannerView's capture-phase mousedown listener relies on for popover
     anchoring) and swap the cursor to signal the vertical drag. */
  .day-column.dragging {
    cursor: ns-resize;
    user-select: none;
  }
  .drag-ghost {
    position: absolute;
    left: 2px;
    right: 2px;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in oklch, var(--accent) 16%, var(--surface));
    border: 1.5px dashed var(--accent);
    border-radius: 5px;
    pointer-events: none;
  }
  .ghost-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--accent-ink);
    font-variant-numeric: tabular-nums;
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
    border-top: 2px solid var(--now-line-color, var(--danger));
    box-shadow: var(--now-line-glow, none);
    z-index: 3;
  }
  .now-dot {
    position: absolute;
    left: -4px;
    top: -4px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--now-line-color, var(--danger));
    box-shadow: var(--now-line-glow, none);
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
  /* Short blocks (30-min/15-min) show the title alone — see TWO_LINE_THRESHOLD
     in the script — and read better vertically centered in the remaining
     content box than pinned to the top like the two-line layout below. */
  .event-block.one-line {
    justify-content: center;
  }
  .evt-title {
    font-size: 12px;
    font-weight: 600;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Overlap columns halve a block's width; even the prefix-stripped title
     ("CHEE 310") ellipsizes at ~55px. Two-line wrap keeps the whole code
     visible ("CHEE" / "310") — but only on tall-enough blocks, where the
     script's twoLine gate already guarantees the vertical room. */
  .event-block.overlap:not(.one-line) .evt-title {
    white-space: normal;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow-wrap: anywhere;
  }
  .evt-status {
    margin-right: 3px;
  }
  .evt-time {
    font-size: 10.5px;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
  }
  /* Hover-card markup/styles live in EventHoverCard.svelte (v1.6.1
     extraction) — rendered as a sibling component below, not inline here. */
</style>
