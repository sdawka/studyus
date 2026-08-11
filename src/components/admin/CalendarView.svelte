<script lang="ts">
  interface CourseOption {
    id: string;
    code: string;
    title: string;
    term: string | null;
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

  function courseLabel(id: string | null): string {
    if (!id) return '';
    return courseById.get(id)?.code ?? '';
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

  function onFilterChange() {
    loadItems();
  }
</script>

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
    <div class="view-toggle">
      <button type="button" class:active={view === 'month'} onclick={() => (view = 'month')}>Month</button>
      <button type="button" class:active={view === 'agenda'} onclick={() => (view = 'agenda')}>Agenda</button>
    </div>
  </div>
</div>

{#if error}<p class="error">{error}</p>{/if}
{#if loading}<p class="muted">Loading…</p>{/if}

{#if view === 'month'}
  <div class="month-grid">
    {#each ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as wd}
      <div class="weekday">{wd}</div>
    {/each}
    {#each monthCells as cell}
      <div class="day-cell" class:empty={!cell.date}>
        {#if cell.date}
          <div class="day-number">{cell.date.getDate()}</div>
          {#each cell.items as item}
            <div class="item {item.type}" title={item.title}>
              <span class="dot"></span>{courseLabel(item.course_id)} {item.title}
            </div>
          {/each}
        {/if}
      </div>
    {/each}
  </div>
{:else}
  <ul class="agenda-list">
    {#if agendaItems.length === 0}
      <li class="muted">Nothing scheduled this month.</li>
    {/if}
    {#each agendaItems as item}
      <li>
        <span class="agenda-date">{new Date(item.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
        <span class="item {item.type} inline"><span class="dot"></span>{item.title}</span>
        <span class="agenda-course">{courseLabel(item.course_id)}</span>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .month-nav {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .month-nav button {
    background: none;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    width: 2rem;
    height: 2rem;
    cursor: pointer;
    font-size: 1rem;
  }
  .month-label { font-weight: 600; min-width: 10rem; text-align: center; }
  .controls { display: flex; gap: 0.75rem; align-items: center; }
  select {
    padding: 0.45rem 0.6rem;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    font-size: 0.88rem;
  }
  .view-toggle { display: flex; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
  .view-toggle button {
    background: white;
    border: none;
    padding: 0.45rem 0.8rem;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .view-toggle button.active { background: #3f6fd8; color: white; }
  .muted { color: #6b7280; font-size: 0.9rem; }
  .error { color: #b91c1c; font-size: 0.9rem; }

  .month-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 1px;
    background: #e5e7eb;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    overflow: hidden;
  }
  .weekday {
    background: #f9fafb;
    padding: 0.4rem;
    font-size: 0.75rem;
    text-transform: uppercase;
    color: #6b7280;
    text-align: center;
  }
  .day-cell {
    background: white;
    min-height: 5.5rem;
    padding: 0.4rem;
    font-size: 0.78rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .day-cell.empty { background: #fafafa; }
  .day-number { font-weight: 600; color: #374151; margin-bottom: 0.2rem; }
  .item {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-radius: 4px;
    padding: 0.1rem 0.25rem;
  }
  .item.assessment_due { background: #eef2ff; }
  .item.task_due { background: #f0fdf4; }
  .dot { width: 0.4rem; height: 0.4rem; border-radius: 50%; background: #3f6fd8; flex-shrink: 0; }
  .item.task_due .dot { background: #16a34a; }

  .agenda-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  .agenda-list li {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.6rem 0.8rem;
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
  }
  .agenda-date { min-width: 4rem; font-weight: 600; color: #3f6fd8; }
  .item.inline { flex: 1; padding: 0; background: none; }
  .agenda-course { color: #6b7280; font-size: 0.85rem; }
</style>
