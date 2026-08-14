// Mobile-shell breakpoint signal. MOBILE_QUERY is the single canonical
// breakpoint string — every mobile @media rule in the app matches it
// literally (767px) even though CSS can't reference this constant; JS
// consumers (popover→sheet islands, PlannerView's Agenda default, etc.)
// should read the isMobile atom instead of re-deriving their own query.
// SSR-safe: this module is imported by both server (Astro) and client
// (Svelte island) code, and `window`/`matchMedia` don't exist during
// Astro's server render — the module-level guard below defaults the atom
// to `false` there and only wires up a change listener in the browser.
import { atom } from 'nanostores';

export const MOBILE_QUERY = '(max-width: 767px)';

const mediaQuery = typeof window !== 'undefined' ? window.matchMedia(MOBILE_QUERY) : null;

export const isMobile = atom<boolean>(mediaQuery?.matches ?? false);

mediaQuery?.addEventListener('change', (e) => {
  isMobile.set(e.matches);
});
