// Shared headless popover behavior for the header's icon-trigger + panel
// controls (NotificationsBell, TodoDropdown, ScratchpadPopup, AvatarMenu):
// Escape closes, clicking outside the anchor closes. "Only one open at a
// time" is enforced by the caller (HeaderActions owns a single
// `activePopover` id and passes each child its own `open` boolean), not
// here — this just wires the DOM listeners for whichever one is open.
// Lives in a `.svelte.ts` file so `$effect` can run outside a .svelte
// component's own <script> block.
export function bindPopoverDismiss(opts: {
  isOpen: () => boolean;
  close: () => void;
  anchorEl: () => HTMLElement | null | undefined;
}) {
  $effect(() => {
    if (!opts.isOpen()) return;

    function onKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') opts.close();
    }
    function onPointerdown(e: PointerEvent) {
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
