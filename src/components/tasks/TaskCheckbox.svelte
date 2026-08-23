<script lang="ts">
  // Checkbox delight track. Props are the frozen contract (v1.6 foundation)
  // — a real <input type="checkbox"> stays in the DOM, aria-label = label,
  // onToggle fires on every user toggle in both directions with no
  // branching here; the caller decides what checking means.
  //
  // The input IS the visual box (appearance:none + border/background of
  // its own) rather than a decoy input hidden behind a styled sibling —
  // fewer moving parts for a11y, and the focus ring lands exactly on the
  // real control. The checkmark <svg> and the hover glow are separate,
  // pointer-events:none layers stacked via position:absolute inside a
  // fixed-size shell, so nothing here ever shifts row layout — effects
  // only ever overflow via transform or absolute/fixed positioning, never
  // by resizing the shell itself.
  //
  // Course color: --course / --course-soft / --course-h are always
  // resolved (tokens.css derives them on every element with a --course-h:
  // 220 default on :root), so a task row that sets --course-h upstream
  // tints the box/glow/confetti with it automatically; elsewhere they read
  // as a calm accent-ish default. The var(..., var(--accent)) fallbacks are
  // defensive, not load-bearing.
  //
  // Celebration is gated on an actual false->true edge of `checked` (via
  // $effect comparing against the previous value), not on the CSS
  // `:checked` selector — a plain CSS animation bound to `:checked` would
  // replay on every mount for tasks that already loaded completed. The
  // checkmark draw-in below, by contrast, is a plain CSS `transition` on
  // `:checked`, which never plays on initial insertion (no prior frame to
  // transition from) — no extra JS guard needed there.
  import { burstConfetti } from '../../lib/confetti';
  import { recentFlowCelebration } from '../../lib/completionMotion';

  interface Props {
    checked: boolean;
    busy?: boolean;
    disabled?: boolean;
    label: string;
    onToggle: () => void;
  }

  let { checked, busy = false, disabled = false, label, onToggle }: Props = $props();

  let inputEl: HTMLInputElement | undefined;
  let celebrate = $state(false);
  let prevChecked = checked;

  $effect(() => {
    const now = checked;
    const was = prevChecked;
    prevChecked = now;

    if (now && !was) {
      celebrate = true;
      // Pop + ring always play on the edge; confetti defers to a burst
      // CompletionFlow just fired from its Done button (same completion,
      // one celebration — see completionMotion.ts).
      if (inputEl && !recentFlowCelebration()) burstConfetti(inputEl);
      const timer = setTimeout(() => {
        celebrate = false;
      }, 520);
      return () => clearTimeout(timer);
    }
    if (!now) {
      // Uncheck is boring on purpose: if a rapid re-toggle catches the pop
      // mid-flight, cut it short rather than let it resolve on a box that's
      // already reversing.
      celebrate = false;
    }
  });

  // A native <input type="checkbox"> flips its own `checked` DOM property on
  // click before any JS runs — Svelte's one-way `{checked}` binding only
  // re-applies it when the reactive `checked` PROP itself changes. A caller
  // that decides NOT to change it (TaskItem opens a typed-task's
  // CompletionFlow instead of completing immediately, on the check that's
  // still open — cancel changes nothing) leaves the native property
  // out of sync with the true value, i.e. the box visually shows checked
  // for a task that's still open. Forcing it back to the source of truth
  // on every change event, synchronously before onToggle runs, closes that
  // gap: for a real completion, `checked` flips true moments later anyway
  // (in the same tick, no visible flash) and reasserts it; for a deferred
  // one, it simply never lies in the meantime.
  function handleChange() {
    if (inputEl) inputEl.checked = checked;
    onToggle();
  }
</script>

<span class="cb-shell" class:is-busy={busy} class:is-disabled={disabled} class:is-popping={celebrate}>
  <input
    type="checkbox"
    class="cb-input"
    bind:this={inputEl}
    {checked}
    disabled={disabled || busy}
    aria-label={label}
    onchange={handleChange}
  />
  <svg class="cb-check" viewBox="0 0 16 16" aria-hidden="true">
    <path class="cb-check-path" d="M3.5 8.4 L6.6 11.6 L12.6 4.6" />
  </svg>
  <span class="cb-glow" aria-hidden="true"></span>
  <span class="cb-ring" aria-hidden="true"></span>
</span>

