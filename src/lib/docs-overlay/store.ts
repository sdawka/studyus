// TEMPORARY — docs annotation overlay. See docs/product/annotations.md.
//
// Follows the src/lib/stores/ui.ts shape (tiny, framework-agnostic) and the
// viewport.ts SSR guard. Lives here rather than in src/lib/stores/ so the whole
// layer stays in two deletable directories.
import { atom } from 'nanostores';

const OPEN_KEY = 'sb:docs-overlay';
const DOCK_KEY = 'sb:docs-overlay-dock';

export type DockSide = 'left' | 'right';

function read(key: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // Safari private mode throws on access.
  }
}

function write(key: string, value: string) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* non-fatal — the overlay just won't remember across reloads */
  }
}

/**
 * Overlay open/closed. Starts CLOSED unless explicitly persisted open — that
 * default is what keeps scripts/visual-qa.mjs screenshots free of dev chrome
 * even when the build flag is on.
 */
export const overlayOpen = atom(read(OPEN_KEY) === 'open');

/** Which component's card is expanded in the panel (an Annotation.name), or null. */
export const selectedComponent = atom<string | null>(null);

/** Which edge the panel is docked to, so it can be moved off what it describes. */
export const dockSide = atom<DockSide>(read(DOCK_KEY) === 'left' ? 'left' : 'right');

export function setOverlay(next: boolean) {
  overlayOpen.set(next);
  write(OPEN_KEY, next ? 'open' : 'closed');
  if (!next) selectedComponent.set(null);
}

export function toggleOverlay() {
  setOverlay(!overlayOpen.get());
}

export function selectComponent(name: string | null) {
  selectedComponent.set(name);
}

export function setDock(side: DockSide) {
  dockSide.set(side);
  write(DOCK_KEY, side);
}

export function toggleDock() {
  setDock(dockSide.get() === 'right' ? 'left' : 'right');
}
