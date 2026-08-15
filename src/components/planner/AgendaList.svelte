<script lang="ts">
  import type { CalendarItem } from '../../lib/types/calendar';
  import { hueFor } from '../../lib/courseHue';
  import { addDays, calendarItemStartLabel, isSameLocalDay, localDateKeyFromIso } from '../../lib/plannerDates';

  interface CourseInfo {
    code: string;
    slug: string;
    color: number | null;
  }

  let {
    items,
    courseById,
    selectedId = null,
    onSelect,
    scrollToDate,
  }: {
    items: CalendarItem[];
    courseById: Map<string, CourseInfo>;
    selectedId?: string | null;
    onSelect?: (item: CalendarItem) => void;
    // Local ISO day (yyyy-mm-dd). Set by PlannerView after a CalendarGrid
    // day-tap (mobile Month → Agenda handoff) to scroll that date's group
    // header into view.
    scrollToDate?: string | null;
  } = $props();

  let listEl = $state<HTMLUListElement | null>(null);

  interface Group {
    dateKey: string;
    label: string;
    items: CalendarItem[];
  }

  function groupLabel(dateKey: string): string {
    const d = new Date(`${dateKey}T00:00:00`);
    const today = new Date();
    if (isSameLocalDay(d, today)) return 'Today';
    if (isSameLocalDay(d, addDays(today, 1))) return 'Tomorrow';
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  }

  // Items arrive pre-sorted by date (PlannerView's `agendaItems`); group
  // adjacent same-day items under one header rather than repeating the date
  // on every row — this is also what makes the surface work as the mobile
  // default view (a flat undifferentiated list doesn't read as "a calendar").
  const groups = $derived.by(() => {
    const byDay = new Map<string, CalendarItem[]>();
    for (const item of items) {
      const key = localDateKeyFromIso(item.date);
      const list = byDay.get(key) ?? [];
      list.push(item);
      byDay.set(key, list);
    }
    const out: Group[] = [];
    for (const [dateKey, list] of byDay) out.push({ dateKey, label: groupLabel(dateKey), items: list });
    return out;
  });

  $effect(() => {
    if (!scrollToDate || !listEl) return;
    const el = listEl.querySelector<HTMLElement>(`[data-date-group="${scrollToDate}"]`);
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });

  function courseFor(item: CalendarItem): CourseInfo | undefined {
    return item.course_id ? courseById.get(item.course_id) : undefined;
  }
  function hueForItem(item: CalendarItem): number {
    const c = courseFor(item);
    return c ? hueFor({ slug: c.slug, color: c.color === null ? null : String(c.color) }) : 220;
  }
  function timeLabel(item: CalendarItem): string | null {
    if (item.all_day) return null;
    // calendarItemStartLabel, not a raw `new Date(item.date)` — a
    // class_session's real wall-clock start comes from details.start_min,
    // never from parsing hours off its ISO date (see plannerDates.ts).
    return calendarItemStartLabel(item);
  }
  function daysUntil(iso: string): number {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const d = new Date(iso);
    d.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - now.getTime()) / 86400000);
  }
  function urgency(days: number): { cls: string; label: string } {
    if (days < 0) return { cls: 'pill-danger', label: 'overdue' };
    if (days === 0) return { cls: 'pill-danger', label: 'Today' };
    if (days === 1) return { cls: 'pill-warn', label: 'Tomorrow' };
    if (days <= 3) return { cls: 'pill-warn', label: `in ${days}d` };
    return { cls: 'pill-idle', label: `in ${days}d` };
  }
</script>

<ul class="agenda-list" bind:this={listEl}>
  {#if items.length === 0}
    <li class="empty-row">Nothing scheduled this month.</li>
  {/if}
  {#each groups as group (group.dateKey)}
    <li class="date-header" data-date-group={group.dateKey}>{group.label}</li>
    {#each group.items as item (item.id)}
      {@const days = daysUntil(item.date)}
      {@const u = urgency(days)}
      {@const code = courseFor(item)?.code}
      {@const time = timeLabel(item)}
      <li>
        <button type="button" class="agenda-row" class:selected={selectedId === item.id} data-event-id={item.id} onclick={() => onSelect?.(item)}>
          <span class="dot" style={`--course-h:${hueForItem(item)}`}></span>
          <span class="agenda-body">
            <span class="agenda-title">{item.title}</span>
            <span class="agenda-meta"
              >{code ? `${code} · ` : ''}{new Date(item.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{time
                ? ` · ${time}`
                : ''}</span
            >
          </span>
          <span class="pill {u.cls}">{u.label}</span>
        </button>
      </li>
    {/each}
  {/each}
</ul>

<style>
  .agenda-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .agenda-list li {
    padding: 0;
  }
  .date-header {
    font-size: 11.5px;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    padding: 10px 2px 0;
  }
  .date-header:first-child {
    padding-top: 0;
  }
  .agenda-row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px 12px;
    background: var(--surface-2);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    text-align: left;
  }
  .agenda-row.selected {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .empty-row {
    color: var(--muted);
    justify-content: center;
    display: flex;
    padding: 10px 12px;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--course);
    flex-shrink: 0;
  }
  .agenda-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .agenda-title {
    font-weight: 560;
    font-size: 14px;
  }
  .agenda-meta {
    font-size: 12px;
    color: var(--muted);
  }

  /* @media, not @container: AgendaList is one of Agenda view's renderers
     inside PlannerView, which mounts inside the planner's fixed overlay
     layer (planner.astro's slot="overlay") — a body-level sibling of
     `main`, not something @container-against-main can see. Same documented
     exception as PlannerView's own toolbar rule. */
  @media (max-width: 767px) {
    .agenda-row {
      padding: 13px 14px;
      min-height: 44px;
    }
  }
</style>
