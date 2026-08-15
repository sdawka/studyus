// Dependency-free confetti burst for TaskCheckbox's check-moment celebration.
// Colors are derived at call time from the theme's course/accent hue (read
// off the origin element via getComputedStyle) rather than hardcoded, so the
// burst always matches the row's course color — or the theme accent when no
// course hue is in scope — in every theme × scheme combination. Particles
// are driven by WAAPI (element.animate) with hand-rolled projectile
// keyframes; no canvas, no external library.

interface BurstOptions {
  count?: number;
  hue?: number;
}

const PARTICLE_MIN = 14;
const PARTICLE_MAX = 24;

export function burstConfetti(originEl: HTMLElement, opts?: BurstOptions): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const rect = originEl.getBoundingClientRect();
  const originX = rect.left + rect.width / 2;
  const originY = rect.top + rect.height / 2;

  const colors = resolveColors(originEl, opts?.hue);
  const count = Math.round(clamp(opts?.count ?? randomBetween(PARTICLE_MIN, PARTICLE_MAX), PARTICLE_MIN, PARTICLE_MAX));

  const container = document.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  container.style.cssText = 'position:fixed; left:0; top:0; width:0; height:0; overflow:visible; pointer-events:none; z-index:2147483000;';
  document.body.appendChild(container);

  const finishes: Promise<unknown>[] = [];

  for (let i = 0; i < count; i++) {
    const particle = document.createElement('span');
    const isCircle = Math.random() < 0.5;
    const size = randomBetween(4, 7);
    const color = colors[i % colors.length];

    particle.style.cssText = `
      position:absolute;
      left:${originX}px;
      top:${originY}px;
      width:${size}px;
      height:${size}px;
      margin:${-size / 2}px 0 0 ${-size / 2}px;
      background:${color};
      border-radius:${isCircle ? '50%' : '2px'};
    `;
    container.appendChild(particle);

    const anim = particle.animate(ballisticKeyframes(), {
      duration: randomBetween(650, 1100),
      delay: randomBetween(0, 90),
      easing: 'linear',
      fill: 'forwards',
    });
    finishes.push(anim.finished.catch(() => {}));
  }

  Promise.all(finishes).then(() => container.remove());
}

// Samples a simple projectile-motion arc (initial ballistic velocity +
// constant downward gravity + spin + fade-out) into a fixed set of WAAPI
// keyframes. WAAPI has no built-in physics, so the curve is pre-computed
// here rather than simulated frame-by-frame.
function ballisticKeyframes(): Keyframe[] {
  const angle = randomBetween(-125, -55) * (Math.PI / 180); // mostly upward, spread outward
  const speed = randomBetween(180, 340); // px/s
  const vx = Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed;
  const gravity = randomBetween(650, 900); // px/s^2
  const rotStart = randomBetween(0, 360);
  const rotEnd = rotStart + (Math.random() > 0.5 ? 1 : -1) * randomBetween(180, 540);
  const durationSec = randomBetween(0.65, 1.1);

  const steps = 8;
  const keyframes: Keyframe[] = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const tSec = t * durationSec;
    const x = vx * tSec;
    const y = vy * tSec + 0.5 * gravity * tSec * tSec;
    const rotation = rotStart + (rotEnd - rotStart) * t;
    const opacity = t < 0.65 ? 1 : Math.max(0, 1 - (t - 0.65) / 0.35);
    keyframes.push({
      transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${rotation.toFixed(0)}deg)`,
      opacity,
    });
  }
  return keyframes;
}

// Reads the row's course hue/chroma straight from the cascade (--course-h /
// --course-c, always present thanks to tokens.css's :root default) and
// spreads a handful of colors around it, so the burst is calm in a
// low-chroma theme (Focus) and punchier in a high-chroma one (Campus)
// without ever touching a literal hex value.
function resolveColors(el: HTMLElement, hueOverride?: number): string[] {
  const style = getComputedStyle(el);
  const hue = hueOverride ?? (parseFloat(style.getPropertyValue('--course-h')) || 220);
  const baseChroma = parseFloat(style.getPropertyValue('--course-c')) || 0.12;
  const chroma = clamp(baseChroma + 0.06, 0.14, 0.22);
  const offsets = [-55, -28, 0, 22, 48, 80];
  const lightness = [74, 80, 68, 84, 76, 70];
  return offsets.map((offset, i) => `oklch(${lightness[i]}% ${chroma.toFixed(3)} ${(hue + offset).toFixed(0)})`);
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
