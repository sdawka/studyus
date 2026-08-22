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
//
// Reusable helpers (below `initMarketingMotion`) for sections to build on
// instead of hand-rolling: `svgDraw` (scroll-linked stroke draw-on),
// `pointerParallax` / `pointerTilt` (pointer-reactive depth, desktop-only with
// a touch fallback), and `matchMotion` (declarative desktop/mobile branching
// on top of `gsap.matchMedia()`). All of them already honor `reducedMotion` —
// callers don't need to re-check it before calling. Full usage examples live
// in the motion contract doc handed off alongside this file.
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

// ============================================================================
// Reusable award-caliber helpers. Sections import these instead of hand-rolling
// SVG draw-on / pointer parallax / mobile branching — see the individual doc
// comments below and the contract doc for full usage examples.
// ============================================================================

const canHover = (): boolean =>
  typeof matchMedia !== 'undefined' && matchMedia('(hover: hover) and (pointer: fine)').matches;

export interface SvgDrawOptions {
  /** Starting visible fraction of the stroke, 0–1. Default 0 (fully hidden). */
  from?: number;
  /** Ending visible fraction of the stroke, 0–1. Default 1 (fully drawn). */
  to?: number;
  /** Tween duration in seconds. Ignored when `scrub` is set. Default 1. */
  duration?: number;
  ease?: string;
  /** Per-path stagger. Default 0 for a single path, 0.08 for a group. */
  stagger?: number;
  /** Element that drives the ScrollTrigger. Defaults to the first path/group. */
  trigger?: Element | string;
  start?: string;
  end?: string;
  /** Play-on-enter mode only: fire once (default true) or every entry. */
  once?: boolean;
  /**
   * Scrub mode: ties draw progress to scroll position between `start`/`end`
   * instead of playing once on enter. `true` scrubs directly; a number is a
   * smoothing "catch-up" duration (matches the Lenis pattern used elsewhere —
   * avoids the micro-vibration a raw `scrub: true` shows with smooth scroll).
   */
  scrub?: boolean | number;
  /**
   * Add the draw tween into an existing timeline instead of creating its own
   * ScrollTrigger — for a draw that's one beat inside a bigger pinned scene
   * (e.g. StudyLoop's decay/recovery curve). When set, `scrub`/`trigger`/
   * `start`/`end`/`once` are ignored; position it with `position`.
   */
  timeline?: gsap.core.Timeline;
  /** Position in `timeline` (GSAP position parameter). Default end of timeline. */
  position?: gsap.Position;
}

export interface SvgDrawResult {
  paths: SVGGeometryElement[];
  lengths: number[];
  tween: gsap.core.Tween | gsap.core.Timeline;
}

/**
 * Scroll-linked SVG stroke draw-on. Precomputes path length(s) so `target` can
 * be a single path or a group (selector, element, or array) — every matched
 * path gets its own dasharray/offset and staggers together.
 *
 * Reduced motion: paths are set fully drawn (dasharray cleared) and no tween
 * or ScrollTrigger is created — returns `null`. Callers don't need to branch;
 * just don't rely on the return value under `reducedMotion`.
 */
export function svgDraw(
  target: string | Element | Element[],
  opts: SvgDrawOptions = {},
): SvgDrawResult | null {
  const paths = gsap.utils.toArray<SVGGeometryElement>(target);
  if (!paths.length) return null;

  if (reducedMotion) {
    gsap.set(paths, { strokeDasharray: 'none', strokeDashoffset: 0 });
    return null;
  }

  const lengths = paths.map((p) => p.getTotalLength());
  const from = opts.from ?? 0;
  const to = opts.to ?? 1;
  paths.forEach((p, i) => {
    gsap.set(p, { strokeDasharray: lengths[i], strokeDashoffset: lengths[i] * (1 - from) });
  });

  const toVars: gsap.TweenVars = {
    strokeDashoffset: (i: number) => lengths[i] * (1 - to),
    ease: opts.ease ?? 'power2.out',
    stagger: opts.stagger ?? (paths.length > 1 ? 0.08 : 0),
  };

  if (opts.timeline) {
    opts.timeline.to(paths, { ...toVars, duration: opts.duration ?? 1 }, opts.position);
    return { paths, lengths, tween: opts.timeline };
  }

  if (opts.scrub) {
    const tween = gsap.to(paths, {
      ...toVars,
      ease: 'none',
      scrollTrigger: {
        trigger: opts.trigger ?? paths[0],
        start: opts.start ?? 'top 85%',
        end: opts.end ?? 'bottom 40%',
        scrub: typeof opts.scrub === 'number' ? opts.scrub : true,
      },
    });
    return { paths, lengths, tween };
  }

  const tween = gsap.to(paths, {
    ...toVars,
    duration: opts.duration ?? 1,
    scrollTrigger: {
      trigger: opts.trigger ?? paths[0],
      start: opts.start ?? 'top 85%',
      once: opts.once ?? true,
    },
  });
  return { paths, lengths, tween };
}

