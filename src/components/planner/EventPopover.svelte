<script lang="ts">
  // The shell around a single calendar item's detail view. It owns four
  // things and delegates everything else to ./event-popover/*:
  //
  //   1. the public props/events contract (PlannerView and dashboard/WeekView
  //      both mount this),
  //   2. presentation — anchored panel on desktop, Sheet on mobile, course
  //      hue, dismiss-on-Escape/outside-click,
  //   3. which affordances this item's type earns,
  //   4. the ONE place `item` is written to, and the matching bubble up to
  //      the parent.
  //
  // The parts below each own one mutation of the item, with their own
  // in-flight and error state; none of them writes to `item` itself.
  import type { CalendarItem } from '../../lib/types/calendar';
  import { hueFor } from '../../lib/courseHue';
  import { bindPopoverDismiss } from '../shell/popover.svelte.ts';
  import { isMobile } from '../../lib/stores/viewport';
  import Sheet from '../shell/Sheet.svelte';
  import EventSummary from './event-popover/EventSummary.svelte';
  import TaskDueToggle from './event-popover/TaskDueToggle.svelte';
  import SessionReschedule from './event-popover/SessionReschedule.svelte';
  import ClassSessionActions from './event-popover/ClassSessionActions.svelte';
  import EventActions from './event-popover/EventActions.svelte';
  import type { CourseOption } from './event-popover/types';

  let {
    item,
    course,
    anchorRect,
    onClose,
    onDeleted,
    onTaskToggled,
    onItemUpdated,
    plannerLink,
  }: {
    item: CalendarItem;
    course: CourseOption | undefined;
    anchorRect: { x: number; y: number; width: number; height: number };
    onClose: () => void;
    onDeleted?: () => void;
    // task_due only: fired after a toggle settles (optimistic flip included)
    // with the id/done pair actually applied, so the parent's items array
    // (WeekGrid/PlannerRail read from it) can be kept in sync — this popover
    // may be showing an item copied out of that array, not the live object.
    onTaskToggled?: (itemId: string, done: boolean) => void;
    // Generic counterpart of onTaskToggled for the other in-popover edits
    // below (study_session reschedule, class_session status/note) — same
    // "propagate the settled value back to the parent's array" contract,
    // just carrying whatever fields actually changed instead of one boolean.
    onItemUpdated?: (itemId: string, patch: Partial<CalendarItem>) => void;
    // dashboard/WeekView passes a `/planner?event=...` deep link so its
    // in-place popover can still hand off to the full planner; PlannerView
    // itself is already the planner, so it never passes this.
    plannerLink?: string | null;
  } = $props();

  let panelEl = $state<HTMLElement | null>(null);

  const hue = $derived(course ? hueFor({ slug: course.slug, color: course.color === null ? null : String(course.color) }) : 220);

  const style = $derived.by(() => {
    const width = 288;
    const margin = 12;
    let left = anchorRect.x + anchorRect.width + 10;
    let top = anchorRect.y;
    if (typeof window !== 'undefined') {
      if (left + width + margin > window.innerWidth) left = Math.max(margin, anchorRect.x - width - 10);
      if (left + width + margin > window.innerWidth) left = window.innerWidth - width - margin;
      const estHeight = 240;
      if (top + estHeight + margin > window.innerHeight) top = Math.max(margin, window.innerHeight - estHeight - margin);
    }
    return `left:${left}px; top:${top}px;`;
  });

  bindPopoverDismiss({
    isOpen: () => true,
    // Called inside a closure, not passed by value: reading the prop at setup
    // time would pin whichever function identity the parent happened to have
    // on first render (state_referenced_locally).
    close: () => onClose(),
    anchorEl: () => panelEl,
  });

  // --- the only writes to `item` ---------------------------------------------
  // Applied synchronously, before the request that prompted them settles, so a
  // second interaction started in the same tick reads the value the first one
  // just wrote. Each also bubbles the same change up: the parent's items array
  // is what WeekGrid/PlannerRail render from, not this popover's copy.
  function applyDetails(patch: Record<string, unknown>) {
    item.details = { ...item.details, ...patch };
    onItemUpdated?.(item.id, { details: patch });
  }

  function applyTimes(date: string, endDate: string | null) {
    item.date = date;
    item.end_date = endDate;
    onItemUpdated?.(item.id, { date, end_date: endDate });
  }

  function applyTaskDone(done: boolean) {
    item.details = { ...item.details, done };
    onTaskToggled?.(item.id, done);
  }

  // Completed sessions can't be nudged: PATCH /sessions/:id 409s on them, so
  // the controls are hidden rather than rendered disabled-but-clickable.
  const canReschedule = $derived(item.type === 'study_session' && !item.details?.completed);
</script>

{#snippet body()}
  <EventSummary {item} {course} />
  {#if item.type === 'task_due'}
    <TaskDueToggle {item} onDone={applyTaskDone} />
  {/if}
  {#if canReschedule}
    <SessionReschedule {item} onRescheduled={applyTimes} />
  {/if}
  {#if item.type === 'class_session'}
    <ClassSessionActions {item} onDetailsChanged={applyDetails} />
  {/if}
  <EventActions {item} {plannerLink} {onDeleted} {onClose} />
{/snippet}

{#if $isMobile}
  <Sheet open={true} onClose={onClose} title={item.title}>
    <div class="event-popover-body" style={`--course-h:${hue}`}>
      {@render body()}
    </div>
  </Sheet>
{:else}
  <div class="event-popover popover" bind:this={panelEl} style={`${style} --course-h:${hue}; --pop-w: 288px`} role="dialog" aria-label={item.title}>
    <div class="pop-head">
      <p class="pop-title">{item.title}</p>
      <button type="button" class="close-btn" aria-label="Close" onclick={onClose}>×</button>
    </div>
    {@render body()}
  </div>
{/if}

<style>
  .event-popover {
    position: fixed;
    z-index: 70;
    width: var(--pop-w);
    top: 0;
  }
  .pop-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }
  .pop-title {
    font-size: 14.5px;
    font-weight: 650;
    line-height: 1.3;
  }
  .close-btn {
    font-size: 16px;
    color: var(--muted);
    line-height: 1;
    flex-shrink: 0;
  }
  .close-btn:hover {
    color: var(--text);
  }
  /* Sheet.svelte's .sheet-body already provides the panel chrome (padding,
     scroll); this just reproduces the desktop .popover recipe's internal
     flex/gap so the same content reads the same in both presentations. */
  .event-popover-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
</style>
