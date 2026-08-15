// Svelte action: focus management for modal dialog surfaces (T4 a11y pass —
// repo-wide grep found zero focus-trap code before this). On activation it
// remembers whatever had focus, moves focus into the panel (its first
// focusable descendant, or the panel itself as a last resort), and traps
// Tab/Shift+Tab so focus can't leave the panel while it's open. On
// deactivation it restores focus to whatever had it before.
//
// `enabled` defaults to true (activate for the node's whole mounted
// lifetime — the common case: Sheet.svelte, LogEventModal, AddCourseModal,
// all of which only mount this node while actually open). Callers whose
// modal-ness is conditional on viewport width (the planner/tasks route
// layers, which behave as full pages with interactive chrome on mobile)
// pass a reactive `enabled` gated on the same matchMedia check their Escape
// handler already uses, e.g. `use:focusTrap={{ enabled: !$isMobile }}` —
// the action activates/deactivates in place as that flips, without needing
// to unmount the node itself.
//
// Framework-agnostic on purpose: nothing here touches Svelte internals, so
// the planner/tasks route layers (plain Astro + inline <script>, no Svelte
// runtime) import and call this the same way, just without the `use:` sugar.
export interface FocusTrapOptions {
  enabled?: boolean;
}

export interface ActionHandle {
  update?: (options?: FocusTrapOptions) => void;
  destroy: () => void;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableEls(node: HTMLElement): HTMLElement[] {
  return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0,
  );
}

export function focusTrap(node: HTMLElement, options: FocusTrapOptions = {}): ActionHandle {
  let enabled = options.enabled ?? true;
  let active = false;
  let previouslyFocused: HTMLElement | null = null;

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const els = focusableEls(node);
    if (els.length === 0) {
      e.preventDefault();
      return;
    }
    const first = els[0];
    const last = els[els.length - 1];
    const current = document.activeElement;
    if (e.shiftKey && current === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && current === last) {
      e.preventDefault();
      first.focus();
    } else if (!els.includes(current as HTMLElement)) {
      // Focus drifted outside the panel entirely (portal quirk, programmatic
      // focus elsewhere) — pull it back in rather than letting Tab continue
      // from wherever it ended up.
      e.preventDefault();
      first.focus();
    }
  }

  function activate() {
    if (active) return;
    active = true;
    previouslyFocused = document.activeElement as HTMLElement | null;
    if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
    const els = focusableEls(node);
    (els[0] ?? node).focus({ preventScroll: true });
    node.addEventListener('keydown', onKeydown);
  }

  function deactivate() {
    if (!active) return;
    active = false;
    node.removeEventListener('keydown', onKeydown);
    previouslyFocused?.focus?.({ preventScroll: true });
    previouslyFocused = null;
  }

  if (enabled) activate();

  return {
    update(next: FocusTrapOptions = {}) {
      const nextEnabled = next.enabled ?? true;
      if (nextEnabled === enabled) return;
      enabled = nextEnabled;
      if (enabled) activate();
      else deactivate();
    },
    destroy() {
      deactivate();
    },
  };
}
