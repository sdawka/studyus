<script lang="ts">
  import { tick } from 'svelte';
  import WeekGrid from './WeekGrid.svelte';
  import CalendarGrid from './CalendarGrid.svelte';
  import AgendaList from './AgendaList.svelte';
  import PlannerRail from './PlannerRail.svelte';
  import EventPopover from './EventPopover.svelte';
  import CreateSessionPopover from './CreateSessionPopover.svelte';
  import type { CalendarItem } from '../../lib/types/calendar';
  import { addDays, addMonths, firstOfMonth, localDateKey, mondayOf, weekRangeLabel } from '../../lib/plannerDates';

  interface CourseOption {
    id: string;
    slug: string;
    code: string;
    title: string;
    term: string | null;
    color: number | null;
  }

  let {
    courses,
    currentTerm,
    initialItems,
    initialAnchor,
    deepLinkEventId,
  }: {
    courses: CourseOption[];
    currentTerm: string | null;
    initialItems: CalendarItem[];
    initialAnchor?: string;
    deepLinkEventId?: string | null;
  } = $props();

  const courseById = new Map(courses.map((c) => [c.id, c]));
  const currentTermCourseIds = new Set(courses.filter((c) => c.term === currentTerm).map((c) => c.id));

  type FilterMode = 'current_term' | 'all' | string; // string = specific course id
  type View = 'week' | 'month' | 'agenda';

  let filter = $state<FilterMode>(currentTerm ? 'current_term' : 'all');
  let view = $state<View>('week');

  const seedAnchor = initialAnchor && !Number.isNaN(Date.parse(initialAnchor)) ? new Date(initialAnchor) : new Date();
  let weekStart = $state(mondayOf(new Date()));
  let monthAnchor = $state(firstOfMonth(seedAnchor));

  let items = $state<CalendarItem[]>(initialItems);
  let railItems = $state<CalendarItem[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  let selectedId = $state<string | null>(null);
  let selectedItem = $state<CalendarItem | null>(null);
  let popoverAnchor = $state<{ x: number; y: number; width: number; height: number } | null>(null);
  let showPopover = $state(false);

  let createSlot = $state<Date | null>(null);
  let createAnchor = $state<{ x: number; y: number; width: number; height: number } | null>(null);

  let rootEl = $state<HTMLElement | null>(null);
  let pendingSelectItem: CalendarItem | null = null;
  let lastPointerPos = { x: 0, y: 0 };
  let didDeepLink = false;

  const courseParam = $derived(filter !== 'current_term' && filter !== 'all' ? filter : undefined);

  const weekStartKey = $derived(localDateKey(weekStart));

  const visibleItems = $derived(
    filter === 'current_term' ? items.filter((i) => i.course_id === null || currentTermCourseIds.has(i.course_id)) : items,
  );

  async function loadWeek() {
    loading = true;
    error = null;
    try {
      const from = weekStart;
      const to = addDays(weekStart, 7);
      const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
      if (courseParam) params.set('course', courseParam);
      const res = await fetch(`/api/v1/calendar?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        error = json?.error?.message ?? 'Could not load calendar.';
        return;
      }
      items = json.data as CalendarItem[];
      if (pendingSelectItem) {
        const item = pendingSelectItem;
        pendingSelectItem = null;
        await selectItem(item);
      }
    } catch {
      error = 'Network error, please try again.';
    } finally {
      loading = false;
    }
  }

  async function loadMonth() {
    loading = true;
    error = null;
    try {
      const from = monthAnchor;
      const to = addMonths(monthAnchor, 1);
      const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
      if (courseParam) params.set('course', courseParam);
      const res = await fetch(`/api/v1/calendar?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        error = json?.error?.message ?? 'Could not load calendar.';
        return;
      }
      items = json.data as CalendarItem[];
    } catch {
      error = 'Network error, please try again.';
    } finally {
      loading = false;
    }
  }

  async function loadRail() {
    try {
      const from = addDays(new Date(), -30);
      const to = addDays(new Date(), 7);
      const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
      if (courseParam) params.set('course', courseParam);
      const res = await fetch(`/api/v1/calendar?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) return;
      railItems = (json.data as CalendarItem[]).filter((i) => i.type === 'assessment_due' || i.type === 'task_due');
    } catch {
      // Rail is a secondary surface — a failed fetch just leaves it empty.
    }
  }

  const visibleRailItems = $derived(
    filter === 'current_term' ? railItems.filter((i) => i.course_id === null || currentTermCourseIds.has(i.course_id)) : railItems,
  );

  $effect(() => {
    // Depends on weekStart, monthAnchor, view, courseParam.
    if (view === 'week') void loadWeek();
    else void loadMonth();
  });

  $effect(() => {
    void loadRail();
  });

  function shiftWeek(delta: number) {
    weekStart = addDays(weekStart, delta * 7);
  }
  function shiftMonth(delta: number) {
    monthAnchor = addMonths(monthAnchor, delta);
  }
  function goToday() {
    if (view === 'week') weekStart = mondayOf(new Date());
    else monthAnchor = firstOfMonth(new Date());
  }
  const isTodayInView = $derived.by(() => {
    if (view === 'week') return weekStartKey === localDateKey(mondayOf(new Date()));
    const now = new Date();
    return monthAnchor.getFullYear() === now.getFullYear() && monthAnchor.getMonth() === now.getMonth();
  });

  const rangeLabel = $derived(
    view === 'week' ? weekRangeLabel(weekStart) : monthAnchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
  );

  function dayKey(iso: string): string {
    return localDateKey(new Date(iso));
  }

  const monthCells = $derived.by(() => {
    const startWeekday = monthAnchor.getDay();
    const daysInMonth = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 0).getDate();
    const itemsByDay = new Map<string, CalendarItem[]>();
    for (const item of visibleItems) {
      const key = dayKey(item.date);
      const list = itemsByDay.get(key) ?? [];
      list.push(item);
      itemsByDay.set(key, list);
    }
    const cells: { date: Date | null; items: CalendarItem[] }[] = [];
    for (let i = 0; i < startWeekday; i++) cells.push({ date: null, items: [] });
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), day);
      cells.push({ date, items: itemsByDay.get(localDateKey(date)) ?? [] });
    }
    return cells;
  });

  const agendaItems = $derived([...visibleItems].sort((a, b) => a.date.localeCompare(b.date)));

  function updateUrl(id: string | null) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('event', id);
    else url.searchParams.delete('event');
    history.replaceState(null, '', url.pathname + (url.search ? url.search : ''));
  }

  async function selectItem(item: CalendarItem) {
    selectedId = item.id;
    selectedItem = item;
    closeCreate();
    await tick();
    const el = rootEl?.querySelector<HTMLElement>(`[data-event-id="${item.id}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      popoverAnchor = { x: r.left, y: r.top, width: r.width, height: r.height };
      el.scrollIntoView({ block: 'nearest' });
    } else {
      popoverAnchor = { x: window.innerWidth / 2 - 20, y: window.innerHeight / 2 - 20, width: 40, height: 40 };
    }
    showPopover = true;
    (window as any).__plannerBlockEscape = true;
    updateUrl(item.id);
  }

  function closePopover() {
    showPopover = false;
    selectedId = null;
    selectedItem = null;
    (window as any).__plannerBlockEscape = false;
    updateUrl(null);
  }

  function closeCreate() {
    createSlot = null;
    createAnchor = null;
    (window as any).__plannerBlockEscape = false;
  }

  function handleSlotClick(start: Date) {
    closePopover();
    createSlot = start;
    createAnchor = { x: lastPointerPos.x, y: lastPointerPos.y, width: 0, height: 0 };
    (window as any).__plannerBlockEscape = true;
  }

  function handleSessionCreated() {
    if (view === 'week') void loadWeek();
    else void loadMonth();
  }

  function handleRailJump(date: Date, item: CalendarItem) {
    view = 'week';
    weekStart = mondayOf(date);
    pendingSelectItem = item;
  }

  // EventPopover's checkbox already flips its own `item` copy optimistically,
  // but `items` (WeekGrid) and `railItems` (PlannerRail) came from two
  // separate /calendar fetches — distinct object instances for the same
  // task — so the popover's local mutation doesn't reach either array on
  // its own. Update both explicitly (new array + object identities) so
  // PlannerRail's `details.done` filter and WeekGrid's fill state re-derive.
  function handleTaskToggled(itemId: string, done: boolean) {
    const patch = (list: CalendarItem[]) =>
      list.map((i) => (i.id === itemId ? { ...i, details: { ...i.details, done } } : i));
    items = patch(items);
    railItems = patch(railItems);
    if (selectedItem?.id === itemId) {
      selectedItem = { ...selectedItem, details: { ...selectedItem.details, done } };
    }
  }

  function onFilterChange() {
    void loadRail();
  }

  // --- Deep-link resolution (?event=<id>) ---------------------------------
  async function resolveDeepLink(id: string) {
    let found = initialItems.find((i) => i.id === id);
    if (!found) {
      try {
        const from = addDays(new Date(), -60);
        const to = addDays(new Date(), 180);
        const res = await fetch(`/api/v1/calendar?from=${from.toISOString()}&to=${to.toISOString()}`);
        const json = await res.json();
        if (res.ok) found = (json.data as CalendarItem[]).find((i) => i.id === id);
      } catch {
        // Give up quietly — deep link just won't resolve.
      }
    }
    if (!found) return;
    view = 'week';
    weekStart = mondayOf(new Date(found.date));
    pendingSelectItem = found;
  }

  $effect(() => {
    if (didDeepLink || !deepLinkEventId) return;
    didDeepLink = true;
    void resolveDeepLink(deepLinkEventId);
  });

  // --- Keyboard shortcuts: t / arrows / Esc, inactive while typing --------
  function isTypingTarget(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (showPopover) closePopover();
      else if (createSlot) closeCreate();
      return;
    }
    if (isTypingTarget(e.target)) return;
    if (e.key === 't' || e.key === 'T') {
      goToday();
    } else if (e.key === 'ArrowLeft') {
      if (view === 'week') shiftWeek(-1);
      else shiftMonth(-1);
    } else if (e.key === 'ArrowRight') {
      if (view === 'week') shiftWeek(1);
      else shiftMonth(1);
    }
  }

  $effect(() => {
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  });

  $effect(() => {
    function onPointerDown(e: MouseEvent) {
      lastPointerPos = { x: e.clientX, y: e.clientY };
    }
    rootEl?.addEventListener('mousedown', onPointerDown, true);
    return () => rootEl?.removeEventListener('mousedown', onPointerDown, true);
  });
</script>

<div class="planner-view" bind:this={rootEl}>
  <div class="toolbar">
    <div class="nav-group">
      <button type="button" class="btn btn-secondary today-btn" disabled={isTodayInView} onclick={goToday}>Today</button>
      <button type="button" class="chevron" onclick={() => (view === 'week' ? shiftWeek(-1) : shiftMonth(-1))} aria-label="Previous">‹</button>
      <span class="range-label">{rangeLabel}</span>
      <button type="button" class="chevron" onclick={() => (view === 'week' ? shiftWeek(1) : shiftMonth(1))} aria-label="Next">›</button>
    </div>
    <div class="controls">
      <select bind:value={filter} onchange={onFilterChange}>
        {#if currentTerm}
          <option value="current_term">Current term ({currentTerm})</option>
        {/if}
        <option value="all">All courses</option>
        {#each courses as c}
          <option value={c.id}>{c.code} — {c.title}</option>
        {/each}
      </select>
      <div class="view-toggle" role="group" aria-label="View">
        <button type="button" class="chip" aria-pressed={view === 'week'} onclick={() => (view = 'week')}>Week</button>
        <button type="button" class="chip" aria-pressed={view === 'month'} onclick={() => (view = 'month')}>Month</button>
        <button type="button" class="chip" aria-pressed={view === 'agenda'} onclick={() => (view = 'agenda')}>Agenda</button>
      </div>
    </div>
  </div>

  {#if error}<p class="error">{error}</p>{/if}
  {#if loading}<p class="loading">Loading…</p>{/if}

  <div class="planner-body">
    <div class="planner-main">
      {#if view === 'week'}
        <WeekGrid
          items={visibleItems}
          weekStart={weekStartKey}
          {courses}
          selectedId={selectedId}
          onSelect={selectItem}
          onSlotClick={handleSlotClick}
        />
      {:else if view === 'month'}
        <CalendarGrid cells={monthCells} {courseById} {selectedId} onSelect={selectItem} />
      {:else}
        <AgendaList items={agendaItems} {courseById} {selectedId} onSelect={selectItem} />
      {/if}
    </div>
    <div class="planner-side">
      <h2 class="kicker">Plan ahead</h2>
      <PlannerRail items={visibleRailItems} {courses} {selectedId} weekStart={weekStartKey} onSelect={selectItem} onJumpToWeek={handleRailJump} />
    </div>
  </div>
</div>

{#if showPopover && selectedItem && popoverAnchor}
  <EventPopover
    item={selectedItem}
    course={selectedItem.course_id ? courseById.get(selectedItem.course_id) : undefined}
    anchorRect={popoverAnchor}
    onClose={closePopover}
    onDeleted={() => (view === 'week' ? loadWeek() : loadMonth())}
    onTaskToggled={handleTaskToggled}
  />
{/if}

{#if createSlot && createAnchor}
  <CreateSessionPopover start={createSlot} anchorRect={createAnchor} {courses} onClose={closeCreate} onCreated={handleSessionCreated} />
{/if}

<style>
  .planner-view {
    display: grid;
    gap: 16px;
    min-width: 0;
  }
  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .nav-group {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .today-btn {
    padding: 6px 13px;
    font-size: 12.5px;
  }
  .chevron {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    width: 2rem;
    height: 2rem;
    font-size: 1rem;
    background: var(--surface);
    color: var(--text);
  }
  .chevron:hover {
    background: var(--hover);
  }
  .range-label {
    font-weight: 600;
    min-width: 12rem;
    text-align: center;
    font-family: var(--font-display);
    font-variant-numeric: tabular-nums;
  }
  .controls {
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }
  select {
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 0.88rem;
    background: var(--surface);
    color: var(--text);
  }
  .view-toggle {
    display: flex;
    gap: 4px;
  }
  .error {
    color: var(--danger);
    font-size: 0.9rem;
  }
  .loading {
    color: var(--muted);
    font-size: 0.9rem;
  }
  .planner-body {
    display: grid;
    grid-template-columns: 1fr 260px;
    gap: 20px;
    align-items: start;
  }
  .planner-main {
    min-width: 0;
  }
  .planner-side {
    min-width: 0;
  }
  .planner-side .kicker {
    color: var(--muted);
    margin-bottom: 10px;
  }
  @media (max-width: 1100px) {
    .planner-body {
      grid-template-columns: 1fr;
    }
  }
</style>