<style>
  .cb-shell {
    position: relative;
    display: inline-flex;
    width: 1.05rem;
    height: 1.05rem;
    flex-shrink: 0;
  }

  .cb-input {
    appearance: none;
    -webkit-appearance: none;
    margin: 0;
    width: 100%;
    height: 100%;
    border: 1.5px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    cursor: pointer;
    position: relative;
    z-index: 1;
    transform-origin: center;
    transition:
      transform var(--motion-fast) var(--ease),
      background-color var(--motion-base) var(--ease),
      border-color var(--motion-base) var(--ease);
  }

  .cb-input:disabled {
    cursor: not-allowed;
  }

  .cb-input:checked {
    background: var(--course, var(--accent));
    border-color: var(--course, var(--accent));
  }

  .cb-shell.is-disabled .cb-input {
    opacity: 0.5;
  }

  /* Busy: gentle desaturated shimmer, no spinner. */
  .cb-shell.is-busy .cb-input {
    animation: cb-shimmer 1.1s ease-in-out infinite;
  }

  @keyframes cb-shimmer {
    0%, 100% { opacity: 0.55; filter: saturate(0.5); }
    50%      { opacity: 0.85; filter: saturate(0.85); }
  }

  /* ---------- Hover anticipation ---------- */

  .cb-shell:hover .cb-input:not(:disabled) {
    transform: translateY(-1px) rotate(-5deg) scale(1.06);
  }

  /* The "wink": a quick one-off border/ring flash on hover-enter, only for
     the empty box — once checked, hover just holds the lift/tilt. Bound to
     the hover selector itself so it replays every time the cursor re-enters
     rather than looping while parked (calm for a row you hover 50x/day). */
  .cb-shell:hover .cb-input:not(:disabled):not(:checked) {
    animation: cb-wink 380ms var(--ease);
  }

  @keyframes cb-wink {
    0%   { box-shadow: 0 0 0 0 var(--course-soft, var(--accent-soft)); }
    45%  { box-shadow: 0 0 0 4px var(--course-soft, var(--accent-soft)); }
    100% { box-shadow: 0 0 0 2px var(--course-soft, var(--accent-soft)); }
  }

  .cb-glow {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 2.4rem;
    height: 2.4rem;
    transform: translate(-50%, -50%) scale(0.6);
    border-radius: 50%;
    background: radial-gradient(circle, var(--course-soft, var(--accent-soft)) 0%, transparent 72%);
    opacity: 0;
    pointer-events: none;
    z-index: 0;
    transition: opacity var(--motion-fast) var(--ease), transform var(--motion-fast) var(--ease);
  }

  .cb-shell:hover:not(.is-disabled):not(.is-busy) .cb-glow {
    opacity: 0.9;
    transform: translate(-50%, -50%) scale(1);
  }

  /* ---------- Check-moment ---------- */

  .cb-check {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 2;
  }

  .cb-check-path {
    fill: none;
    stroke: var(--accent-contrast, var(--surface));
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 17;
    stroke-dashoffset: 17;
    transition: stroke-dashoffset var(--motion-base) var(--ease);
  }

  .cb-input:checked ~ .cb-check .cb-check-path {
    stroke-dashoffset: 0;
  }

  /* Springy scale/rotate pop, gated by JS (see script block) so it only
     ever plays on a genuine user check, never on mount for tasks that
     loaded already completed. Confetti fires alongside it from the
     script, anchored on the input itself. */
  @keyframes cb-pop {
    0%   { transform: scale(1) rotate(0deg); }
    30%  { transform: scale(1.35) rotate(-10deg); }
    55%  { transform: scale(0.88) rotate(6deg); }
    75%  { transform: scale(1.08) rotate(-2deg); }
    100% { transform: scale(1) rotate(0deg); }
  }

  .cb-shell.is-popping .cb-input {
    animation: cb-pop 420ms var(--ease);
  }

  /* Ring pulse: a halo radiating outward from the box on check — the
     "impact wave" layer under the confetti. Same course-tinted ink as the
     fill, transform/opacity only (compositor-friendly), and like every
     other effect here it overflows the fixed-size shell via absolute
     positioning, never by resizing it. Invisible at rest; plays only with
     the JS-gated .is-popping edge, so it can never replay on mount. */
  .cb-ring {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 2.6rem;
    height: 2.6rem;
    margin: -1.3rem 0 0 -1.3rem;
    border-radius: 50%;
    border: 2px solid var(--course, var(--accent));
    opacity: 0;
    transform: scale(0.35);
    pointer-events: none;
    z-index: 0;
  }

  .cb-shell.is-popping .cb-ring {
    animation: cb-ring-pulse 500ms var(--ease) forwards;
  }

  @keyframes cb-ring-pulse {
    0%   { opacity: 0.85; transform: scale(0.35); }
    100% { opacity: 0;    transform: scale(1); }
  }

  /* Reduced motion: the acknowledgment stays — the color fill, checkmark,
     and hover glow all still appear, just instantly — but nothing moves,
     springs, or radiates. Confetti self-gates in confetti.ts. */
  @media (prefers-reduced-motion: reduce) {
    .cb-input,
    .cb-check-path,
    .cb-glow {
      transition: none;
    }
    .cb-shell:hover .cb-input:not(:disabled) {
      transform: none;
      animation: none;
    }
    .cb-shell.is-popping .cb-input,
    .cb-shell.is-popping .cb-ring,
    .cb-shell.is-busy .cb-input {
      animation: none;
    }
    .cb-shell.is-busy .cb-input {
      opacity: 0.65;
    }
  }
</style>
