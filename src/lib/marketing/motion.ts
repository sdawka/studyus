// Marketing landing REDESIGN — shared motion engine (Phase 1).
//
// One smooth-scroll instance (Lenis) driving GSAP's ScrollTrigger for the whole
// landing page. Sections DON'T create their own scroll engine — they import
// `gsap` + `ScrollTrigger`, call `initMarketingMotion()` once (idempotent), then
// register their own timelines. This keeps Lenis a singleton while letting each
// section own its animation.
//
// Reduced-motion contract: when the user prefers reduced motion we do NOT start
// Lenis and we export `reducedMotion = true`. Every section MUST branch on that
// flag and render a complete, static layout (no pin, no scrub, no parallax) —
// the page must be fully readable and usable with zero motion.
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

export const reducedMotion =
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

let started = false;
let lenis: Lenis | null = null;

/**
 * Wire GSAP ScrollTrigger to a single Lenis instance. Safe to call from every
 * section script — only the first call does the work.
 */
export function initMarketingMotion(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  gsap.registerPlugin(ScrollTrigger);

  if (reducedMotion) {
    // No smooth-scroll engine — native scrolling only. Sections skip their
    // scrubbed timelines entirely (they read `reducedMotion`), so ScrollTrigger
    // has nothing to drive; nothing else to set up.
    return;
  }

  lenis = new Lenis({
    duration: 1.1,
    // Gentle exponential ease for that "premium momentum" feel.
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
  });

  // Lenis drives ScrollTrigger; GSAP's ticker drives Lenis' RAF loop (one loop,
  // no competing rAFs). lagSmoothing off so scrubbed timelines track precisely.
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis?.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);

  initReveals();
}

/**
 * Shared scroll entrance for the whole landing. Any element with `data-reveal`
 * rises + fades in as it enters the viewport; children marked `data-reveal-item`
 * stagger. Grouped by their nearest `data-reveal` container so each section
 * animates independently. No-ops under reduced motion (elements stay visible).
 */
function initReveals(): void {
  const groups = gsap.utils.toArray<HTMLElement>('[data-reveal]');
  for (const group of groups) {
    const items = group.querySelectorAll<HTMLElement>('[data-reveal-item]');
    const targets = items.length ? items : [group];
    gsap.from(targets, {
      opacity: 0,
      y: 34,
      duration: 0.7,
      ease: 'power3.out',
      stagger: items.length ? 0.09 : 0,
      scrollTrigger: { trigger: group, start: 'top 82%', once: true },
    });
  }
}

/** Escape hatch for anything that needs the Lenis instance (e.g. anchor jumps). */
export function getLenis(): Lenis | null {
  return lenis;
}
