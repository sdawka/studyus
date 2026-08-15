// Shared headless popover behavior for the header's icon-trigger + panel
// controls (NotificationsBell, TodoDropdown, ScratchpadPopup, AvatarMenu):
// Escape closes, clicking outside the anchor closes. "Only one open at a
// time" is enforced by the caller (HeaderActions owns a single
// `activePopover` id and passes each child its own `open` boolean), not
// here — this just wires the DOM listeners for whichever one is open.
// Lives in a `.svelte.ts` file so `$effect` can run outside a .svelte
// component's own <script> block.
import { isMobile } from '../../lib/stores/viewport';

export function bindPopoverDismiss(opts: {
  isOpen: () => boolean;
  close: () => void;
  anchorEl: () => HTMLElement | null | undefined;
}) {
  $effect(() => {
    if (!opts.isOpen()) return;

    function onKeydown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // Gate on mobile, same reasoning as the pointerdown gate below: at
      // ≤767px every caller of this module presents as a Sheet (either
      // conditionally, like NotificationsBell/TodoDropdown/AvatarMenu, or
      // unconditionally alongside an always-"open" bindPopoverDismiss call,
      // like EventPopover/CreateSessionPopover), and Sheet.svelte owns its
      // own Escape dismissal there. Without this gate, one Escape press fired
      // onClose twice — once from Sheet's own handler, once from here.
      if (isMobile.get()) return;
      opts.close();
    }
    function onPointerdown(e: PointerEvent) {
      // Gate on mobile: at ≤767px the panel renders as a Sheet portaled to
      // <body>, which is always "outside" the anchor from this listener's
      // point of view — without this gate the sheet would dismiss itself
      // the instant it opens. Sheet.svelte owns its own scrim-tap/Escape
      // dismissal at that breakpoint instead.
      if (isMobile.get()) return;
      const el = opts.anchorEl();
      if (el && !el.contains(e.target as Node)) opts.close();
    }

    window.addEventListener('keydown', onKeydown);
    window.addEventListener('pointerdown', onPointerdown, true);
    return () => {
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener('pointerdown', onPointerdown, true);
    };
  });
}