export interface PointerParallaxOptions {
  /** Selector for depth-tagged children within `root`. Default `[data-depth]`. */
  items?: string;
  /** Attribute holding each item's depth (parallax multiplier). Default `data-depth`. */
  depthAttr?: string;
  /** Overall strength multiplier applied on top of each item's depth. Default 1.6. */
  strength?: number;
  axis?: 'x' | 'xy';
  duration?: number;
  ease?: string;
  /**
   * Touch/no-fine-pointer behavior. `'none'` (default) does nothing — the
   * cluster just sits still, which is the right call for most decorative art.
   * `'drift'` swaps in a subtle scroll-scrubbed vertical drift instead, for
   * clusters that would otherwise feel dead on mobile.
   */
  touchFallback?: 'drift' | 'none';
}

/**
 * Pointer-reactive depth parallax for a cluster of elements (e.g. hero
 * stickers). Each item under `root` matching `items` moves by its own
 * `data-depth` × pointer offset × `strength`, driven by `gsap.quickTo` (no
 * extra rAF loop — rides GSAP's existing ticker, same one Lenis is on).
 *
 * Desktop-only by default (`(hover: hover) and (pointer: fine)`); see
 * `touchFallback` for the touch behavior. No-ops entirely under reduced
 * motion. Returns a cleanup function that removes the listener.
 */
export function pointerParallax(
  root: HTMLElement | string,
  opts: PointerParallaxOptions = {},
): () => void {
  const noop = () => {};
  if (reducedMotion) return noop;

  const rootEl = typeof root === 'string' ? document.querySelector<HTMLElement>(root) : root;
  if (!rootEl) return noop;

  const items = gsap.utils.toArray<HTMLElement>(opts.items ?? '[data-depth]', rootEl);
  if (!items.length) return noop;

  const depthAttr = opts.depthAttr ?? 'data-depth';
  const strength = opts.strength ?? 1.6;
  const duration = opts.duration ?? 0.9;
  const ease = opts.ease ?? 'power3';

  if (!canHover()) {
    if (opts.touchFallback !== 'drift') return noop;
    const tween = gsap.to(items, {
      y: (_i, el) => -(Number((el as HTMLElement).getAttribute(depthAttr)) || 10) * 0.5,
      ease: 'none',
      scrollTrigger: { trigger: rootEl, start: 'top bottom', end: 'bottom top', scrub: 0.5 },
    });
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }

  const xTos = items.map((el) => gsap.quickTo(el, 'x', { duration, ease }));
  const yTos = opts.axis === 'xy' ? items.map((el) => gsap.quickTo(el, 'y', { duration, ease })) : null;

  const onMove = (e: PointerEvent) => {
    const r = rootEl.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    items.forEach((el, i) => {
      const depth = Number(el.getAttribute(depthAttr)) || 10;
      xTos[i](px * depth * strength);
      if (yTos) yTos[i](py * depth * strength);
    });
  };
  rootEl.addEventListener('pointermove', onMove);
  return () => rootEl.removeEventListener('pointermove', onMove);
}

