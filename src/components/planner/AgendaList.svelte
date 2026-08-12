<script lang="ts">
  import type { CalendarItem } from '../../lib/types/calendar';
  import { hueFor } from '../../lib/courseHue';

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
  }: {
    items: CalendarItem[];
    courseById: Map<string, CourseInfo>;
    selectedId?: string | null;
    onSelect?: (item: CalendarItem) => void;
  } = $props();

  function courseFor(item: CalendarItem): CourseInfo | undefined {
    return item.course_id ? courseById.get(item.course_id) : undefined;
  }
  function hueForItem(item: CalendarItem): number {
    const c = courseFor(item);
    return c ? hueFor({ slug: c.slug, color: c.color === null ? null : String(c.color) }) : 220;
  }
  function timeLabel(item: CalendarItem): string | null {
    if (item.all_day) return null;
    return new Date(item.date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
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

<ul class="agenda-list">
  {#if items.length === 0}
    <li class="empty-row">Nothing scheduled this month.</li>
  {/if}
  {#each items as item (item.id)}
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
</style>
