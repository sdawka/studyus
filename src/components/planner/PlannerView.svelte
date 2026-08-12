<script lang="ts">
  import CalendarGrid from './CalendarGrid.svelte';
  import AgendaList from './AgendaList.svelte';

  interface CourseOption {
    id: string;
    slug: string;
    code: string;
    title: string;
    term: string | null;
    color: string | null;
  }
  interface CalendarItem {
    id: string;
    type: 'assessment_due' | 'task_due';
    title: string;
    date: string;
    course_id: string | null;
    details: Record<string, unknown>;
  }

  let {
    courses,
    currentTerm,
    initialItems,
  }: { courses: CourseOption[]; currentTerm: string | null; initialItems: CalendarItem[] } = $props();

  const courseById = new Map(courses.map((c) => [c.id, c]));
  const currentTermCourseIds = new Set(courses.filter((c) => c.term === currentTerm).map((c) => c.id));

  type FilterMode = 'current_term' | 'all' | string; // string = specific course id

  let filter = $state<FilterMode>(currentTerm ? 'current_term' : 'all');
  let view = $state<'month' | 'agenda'>('month');
  let anchor = $state(new Date());
  let items = $state<CalendarItem[]>(initialItems);
  let loading = $state(false);
  let error = $state<string | null>(null);

  function monthRange(d: Date) {
    const from = new Date(d.getFullYear(), d.getMonth(), 1);
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return { from, to };
  }

  async function loadItems() {
    loading = true;
    error = null;
    try {
      const { from, to } = monthRange(anchor);
      const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
      if (filter !== 'current_term' && filter !== 'all') params.set('course', filter);
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

  const visibleItems = $derived(
    filter === 'current_term' ? items.filter((i) => i.course_id === null || currentTermCourseIds.has(i.course_id)) : items,
  );

  function shiftMonth(delta: number) {
    anchor = new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1);
    loadItems();
  }

  function onFilterChange() {
    loadItems();
  }

  function dayKey(iso: string): string {
    return iso.slice(0, 10);
  }

  const monthLabel = $derived(anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));

  const monthCells = $derived.by(() => {
    const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const startWeekday = firstOfMonth.getDay();
    const daysInMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
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
      const date = new Date(anchor.getFullYear(), anchor.getMonth(), day);
      const key = date.toISOString().slice(0, 10);
      cells.push({ date, items: itemsByDay.get(key) ?? [] });
    }
    return cells;
  });

  const agendaItems = $derived([...visibleItems].sort((a, b) => a.date.localeCompare(b.date)));
</script>

<div class="planner-view">
  <div class="toolbar">
    <div class="month-nav">
      <button type="button" onclick={() => shiftMonth(-1)} aria-label="Previous month">‹</button>
      <span class="month-label">{monthLabel}</span>
      <button type="button" onclick={() => shiftMonth(1)} aria-label="Next month">›</button>
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
        <button type="button" class="chip" aria-pressed={view === 'month'} onclick={() => (view = 'month')}>Month</button>
        <button type="button" class="chip" aria-pressed={view === 'agenda'} onclick={() => (view = 'agenda')}>Agenda</button>
      </div>
    </div>
  </div>

  {#if error}<p class="error">{error}</p>{/if}
  {#if loading}<p class="loading">Loading…</p>{/if}

  {#if view === 'month'}
    <CalendarGrid cells={monthCells} {courseById} />
  {:else}
    <AgendaList items={agendaItems} {courseById} />
  {/if}
</div>

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
  .month-nav {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .month-nav button {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    width: 2rem;
    height: 2rem;
    font-size: 1rem;
    background: var(--surface);
    color: var(--text);
  }
  .month-nav button:hover {
    background: var(--hover);
  }
  .month-label {
    font-weight: 600;
    min-width: 10rem;
    text-align: center;
    font-family: var(--font-display);
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
</style>
