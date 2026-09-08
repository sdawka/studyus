<script lang="ts">
  import type { CalendarItem } from '../../lib/types/calendar';
  import { courseForItem, hueForItem } from '../../lib/courseHue';
  import { addDateKeyDays, calendarItemDateKey, calendarItemStartLabel, daysUntil, deadlineUrgency, formatZonedDate, zonedDateKey, zonedDateTime } from '../../lib/plannerDates';

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
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
    initialNow = Date.now(),
  }: {
    items: CalendarItem[];
    courseById: Map<string, CourseInfo>;
    selectedId?: string | null;
    onSelect?: (item: CalendarItem) => void;
    // Local ISO day (yyyy-mm-dd). Set by PlannerView after a CalendarGrid
    // day-tap (mobile Month → Agenda handoff) to scroll that date's group
    // header into view.
    scrollToDate?: string | null;
    timezone?: string;
    initialNow?: number;
  } = $props();

  let listEl = $state<HTMLUListElement | null>(null);

  interface Group {
    dateKey: string;
    label: string;
    items: CalendarItem[];
  }

  function groupLabel(dateKey: string): string {
    const todayKey = zonedDateKey(initialNow, timezone);
    if (dateKey === todayKey) return 'Today';
    if (dateKey === addDateKeyDays(todayKey, 1)) return 'Tomorrow';
    return formatZonedDate(zonedDateTime(dateKey, 12 * 60, timezone), timezone, { weekday: 'long', month: 'short', day: 'numeric' });
  }

  // Items arrive pre-sorted by date (PlannerView's `agendaItems`); group
  // adjacent same-day items under one header rather than repeating the date
  // on every row — this is also what makes the surface work as the mobile
  // default view (a flat undifferentiated list doesn't read as "a calendar").
  const groups = $derived.by(() => {
    const byDay = new Map<string, CalendarItem[]>();
    for (const item of items) {
      const key = calendarItemDateKey(item, timezone);
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

  function timeLabel(item: CalendarItem): string | null {
    if (item.all_day) return null;
    // calendarItemStartLabel, not a raw `new Date(item.date)` — a
    // class_session's real wall-clock start comes from details.start_min,
    // never from parsing hours off its ISO date (see plannerDates.ts).
    return calendarItemStartLabel(item, timezone);
  }

  function agendaUrgency(item: CalendarItem, days: number): { cls: string; label: string } {
    if (item.type === 'task_due' && item.details.done !== true) return deadlineUrgency(days);
    if (item.type === 'assessment_due' && item.details.grade_received == null) return deadlineUrgency(days);
    return { cls: 'pill-idle', label: days > 0 ? 'upcoming' : days === 0 ? 'today' : 'recorded' };
  }

  function itemDays(item: CalendarItem): number {
    return daysUntil(zonedDateTime(calendarItemDateKey(item, timezone), 12 * 60, timezone), new Date(initialNow), timezone);
  }
</script>

<ul class="agenda-list" bind:this={listEl}>
  {#if items.length === 0}
    <li class="empty-row">Nothing scheduled this month.</li>
  {/if}
  {#each groups as group (group.dateKey)}
    <li class="date-header" data-date-group={group.dateKey}>{group.label}</li>
    {#each group.items as item (item.id)}
      {@const days = itemDays(item)}
      {@const u = agendaUrgency(item, days)}
      {@const code = courseForItem(item, courseById)?.code}
      {@const time = timeLabel(item)}
      <li>
        <button type="button" class="agenda-row" class:selected={selectedId === item.id} data-event-id={item.id} onclick={() => onSelect?.(item)}>
          <span class="dot" style={`--course-h:${hueForItem(item, courseById)}`}></span>
          <span class="agenda-body">
            <span class="agenda-title">{item.title}</span>
            <span class="agenda-meta"
              >{code ? `${code} · ` : ''}{formatZonedDate(zonedDateTime(calendarItemDateKey(item, timezone), 12 * 60, timezone), timezone, { month: 'short', day: 'numeric' })}{time
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
