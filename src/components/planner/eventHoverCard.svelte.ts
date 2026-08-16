// Shared hover-card state machine — extracted out of WeekGrid.svelte (v1.6)
// so dashboard/WeekView's collapsed chips can show the same peek without
// duplicating the delay/position math. WeekGrid's own usage passes no
// options and gets byte-identical behavior to before the extraction (same
// 200ms delay, same edge-flip math); WeekView passes a shorter delay and a
// `suppressed` guard (hover must not fight the click-opened EventPopover).
import type { CalendarItem } from '../../lib/types/calendar';

const HOVER_CARD_W = 220;
const HOVER_CARD_H_EST = 132;
const HOVER_MARGIN = 8;
const DEFAULT_DELAY_MS = 200;

export function createEventHoverCard(opts?: { delayMs?: number; suppressed?: () => boolean }) {
  const delayMs = opts?.delayMs ?? DEFAULT_DELAY_MS;
  const suppressed = opts?.suppressed ?? (() => false);

  let item = $state<CalendarItem | null>(null);
  let pos = $state({ x: 0, y: 0 });
  let timer: ReturnType<typeof setTimeout> | undefined;

  function onEnter(e: MouseEvent, next: CalendarItem) {
    clearTimeout(timer);
    if (suppressed()) return;
    const target = e.currentTarget as HTMLElement;
    timer = setTimeout(() => {
      // Re-check: the caller's suppressed condition (e.g. a popover opening)
      // may have flipped true during the delay window.
      if (suppressed()) return;
      const rect = target.getBoundingClientRect();
      let x = rect.right + HOVER_MARGIN;
      if (x + HOVER_CARD_W + HOVER_MARGIN > window.innerWidth) x = Math.max(HOVER_MARGIN, rect.left - HOVER_CARD_W - HOVER_MARGIN);
      let y = rect.top;
      if (y + HOVER_CARD_H_EST + HOVER_MARGIN > window.innerHeight) y = Math.max(HOVER_MARGIN, window.innerHeight - HOVER_CARD_H_EST - HOVER_MARGIN);
      pos = { x, y };
      item = next;
    }, delayMs);
  }

  function onLeave() {
    clearTimeout(timer);
    item = null;
  }

  // Immediate dismiss with no dependence on a mouseleave event — used when
  // a click opens the EventPopover on the same element the hover card is
  // currently anchored to (a leave event may never fire in that case).
  function hide() {
    clearTimeout(timer);
    item = null;
  }

  return {
    get item() {
      return item;
    },
    get pos() {
      return pos;
    },
    onEnter,
    onLeave,
    hide,
  };
}
