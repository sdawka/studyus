// Svelte action: pins body scroll at its current offset (position:fixed +
// negative top, the standard iOS-safe lock) while active, restoring both the
// inline styles and the scroll position on deactivate/destroy so the page
// doesn't jump. Extracted from Sheet.svelte, which was the only body
// scroll-lock in the app — Sheet now adopts this action and keeps identical
// behavior.
//
// `enabled` defaults to true (lock for the node's whole mounted lifetime).
// Callers whose lock-ness is conditional on viewport width (the planner/
// tasks route layers — mobile presents them as full pages that scroll
// internally, desktop presents them as true modals) pass a reactive
// `enabled` gated on the same matchMedia check their Escape handler already
// uses, e.g. `use:scrollLock={{ enabled: !$isMobile }}`.
//
// Framework-agnostic on purpose, same as focusTrap.ts: the planner/tasks
// route layers (plain Astro + inline <script>) import and call this
// directly, without the `use:` sugar.
export interface ScrollLockOptions {
  enabled?: boolean;
}

export interface ActionHandle {
  update?: (options?: ScrollLockOptions) => void;
  destroy: () => void;
}

export function scrollLock(_node: HTMLElement, options: ScrollLockOptions = {}): ActionHandle {
  let enabled = options.enabled ?? true;
  let locked = false;
  let scrollY = 0;
  let prev = { position: '', top: '', width: '' };

  function lock() {
    if (locked) return;
    locked = true;
    scrollY = window.scrollY;
    const body = document.body;
    prev = { position: body.style.position, top: body.style.top, width: body.style.width };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
  }

  function unlock() {
    if (!locked) return;
    locked = false;
    const body = document.body;
    body.style.position = prev.position;
    body.style.top = prev.top;
    body.style.width = prev.width;
    window.scrollTo(0, scrollY);
  }

  if (enabled) lock();

  return {
    update(next: ScrollLockOptions = {}) {
      const nextEnabled = next.enabled ?? true;
      if (nextEnabled === enabled) return;
      enabled = nextEnabled;
      if (enabled) lock();
      else unlock();
    },
    destroy() {
      unlock();
    },
  };
}
