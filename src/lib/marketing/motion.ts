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
import { SplitText } from 'gsap/SplitText';
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

  gsap.registerPlugin(ScrollTrigger, SplitText);

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

  initHeadingReveals();
  initReveals();
}

/**
 * Every section heading (.rd-h2) reveals letter-by-letter with a snappy
 * overshoot as it scrolls in — the biggest, cheapest way to make the whole
 * page feel alive. Headings are excluded from the generic reveal below so they
 * don't double-animate. Skipped under reduced motion (this whole module is).
 */
function initHeadingReveals(): void {
  const heads = gsap.utils.toArray<HTMLElement>('.rd-h2');
  for (const h of heads) {
    // Keep the plain sentence for assistive tech; the split spans are decorative.
    h.setAttribute('aria-label', h.textContent ?? '');
    const split = new SplitText(h, { type: 'words,chars' });
    gsap.from(split.chars, {
      opacity: 0,
      yPercent: 100,
      rotate: 6,
      transformOrigin: '50% 100%',
      stagger: 0.013,
      duration: 0.5,
      ease: 'back.out(2.2)',
      scrollTrigger: { trigger: h, start: 'top 86%', once: true },
    });
  }
}

/**
 * Shared scroll entrance for the whole landing. Any element with `data-reveal`
 * animates in as it enters the viewport; children marked `data-reveal-item`
 * stagger. The attribute value picks a SNAPPY variant for per-section variety:
 *   ""/"up" → rise, "left"/"right" → slide in, "scale" → pop, "rotate" → tilt-in.
 * Grouped by nearest `data-reveal` container so each section fires
 * independently. No-ops under reduced motion (elements stay visible).
 */
function initReveals(): void {
  const groups = gsap.utils.toArray<HTMLElement>('[data-reveal]');
  for (const group of groups) {
    const variant = group.getAttribute('data-reveal') || 'up';
    const items = [...group.querySelectorAll<HTMLElement>('[data-reveal-item]')].filter(
      (el) => !el.classList.contains('rd-h2'), // headings get the char reveal instead
    );
    const targets = items.length ? items : [group];

    const from: gsap.TweenVars = {
      opacity: 0,
      duration: 0.62,
      // Snappy overshoot — punchier than a plain ease-out.
      ease: 'back.out(1.5)',
      stagger: items.length ? 0.085 : 0,
      scrollTrigger: { trigger: group, start: 'top 84%', once: true },
    };
    if (variant === 'left') from.x = -56;
    else if (variant === 'right') from.x = 56;
    else if (variant === 'scale') Object.assign(from, { scale: 0.88, y: 18 });
    else if (variant === 'rotate') Object.assign(from, { y: 40, rotate: -4, transformOrigin: '50% 100%' });
    else from.y = 46;

    gsap.from(targets, from);
  }
}

/** Escape hatch for anything that needs the Lenis instance (e.g. anchor jumps). */
export function getLenis(): Lenis | null {
  return lenis;
}