export interface PointerTiltOptions {
  /** Max tilt in degrees at the pointer extremes. Default 10. */
  max?: number;
  /** Hover scale applied alongside the tilt. Default 1.02 (1 disables). */
  scale?: number;
  duration?: number;
  ease?: string;
  /** Same contract as `pointerParallax`'s `touchFallback`. Default 'none'. */
  touchFallback?: 'drift' | 'none';
}

/**
 * Pointer-reactive 3D tilt for cards. Each matched element tilts on
 * rotateX/rotateY toward the pointer and settles back on pointerleave, via
 * `gsap.quickTo` (transform-only, single shared ticker). Pair with the
 * `.rd-tilt` CSS utility (sets `perspective` on the containing element) —
 * apply it to the grid/wrapper around the cards, not the cards themselves.
 *
 * Desktop-only by default; see `touchFallback`. No-ops under reduced motion.
 * Returns a cleanup function that removes all listeners.
 */
export function pointerTilt(
  target: string | Element | Element[],
  opts: PointerTiltOptions = {},
): () => void {
  const noop = () => {};
  if (reducedMotion) return noop;

  const els = gsap.utils.toArray<HTMLElement>(target);
  if (!els.length) return noop;

  const max = opts.max ?? 10;
  const scale = opts.scale ?? 1.02;
  const duration = opts.duration ?? 0.5;
  const ease = opts.ease ?? 'power3';

  if (!canHover()) {
    if (opts.touchFallback !== 'drift') return noop;
    const tweens = els.map((el) =>
      gsap.to(el, {
        y: -10,
        ease: 'none',
        scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: 0.6 },
      }),
    );
    return () =>
      tweens.forEach((t) => {
        t.scrollTrigger?.kill();
        t.kill();
      });
  }

  const cleanups = els.map((el) => {
    el.style.transformStyle = 'preserve-3d';
    const rx = gsap.quickTo(el, 'rotateX', { duration, ease });
    const ry = gsap.quickTo(el, 'rotateY', { duration, ease });
    const sc = gsap.quickTo(el, 'scale', { duration, ease });
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      rx(-py * max);
      ry(px * max);
      sc(scale);
    };
    const onLeave = () => {
      rx(0);
      ry(0);
      sc(1);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  });
  return () => cleanups.forEach((fn) => fn());
}

/** Default breakpoints for {@link matchMotion}. Matches the manual
 * `matchMedia('(max-width: 768px|860px)').matches` checks already used
 * around the codebase — pick whichever named query fits, or pass your own. */
export const MOTION_BREAKPOINTS = {
  desktop: '(min-width: 861px)',
  mobile: '(max-width: 860px)',
};

export interface MatchMotionConfig {
  /** Runs (and re-runs on breakpoint cross) only when `desktopQuery` matches. */
  desktop?: gsap.ContextFunc;
  /** Runs (and re-runs on breakpoint cross) only when `mobileQuery` matches. */
  mobile?: gsap.ContextFunc;
  /** Runs once, unconditionally, regardless of viewport — for setup shared by both. */
  all?: () => void;
  desktopQuery?: string;
  mobileQuery?: string;
}

/**
 * Declarative desktop-vs-mobile motion registration on top of
 * `gsap.matchMedia()`. Each branch's cleanup (anything the registered
 * function returns) runs automatically when the viewport crosses the
 * breakpoint — e.g. a tablet rotating past 860px — which a one-shot
 * `matchMedia(...).matches` check at load time can't do.
 *
 * Returns `undefined` under reduced motion and calls nothing — sections
 * should already be branching on `reducedMotion` before reaching for this,
 * this is just a belt-and-braces no-op so it's safe to call unconditionally.
 */
export function matchMotion(config: MatchMotionConfig): gsap.MatchMedia | undefined {
  if (reducedMotion) return undefined;
  config.all?.();
  const mm = gsap.matchMedia();
  if (config.desktop) mm.add(config.desktopQuery ?? MOTION_BREAKPOINTS.desktop, config.desktop);
  if (config.mobile) mm.add(config.mobileQuery ?? MOTION_BREAKPOINTS.mobile, config.mobile);
  return mm;
}
